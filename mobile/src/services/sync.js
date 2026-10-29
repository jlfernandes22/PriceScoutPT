import axios from 'axios';
import { Q } from '@nozbe/watermelondb';
import {
  getLastPulledAt,
  setLastPulledAt,
  applyRemoteChanges,
} from '@nozbe/watermelondb/sync/impl';
import { prepareUpdateFromRaw } from '@nozbe/watermelondb/sync/impl/helpers';
import { getApiBaseUrl } from '../config';
import {
  productIdentity, normalizeCatalogEndpoint, requiresCatalogSnapshot, planCatalogReconciliation,
} from '../utils/catalogReconciliation';

const BATCH_SIZE = 5000;
const RECONCILE_BATCH_SIZE = 500;
const SCAN_BATCH_SIZE = 2000;
const SOURCE_SCHEMA_KEY = 'pricescout_source_schema';
const CATALOG_SOURCE_KEY = 'pricescout_catalog_source_v1';
const syncsInFlight = new WeakMap();

async function scanProducts(database, visit) {
  const products = database.collections.get('products');
  let lastId = '';
  while (true) {
    const rows = await products.query(Q.unsafeSqlQuery(
      'SELECT id, supermarket_id, external_id FROM products WHERE _status != ? AND id > ? ORDER BY id LIMIT ?',
      ['deleted', lastId, SCAN_BATCH_SIZE]
    )).unsafeFetchRaw();
    if (!rows.length) return false;
    lastId = rows[rows.length - 1].id;
    if (await visit(rows)) return true;
    if (rows.length < SCAN_BATCH_SIZE) return false;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function hasReplacedProductIds(database, remoteByIdentity) {
  if (!remoteByIdentity.size) return false;
  return scanProducts(database, (rows) => rows.some((product) => {
    const identity = productIdentity(product);
    const remoteId = identity && remoteByIdentity.get(identity);
    return remoteId && remoteId !== product.id;
  }));
}

async function reconcileProductBatch(database, staleRows, remoteByIdentity) {
  if (!staleRows.length) return;
  await database.write(async () => {
    const products = database.collections.get('products');
    const staleIds = staleRows.map((product) => product.id);
    const referenceIds = new Set(staleIds);
    for (const product of staleRows) {
      const replacement = remoteByIdentity.get(productIdentity(product));
      if (replacement) referenceIds.add(replacement);
    }
    // Read inside the Writer: a favorite or basket item added during a pull
    // must be retained too, even when it did not exist when sync began.
    const [records, favorites, items] = await Promise.all([
      products.query(Q.where('id', Q.oneOf(staleIds))).fetch(),
      database.collections.get('favorites').query(Q.where('product_id', Q.oneOf([...referenceIds]))).fetch(),
      database.collections.get('shopping_list_items').query(Q.where('product_id', Q.oneOf([...referenceIds]))).fetch(),
    ]);
    const plan = planCatalogReconciliation(records.map((record) => record._raw), remoteByIdentity,
      favorites.map((record) => record._raw), items.map((record) => record._raw));
    const favoriteById = new Map(favorites.map((record) => [record.id, record]));
    const itemById = new Map(items.map((record) => [record.id, record]));
    const productById = new Map(records.map((record) => [record.id, record]));
    const operations = [];
    for (const update of plan.favoriteUpdates) {
      operations.push(favoriteById.get(update.id).prepareUpdate((favorite) => { favorite.productId = update.productId; }));
    }
    for (const update of plan.itemUpdates) {
      operations.push(itemById.get(update.id).prepareUpdate((item) => {
        item.productId = update.productId;
        item.quantity = update.quantity;
      }));
    }
    for (const id of plan.favoriteDeletes) operations.push(favoriteById.get(id).prepareDestroyPermanently());
    for (const id of plan.itemDeletes) operations.push(itemById.get(id).prepareDestroyPermanently());
    for (const id of plan.unavailableProductIds) {
      const product = productById.get(id);
      const { _status, _changed, ...raw } = product._raw;
      // A missing server price is unavailable, not a local price edit. Use the
      // sync helper to retain server timestamps/status and allow a later pull
      // to make this product available again without local conflict flags.
      const update = prepareUpdateFromRaw(product._raw, {
        ...raw, price: 0, regular_price: null, unit_price: null, in_stock: false, deleted: false,
      }, products);
      if (update) operations.push(update);
    }
    for (const id of plan.deleteProductIds) operations.push(productById.get(id).prepareDestroyPermanently());
    // References and their products change together, with Watermelon cache
    // invalidation/observer notifications. No raw SQL writes or database reset.
    if (operations.length) await database.batch(operations);
  });
}

async function reconcileCatalog(database, snapshot) {
  await scanProducts(database, async (rows) => {
    const stale = rows.filter((product) => snapshot.full
      ? !snapshot.ids.has(product.id) : snapshot.deleted.has(product.id));
    for (let offset = 0; offset < stale.length; offset += RECONCILE_BATCH_SIZE) {
      await reconcileProductBatch(database, stale.slice(offset, offset + RECONCILE_BATCH_SIZE), snapshot.byIdentity);
    }
    return false;
  });
}

function changesForApplication(changes) {
  const result = {};
  // Catalogue sync never owns favorites, baskets or shopping lists.
  for (const name of ['products', 'categories', 'supermarkets']) {
    const collection = changes?.[name];
    if (!collection) continue;
    result[name] = {
      created: [], updated: [...(collection.created || []), ...(collection.updated || [])],
      deleted: name === 'products' ? [] : (collection.deleted || []),
    };
  }
  return result;
}

// App startup, pull-to-refresh and Settings can request sync concurrently.
// Serialize per database and pin every page to the endpoint chosen at start.
export function syncDatabase(database, options = {}) {
  const endpoint = normalizeCatalogEndpoint(getApiBaseUrl());
  const current = syncsInFlight.get(database);
  if (current) {
    return current.endpoint === endpoint ? current.promise : current.promise.catch(() => {}).then(() => syncDatabase(database, options));
  }
  const promise = pullCatalog(database, endpoint, options);
  const entry = { endpoint, promise };
  syncsInFlight.set(database, entry);
  const clear = () => { if (syncsInFlight.get(database) === entry) syncsInFlight.delete(database); };
  promise.then(clear, clear);
  return promise;
}

/**
 * Sincronização incremental com aplicação lote-a-lote.
 *
 * Em vez de acumular as ~56.000 linhas do catálogo em memória e aplicá-las numa
 * única transação (o que estourava a RAM e matava o processo no Hermes com SIGSEGV),
 * cada lote de 5.000 registos é aplicado imediatamente ao SQLite local através do
 * protocolo low-level `applyRemoteChanges` do WatermelonDB (com _unsafeBatchPerCollection
 * para partir a gravação em sub-lotes de 5.000 e nunca bloquear a transação).
 *
 * O resultado é idempotente: se a sincronização for interrompida a meio, o cursor
 * local não avança e a próxima execução volta a descarregar (e o WatermelonDB converte
 * "criar já existente" em update — ver applyRemote.js).
 */
async function pullCatalog(database, endpoint, options = {}) {
  const { onProgress } = options;
  console.log('[Sync] A iniciar protocolo de sincronização Offline-First (lote a lote)...');

  // Existing installations need one full refresh to populate the new source
  // columns even for products whose server rows have not changed recently.
  const [hasSources, savedSource, previousPull] = await Promise.all([
    database.adapter.getLocal(SOURCE_SCHEMA_KEY), database.adapter.getLocal(CATALOG_SOURCE_KEY), getLastPulledAt(database),
  ]);
  const snapshot = {
    full: requiresCatalogSnapshot(savedSource, endpoint, hasSources, previousPull),
    ids: new Set(), byIdentity: new Map(), deleted: new Set(),
  };
  const lastPulledAt = snapshot.full ? 0 : (previousPull || 0);
  // let: no reinício por delta truncado (>10k linhas) este valor é reposto
  // para o epoch — 'const' lançava TypeError e abortava a sincronização.
  let lastPulledAtParam = lastPulledAt
    ? new Date(lastPulledAt).toISOString()
    : new Date(0).toISOString();

  console.log(`[Sync] A solicitar alterações ao servidor desde: ${lastPulledAtParam}`);

  let cursor = null;
  let hasMore = true;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalCategories = 0;
  let fullRestartDone = false;
  let finalTimestamp = Date.now();
  let batchCount = 0;
  const requestedCursors = new Set();

  const restartFullSnapshot = () => {
    fullRestartDone = true;
    snapshot.full = true;
    snapshot.ids.clear();
    snapshot.byIdentity.clear();
    snapshot.deleted.clear();
    requestedCursors.clear();
    lastPulledAtParam = new Date(0).toISOString();
    cursor = null;
    hasMore = true;
  };

  while (hasMore) {
    const params = { last_pulled_at: lastPulledAtParam, limit: BATCH_SIZE };
    if (cursor) {
      if (requestedCursors.has(cursor)) throw new Error('A paginação do catálogo não avançou. Tenta sincronizar novamente.');
      requestedCursors.add(cursor);
      params.cursor = cursor;
    }

    let response;
    try {
      response = await axios.get(`${endpoint}/api/sync`, {
        params,
        // Timeout tolerates a cold start of the server's free tier.
        timeout: 60000,
      });
    } catch (error) {
      // A restored server with an older watermark rejects a future client
      // timestamp. Retry once from epoch without discarding the local cache.
      if (!snapshot.full && !cursor && !fullRestartDone && error.response?.status === 400) {
        restartFullSnapshot();
        continue;
      }
      throw error;
    }
    if (response.status !== 200) {
      throw new Error(`Erro na API de sincronização: Status ${response.status}`);
    }

    const { changes, next_cursor, has_more, timestamp, truncated } = response.data;
    const productChanges = changes?.products;
    if (!productChanges || !['created', 'updated', 'deleted'].every((key) => Array.isArray(productChanges[key]))
        || ![...productChanges.created, ...productChanges.updated].every((product) => typeof product?.id === 'string' && product.id && productIdentity(product))
        || !productChanges.deleted.every((id) => typeof id === 'string' && id)
        || !Number.isFinite(timestamp) || timestamp <= 0 || typeof has_more !== 'boolean'
        || (has_more && (typeof next_cursor !== 'string' || !next_cursor || next_cursor === cursor))) {
      throw new Error('Resposta de sincronização inválida. O catálogo guardado foi mantido.');
    }
    if (!snapshot.full && timestamp < (previousPull || 0)) {
      restartFullSnapshot();
      continue;
    }
    finalTimestamp = timestamp || finalTimestamp;

    const created = changes?.products?.created || [];
    const updated = changes?.products?.updated || [];
    const deleted = changes?.products?.deleted || [];
    const categories = changes?.categories?.created || [];
    const supermarkets = changes?.supermarkets?.created || [];
    for (const product of [...created, ...updated]) {
      snapshot.ids.add(product.id);
      const identity = productIdentity(product);
      if (identity) snapshot.byIdentity.set(identity, product.id);
    }
    for (const id of deleted) snapshot.deleted.add(id);

    // Aplicar este lote imediatamente — a memória fica limitada ao tamanho do lote.
    if (created.length || updated.length || deleted.length || categories.length || supermarkets.length) {
      await database.write(async () => {
        await applyRemoteChanges(changesForApplication(changes), {
          db: database,
          _unsafeBatchPerCollection: true,
          sendCreatedAsUpdated: true,
        });
      });
    }

    // Compatibilidade com versões antigas da API que truncavam os deltas.
    // A API atual pagina todos os tipos de alteração e devolve truncated=false.
    // As versões antigas truncam os deltas além de 10.000 linhas. Sem isto,
    // as atualizações mais antigas desse dia perder-se-iam para sempre (o cursor
    // avançaria para além delas). Fazemos um pull completo (idempotente) para
    // garantir consistência — raro, só em dias com muitas mudanças de preços.
    if (truncated && !fullRestartDone) {
      console.log('[Sync] Delta truncado no servidor (>10k) — a refazer pull completo para não perder atualizações.');
      restartFullSnapshot();
      continue;
    }
    if (truncated) throw new Error('O servidor devolveu um catálogo incompleto. Os dados guardados foram mantidos.');

    totalCreated += created.length;
    totalUpdated += updated.length;
    totalDeleted += deleted.length;
    totalCategories += categories.length;
    batchCount += 1;

    console.log(
      `[Sync] Lote ${batchCount}: +${created.length} criados, ${updated.length} atualizados, ` +
        `${deleted.length} apagados, ${categories.length} categorias (acumulado: ` +
        `${totalCreated}/${totalUpdated}/${totalDeleted}/${totalCategories})`
    );

    cursor = next_cursor || null;
    hasMore = Boolean(has_more);

    // A database can be restored behind the same URL. Different UUIDs for an
    // exact retailer identity prove the delta belongs to a replacement; fetch
    // its complete catalogue before removing any old products or user refs.
    if (!hasMore && !snapshot.full && await hasReplacedProductIds(database, snapshot.byIdentity)) {
      console.log('[Sync] Identidades do catálogo substituídas — a solicitar catálogo completo.');
      restartFullSnapshot();
    }

    if (onProgress) {
      onProgress({ done: totalCreated + totalUpdated, total: null, batch: batchCount });
    }
  }

  // Only a completed pull can retire stale prices. Interrupted snapshots keep
  // all original references and remain retryable from the old watermark.
  if (snapshot.full || snapshot.deleted.size) await reconcileCatalog(database, snapshot);

  // Gravar o timestamp de última sincronização apenas no fim, com sucesso.
  await setLastPulledAt(database, finalTimestamp);
  await database.adapter.setLocal(SOURCE_SCHEMA_KEY, '6');
  await database.adapter.setLocal(CATALOG_SOURCE_KEY, JSON.stringify({ version: 1, endpoint }));

  if (onProgress) {
    onProgress({ done: totalCreated + totalUpdated, total: totalCreated + totalUpdated, batch: batchCount });
  }

  console.log(
    `[Sync] Sincronização concluída! Lotes: ${batchCount}, ` +
      `Criados ${totalCreated}, Atualizados ${totalUpdated}, Apagados ${totalDeleted}, Categorias ${totalCategories}`
  );
}
