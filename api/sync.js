const express = require('express');
const db = require('./db');
const router = express.Router();

const PRODUCT_FIELDS = `id, supermarket_id, category_id, external_id, name, brand,
  description, price, price_currency, unit, url, image_url, barcode, regular_price,
  unit_price, unit_price_unit, source_type, source_url, store_location, observed_at,
  requires_loyalty_card, valid_from, valid_to, in_stock, deleted,
  last_scraped_at, created_at, updated_at`;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Shared by the product BEFORE trigger. First-page pulls briefly take the
// exclusive side to drain in-flight writers before choosing the DB watermark.
const PRODUCT_SYNC_LOCK = 76231027;
const INVALID_SYNC = 'Invalid sync timestamp, limit or cursor. Restart sync without a cursor.';
class InvalidSyncRequest extends Error {}
const epoch = value => value == null ? null : new Date(value).getTime();
const formatProduct = row => {
  const { changed_at, ...product } = row;
  for (const key of ['price', 'regular_price', 'unit_price']) {
    product[key] = product[key] == null ? null : Number(product[key]);
  }
  for (const key of ['observed_at', 'valid_from', 'valid_to', 'last_scraped_at', 'created_at', 'updated_at']) {
    product[key] = epoch(product[key]);
  }
  return product;
};
const formatRecord = row => ({ ...row, created_at: epoch(row.created_at), updated_at: epoch(row.updated_at) });

// One ordered change stream paginates creations, updates AND tombstones. The
// snapshot watermark travels in the cursor. The first-page advisory barrier
// prevents a writer stamped before that watermark from committing afterwards
// and becoming invisible to both this pull and the next one.
router.get('/', async (req, res) => {
  let since;
  let until;
  let cursor;
  let limit;
  try {
    if (req.query.last_pulled_at != null && typeof req.query.last_pulled_at !== 'string') throw new Error();
    since = new Date(req.query.last_pulled_at || 0).toISOString();
    const rawLimit = req.query.limit ?? '5000';
    if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) throw new Error();
    limit = Math.min(Number(rawLimit), 10000);
    if (req.query.cursor) {
      if (typeof req.query.cursor !== 'string' || req.query.cursor.length > 1500) throw new Error();
      cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString());
      if (cursor.v !== 2 || cursor.since !== since || !UUID.test(cursor.id) ||
          typeof cursor.after !== 'string' || !Number.isFinite(Date.parse(cursor.after))) throw new Error();
      until = new Date(cursor.until).toISOString();
      if (Date.parse(cursor.after) > Date.parse(until)) throw new Error();
    }
    if (cursor && since > until) throw new Error();
  } catch {
    return res.status(400).json({ error: INVALID_SYNC });
  }

  let client;
  let transactionOpen = false;
  let releaseError;
  try {
    if (!cursor) {
      client = await db.pool.connect();
      await client.query('BEGIN');
      transactionOpen = true;
      // Acquire before reading tables. Writer triggers retain the shared
      // lock until commit and stamp clock_timestamp() after acquiring it.
      await client.query('SELECT pg_advisory_xact_lock($1)', [PRODUCT_SYNC_LOCK]);
      const watermark = await client.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS timestamp');
      until = new Date(Number(watermark.rows[0].timestamp)).toISOString();
      if (since > until) throw new InvalidSyncRequest();
    } else {
      // The API and database may have different clocks. Check the database's
      // cursor against the same clock used to create it on the first page.
      const clock = await db.query('SELECT clock_timestamp() AS current_time');
      if (Date.parse(until) > new Date(clock.rows[0].current_time).getTime()) throw new InvalidSyncRequest();
    }
    const query = client ? client.query.bind(client) : db.query;
    const params = [since, until];
    let after = '';
    if (cursor) {
      params.push(cursor.after, cursor.id);
      after = 'AND (updated_at, id) > ($3::timestamptz, $4::uuid)';
    }
    params.push(limit + 1);
    const result = await query(
      `SELECT ${PRODUCT_FIELDS},
         to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS changed_at
       FROM products WHERE updated_at >= $1 AND updated_at <= $2 ${after}
       ORDER BY updated_at, id LIMIT $${params.length}`, params);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const changes = {
      products: { created: [], updated: [], deleted: [] },
      categories: { created: [], updated: [], deleted: [] },
      supermarkets: { created: [], updated: [], deleted: [] },
    };
    for (const row of rows) {
      if (row.deleted) changes.products.deleted.push(row.id);
      else changes.products[epoch(row.created_at) >= Date.parse(since) ? 'created' : 'updated'].push(formatProduct(row));
    }
    if (!cursor) {
      const [categories, supermarkets] = await Promise.all([
        query('SELECT id, name, slug, created_at, updated_at FROM canonical_categories ORDER BY sort_order, id'),
        query('SELECT id, name, slug, created_at, updated_at FROM supermarkets ORDER BY name, id'),
      ]);
      changes.categories.created = categories.rows.map(row => ({ ...formatRecord(row), supermarket_id: '' }));
      changes.supermarkets.created = supermarkets.rows.map(formatRecord);
    }
    const last = rows[rows.length - 1];
    const next = hasMore ? Buffer.from(JSON.stringify({
      v: 2, since, until, after: last.changed_at, id: last.id,
    })).toString('base64url') : null;
    if (transactionOpen) {
      await client.query('COMMIT');
      transactionOpen = false;
    }
    return res.json({ changes, timestamp: Date.parse(until), next_cursor: next, has_more: hasMore, truncated: false });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    }
    if (error instanceof InvalidSyncRequest) return res.status(400).json({ error: INVALID_SYNC });
    console.error('Sync error:', error);
    return res.status(500).json({ error: 'Unable to fetch sync changes.' });
  } finally {
    if (client) client.release(releaseError);
  }
});

module.exports = router;
