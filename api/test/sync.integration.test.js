const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const databaseUrl = process.env.SYNC_TEST_DATABASE_URL;

describe('bounded sync change stream against PostgreSQL', { skip: !databaseUrl }, () => {
  let pool, server, baseUrl, since, deletedIds;
  const supermarketId = randomUUID();
  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = require('../db').pool;
    await pool.query('INSERT INTO supermarkets(id,name,slug) VALUES($1,$2,$2)', [supermarketId, `sync-${supermarketId}`]);
    since = new Date(Date.now() - 1000).toISOString();
    // More than the old 10,000-row delta cap, retaining microsecond cursor positions.
    await pool.query(`INSERT INTO products(supermarket_id,external_id,name,price,created_at,deleted,observed_at,unit_price)
      SELECT $1, n::text, 'Produto ' || n, 1.99, '2020-01-01'::timestamptz,
             n > 10003, now(), 3.25 FROM generate_series(1,10006) n`, [supermarketId]);
    deletedIds = new Set((await pool.query('SELECT id FROM products WHERE supermarket_id=$1 AND deleted=true', [supermarketId])).rows.map(row => row.id));
    const app = require('express')();
    app.use('/api/sync', require('../sync'));
    app.use('/api/supermarkets', require('../supermarkets'));
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) {
      await pool.query('DELETE FROM supermarkets WHERE id=$1', [supermarketId]);
      await pool.end();
    }
  });

  async function pull(query) {
    const response = await fetch(`${baseUrl}/api/sync?${new URLSearchParams(query)}`);
    assert.equal(response.status, 200);
    return response.json();
  }

  test('paginates every update and tombstone, retaining a fixed watermark', async () => {
    let cursor, watermark;
    const ids = new Set();
    let deleted = 0;
    let pages = 0;
    do {
      const page = await pull({ last_pulled_at: since, limit: '1000', ...(cursor ? { cursor } : {}) });
      assert.ok(page.changes.products.updated.length + page.changes.products.created.length + page.changes.products.deleted.length <= 1000);
      if (!pages) {
        watermark = page.timestamp;
        assert.ok(page.changes.supermarkets.created.some(store => store.id === supermarketId));
        assert.equal(typeof page.changes.products.updated[0].price, 'number');
        assert.equal(typeof page.changes.products.updated[0].observed_at, 'number');
        assert.equal(page.changes.products.updated[0].unit_price, 3.25);
        await new Promise(resolve => setTimeout(resolve, 10));
        await pool.query(`INSERT INTO products(supermarket_id,external_id,name,price) VALUES($1,'later','Later',2)`, [supermarketId]);
      } else {
        assert.equal(page.timestamp, watermark);
        assert.equal(page.changes.supermarkets.created.length, 0);
      }
      for (const row of [...page.changes.products.updated, ...page.changes.products.created]) {
        if (row.supermarket_id !== supermarketId) continue;
        assert.ok(!ids.has(row.id), 'no duplicate/lost cursor positions');
        assert.notEqual(row.external_id, 'later');
        ids.add(row.id);
      }
      deleted += page.changes.products.deleted.filter(id => deletedIds.has(id)).length;
      pages++;
      cursor = page.next_cursor;
      assert.equal(page.has_more, !!cursor);
      assert.equal(page.truncated, false);
    } while (cursor);
    assert.equal(ids.size, 10003);
    assert.equal(deleted, 3);
    assert.ok(pages >= 11);
    const next = await pull({ last_pulled_at: new Date(watermark).toISOString() });
    assert.ok(next.changes.products.created.some(row => row.external_id === 'later'));
  });

  test('rejects malformed cursor/limit parameters and reports genuine coverage', async () => {
    for (const query of ['cursor=broken', 'limit=-1', 'limit=abc', 'last_pulled_at[]=x']) {
      assert.equal((await fetch(`${baseUrl}/api/sync?${query}`)).status, 400);
    }
    const coverage = await (await fetch(`${baseUrl}/api/supermarkets`)).json();
    const store = coverage.find(row => row.id === supermarketId);
    assert.equal(store.usable_prices, 10004);
    assert.equal(store.has_prices, true);
    assert.equal(coverage.find(row => row.slug === 'mercadona').has_prices, false);
  });

  test('waits for an in-flight writer before capturing the first-page watermark', async () => {
    const writer = await pool.connect();
    const observer = await pool.connect();
    let pendingPull;
    try {
      const start = await observer.query('SELECT clock_timestamp() AS timestamp');
      const sinceWriter = new Date(start.rows[0].timestamp).toISOString();
      await writer.query('BEGIN');
      const inserted = await writer.query(`INSERT INTO products(supermarket_id,external_id,name,price,created_at)
        VALUES($1,'in-flight-commit','In-flight writer',2,'2020-01-01') RETURNING id`, [supermarketId]);
      pendingPull = pull({ last_pulled_at: sinceWriter });
      // Wait for evidence of the API's blocked exclusive advisory lock. A
      // fixed delay would pass even if the HTTP request had not started yet.
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (Date.now() < deadline && !waiting) {
        const locks = await observer.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND objid=76231027 AND NOT granted
            AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) AS waiting`);
        waiting = locks.rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(waiting, 'first-page sync waits for the uncommitted writer');
      await writer.query('COMMIT');
      const page = await pendingPull;
      const found = [...page.changes.products.created, ...page.changes.products.updated];
      assert.ok(found.some(row => row.id === inserted.rows[0].id), 'committed row is included before advancing the watermark');
    } finally {
      await writer.query('ROLLBACK');
      if (pendingPull) await pendingPull.catch(() => {});
      writer.release();
      observer.release();
    }
  });

  test('stamps a writer after the barrier even if its transaction started earlier', async () => {
    const barrier = await pool.connect();
    const writer = await pool.connect();
    let pendingInsert;
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT now()');
      await barrier.query('BEGIN');
      await barrier.query('SELECT pg_advisory_xact_lock(76231027)');
      await barrier.query('SELECT pg_sleep(0.01)');
      const snapshot = await barrier.query('SELECT clock_timestamp() AS timestamp');
      const watermark = new Date(snapshot.rows[0].timestamp).toISOString();
      pendingInsert = writer.query(`INSERT INTO products(supermarket_id,external_id,name,price)
        VALUES($1,'writer-after-barrier','Writer after barrier',3) RETURNING id`, [supermarketId]);
      await barrier.query('COMMIT');
      const inserted = await pendingInsert;
      await writer.query('COMMIT');
      const page = await pull({ last_pulled_at: watermark });
      assert.ok([...page.changes.products.created, ...page.changes.products.updated].some(row => row.id === inserted.rows[0].id));
    } finally {
      await barrier.query('ROLLBACK');
      if (pendingInsert) await pendingInsert.catch(() => {});
      await writer.query('ROLLBACK');
      barrier.release();
      writer.release();
    }
  });
});
