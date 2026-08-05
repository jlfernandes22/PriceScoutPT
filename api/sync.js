const express = require('express');
const router = express.Router();
const db = require('./db');

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 10000;

// Formatar rows do PostgreSQL para tipos compatíveis com o WatermelonDB
const formatProducts = (rows) => rows.map(row => ({
  ...row,
  price: parseFloat(row.price || 0),
  created_at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  last_scraped_at: row.last_scraped_at ? new Date(row.last_scraped_at).getTime() : null,
}));

// As datas de categorias também devem viajar como epoch (ms), tal como nos produtos,
// para o WatermelonDB as armazenar corretamente em colunas do tipo date.
// As categorias são globais (canónicas) — supermarket_id é um sentinela vazio porque
// o schema do WatermelonDB mantém a coluna para retrocompatibilidade.
const formatCategories = (rows) => rows.map(row => ({
  ...row,
  supermarket_id: '',
  created_at: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
}));

// GET /api/sync?last_pulled_at=X&cursor=YYYY&limit=5000
// Sincronização incremental por cursor: o cliente pede lotes sucessivos
// até que has_more seja false, evitando OOM em dispositivos móveis.
router.get('/', async (req, res) => {
  const lastPulledAt = req.query.last_pulled_at
    ? new Date(req.query.last_pulled_at)
    : new Date(0);

  if (Number.isNaN(lastPulledAt.getTime())) {
    return res.status(400).json({ error: 'Invalid last_pulled_at timestamp.' });
  }

  const threshold = lastPulledAt.toISOString();
  const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

  // Cursor "created_epoch,id" — continua após o último item do lote anterior.
  // created_epoch usa EXTRACT(EPOCH) do PostgreSQL (precisão de microssegundos),
  // pois created_at guarda microssegundos e o Date do JS (ms) não os preserva.
  let cursorEpoch = null;
  let cursorId = null;
  if (req.query.cursor) {
    const [epoch, id] = req.query.cursor.split(',');
    if (epoch && id && Number.isFinite(parseFloat(epoch))) {
      cursorEpoch = parseFloat(epoch);
      cursorId = id;
    }
  }

  try {
    // 1. Fetch created products (novos desde o último pull, ordenados por created_at)
    // O cursor guarda EXTRACT(EPOCH) (microssegundos) para não perder precisão,
    // mas a ordenação/filtro usam created_at diretamente (com to_timestamp para
    // reconverter o epoch) para poder usar o índice (created_at, id).
    const params = [threshold];
    let cursorClause = '';
    if (cursorEpoch !== null && cursorId) {
      params.push(cursorEpoch, cursorId);
      cursorClause = 'AND (created_at > to_timestamp($2) OR (created_at = to_timestamp($2) AND id > $3))';
    }
    params.push(limit);

    const createdResult = await db.query(
      `SELECT id, supermarket_id, category_id, external_id, name, brand, description, price,
              price_currency, unit, url, image_url, in_stock, deleted, created_at, updated_at,
              EXTRACT(EPOCH FROM created_at) AS created_epoch
       FROM products
       WHERE created_at >= $1
         AND (deleted = false OR deleted IS NULL)
         ${cursorClause}
       ORDER BY created_at ASC, id ASC
       LIMIT $${params.length}`,
      params
    );

    // 2-4. Delta (updated/deleted/categories) apenas no primeiro lote (sem cursor);
    //     nos lotes seguintes o cliente já recebeu estes dados.
    let updatedResult = { rows: [] };
    let deletedResult = { rows: [] };
    let categoriesResult = { rows: [] };
    if (!req.query.cursor) {
      updatedResult = await db.query(
        `SELECT id, supermarket_id, category_id, external_id, name, brand, description, price,
                price_currency, unit, url, image_url, in_stock, deleted, created_at, updated_at
         FROM products
         WHERE updated_at >= $1
           AND created_at < $1
           AND (deleted = false OR deleted IS NULL)
         ORDER BY updated_at ASC, id ASC
         LIMIT ${MAX_LIMIT}`,
        [threshold]
      );

      // 3. Fetch deleted products (strictly only rows flagged as deleted)
      deletedResult = await db.query(
        `SELECT id
         FROM products
         WHERE updated_at >= $1
           AND deleted = true
         ORDER BY updated_at ASC
         LIMIT ${MAX_LIMIT}`,
        [threshold]
      );

      // 4. Categorias (criadas/atualizadas desde o último pull)
      categoriesResult = await db.query(
        `SELECT id, name, slug, sort_order, created_at, updated_at
         FROM canonical_categories
         WHERE updated_at >= $1
         ORDER BY sort_order ASC, id ASC
         LIMIT ${MAX_LIMIT}`,
        [threshold]
      );
    }

    // 5. Calcular cursor para o próximo lote (apenas se o lote veio cheio)
    const createdRows = createdResult.rows;
    let nextCursor = null;
    let hasMore = false;
    if (createdRows.length === limit && createdRows.length > 0) {
      const last = createdRows[createdRows.length - 1];
      nextCursor = `${last.created_epoch},${last.id}`;
      hasMore = true;
    }

    const payload = {
      changes: {
        products: {
          created: formatProducts(createdRows),
          updated: formatProducts(updatedResult.rows),
          deleted: deletedResult.rows.map((row) => row.id),
        },
        categories: {
          created: formatCategories(categoriesResult.rows),
          updated: [],
          deleted: [],
        },
      },
      timestamp: Date.now(),
      next_cursor: nextCursor,
      has_more: hasMore,
    };

    res.json(payload);
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Unable to fetch sync changes.' });
  }
});

module.exports = router;
