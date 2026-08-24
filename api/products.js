const express = require('express');
const router = express.Router();
const db = require('./db');

router.get('/compare', async (req, res) => {
  const { name } = req.query;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Query parameter name is required.' });
  }

  try {
    // plainto_tsquery devolve uma tsquery vazia quando o input são só stopwords
    // ("o de a") — e uma tsquery vazia casa com TODOS os vectores, devolvendo
    // resultados arbitrários. Detecta isso via numnode() e devolve vazio.
    const guard = await db.query(
      `SELECT numnode(plainto_tsquery('pg_catalog.portuguese', $1)) AS n`,
      [name]
    );
    if (Number(guard.rows[0].n) === 0) {
      return res.json([]);
    }

    const compareResult = await db.query(
      `SELECT p.id, p.supermarket_id, s.name AS supermarket_name, s.slug AS supermarket_slug,
              p.category_id, c.name AS category_name, p.external_id, p.name, p.brand,
              p.description, p.price, p.price_currency, p.unit, p.url, p.image_url,
              p.in_stock, p.deleted, p.created_at, p.updated_at,
              ts_rank(p.search_vector, plainto_tsquery('pg_catalog.portuguese', $1)) AS rank
       FROM products p
       JOIN supermarkets s ON p.supermarket_id = s.id
       LEFT JOIN canonical_categories c ON p.category_id = c.id
       WHERE p.search_vector @@ plainto_tsquery('pg_catalog.portuguese', $1)
         AND p.deleted = false
         AND p.in_stock = true
       ORDER BY rank DESC, p.price ASC
       LIMIT 50`,
      [name]
    );

    res.json(compareResult.rows);
  } catch (error) {
    console.error('Compare search error:', error);
    res.status(500).json({ error: 'Unable to perform compare search.' });
  }
});

// GET /api/products?category=:slug&supermarket=:slug&limit=&offset=
router.get('/', async (req, res) => {
  const { category, supermarket, limit, offset } = req.query;

  const conditions = ['p.deleted = false', 'p.in_stock = true'];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`c.slug = $${params.length}`);
  }
  if (supermarket) {
    params.push(supermarket);
    conditions.push(`s.slug = $${params.length}`);
  }
  const safeLimit = Math.min(parseInt(limit, 10) || 50, 200);
  const safeOffset = parseInt(offset, 10) || 0;
  params.push(safeLimit, safeOffset);

  try {
    const result = await db.query(
      `SELECT p.id, p.supermarket_id, s.name AS supermarket_name, s.slug AS supermarket_slug,
              p.category_id, c.name AS category_name, c.slug AS category_slug,
              p.external_id, p.name, p.brand, p.description, p.price, p.price_currency,
              p.unit, p.url, p.image_url, p.in_stock, p.deleted, p.updated_at
       FROM products p
       JOIN supermarkets s ON p.supermarket_id = s.id
       LEFT JOIN canonical_categories c ON p.category_id = c.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Products browse error:', error);
    res.status(500).json({ error: 'Unable to fetch products.' });
  }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  // Um id não-UUID (ex: "/api/products/foo") faria o PostgreSQL lançar o erro
  // 22P02 (invalid input syntax for type uuid) — melhor responder 404 direto.
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  try {
    const productResult = await db.query(
      `SELECT id, supermarket_id, category_id, external_id, name, brand, description,
              price, price_currency, unit, url, image_url, in_stock, deleted,
              created_at, updated_at
       FROM products
       WHERE id = $1`,
      [id]
    );

    if (!productResult.rows.length) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const historyResult = await db.query(
      `SELECT id, price, price_currency, recorded_at
       FROM price_history
       WHERE product_id = $1
         AND recorded_at >= now() - INTERVAL '30 days'
       ORDER BY recorded_at DESC`,
      [id]
    );

    res.json({
      ...productResult.rows[0],
      price_history: historyResult.rows,
    });
  } catch (error) {
    console.error('Product lookup error:', error);
    res.status(500).json({ error: 'Unable to fetch product.' });
  }
});

module.exports = router;
