const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const reconciliation = require('../src/utils/catalogReconciliation.js');

const SOURCE_KEY = 'pricescout_catalog_source_v1';
const endpoint = 'https://new.example';
const rawProduct = (id, external_id = id) => ({
  id, external_id, supermarket_id: 'shop', name: external_id, price: 2, in_stock: true,
  deleted: false, updated_at: 1000, _status: 'synced', _changed: '',
});
const changes = (created = [], deleted = [], extra = {}) => ({
  status: 200, data: { timestamp: 2000, has_more: false, next_cursor: null,
    changes: { products: { created, updated: [], deleted } }, ...extra },
});

// Exercise orchestration against a small observable-store substitute: the real
// Watermelon adapter is native, so these tests focus on successful/failed pull
// boundaries, identity changes and user references rather than mocking SQL.
function fixture({ products = [], favorites = [], items = [], savedSource, lastPull = 1000 } = {}) {
  const tables = new Map();
  function model(table, raw) {
    const record = {
      table, id: raw.id, _raw: { ...raw },
      get productId() { return this._raw.product_id; },
      set productId(value) { this._raw.product_id = value; },
      get quantity() { return this._raw.quantity; },
      set quantity(value) { this._raw.quantity = value; },
      prepareUpdate(update) { update(this); this.operation = 'update'; return this; },
      prepareDestroyPermanently() { this.operation = 'destroy'; return this; },
    };
    return record;
  }
  for (const [table, rows] of Object.entries({ products, favorites, shopping_list_items: items, categories: [], supermarkets: [] })) {
    tables.set(table, new Map(rows.map((row) => [row.id, model(table, row)])));
  }
  const storage = new Map([['pricescout_source_schema', '6']]);
  if (savedSource !== undefined) storage.set(SOURCE_KEY, savedSource);
  const Q = {
    unsafeSqlQuery: (sql, values) => ({ sql, values }),
    where: (column, value) => ({ column, value }),
    oneOf: (values) => ({ oneOf: values }),
  };
  const db = {
    lastPull, writes: [], tables, storage,
    adapter: { getLocal: async (key) => storage.get(key), setLocal: async (key, value) => storage.set(key, value) },
    async write(callback) { return callback(); },
    async batch(records) {
      for (const record of records) {
        db.writes.push({ table: record.table, id: record.id, operation: record.operation });
        if (record.operation === 'destroy') tables.get(record.table).delete(record.id);
        record.operation = undefined;
      }
    },
    collections: {
      get(table) {
        return { query(...clauses) {
          const selected = () => {
            let rows = [...tables.get(table).values()];
            for (const clause of clauses) {
              if (clause.sql) {
                const [status, after, limit] = clause.values;
                rows = rows.filter((row) => row._raw._status !== status && row.id > after)
                  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, limit);
              } else rows = rows.filter((row) => clause.value.oneOf.includes(row._raw[clause.column]));
            }
            return rows;
          };
          return { fetch: async () => selected(), unsafeFetchRaw: async () => selected().map((row) => ({ ...row._raw })) };
        } };
      },
    },
  };
  const calls = [];
  let requests;
  let effectiveEndpoint = endpoint;
  const mocks = {
    axios: { async get(url, options) { calls.push({ url, params: { ...options.params } }); return requests(url, options, calls.length); } },
    '@nozbe/watermelondb': { Q },
    '@nozbe/watermelondb/sync/impl': {
      getLastPulledAt: async () => db.lastPull,
      setLastPulledAt: async (_, timestamp) => { db.lastPull = timestamp; },
      async applyRemoteChanges(remote) {
        for (const [table, change] of Object.entries(remote)) {
          for (const raw of [...change.created, ...change.updated]) {
            const existing = tables.get(table).get(raw.id);
            if (existing) existing._raw = { ...existing._raw, ...raw };
            else tables.get(table).set(raw.id, model(table, { _status: 'synced', _changed: '', ...raw }));
          }
          for (const id of change.deleted) tables.get(table).delete(id);
        }
      },
    },
    '@nozbe/watermelondb/sync/impl/helpers': {
      prepareUpdateFromRaw(local, remote) {
        const record = tables.get('products').get(local.id);
        return record.prepareUpdate(() => { record._raw = { ...local, ...remote }; });
      },
    },
    '../config': { getApiBaseUrl: () => effectiveEndpoint },
    '../utils/catalogReconciliation': reconciliation,
  };
  const compiled = transformSync(fs.readFileSync(require.resolve('../src/services/sync.js'), 'utf8'), {
    babelrc: false, configFile: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    if (!mocks[name]) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, console: { log() {} }, setTimeout, WeakMap, Map, Set, Date, Promise });
  return { db, calls, sync: exports.syncDatabase, respond: (handler) => { requests = handler; },
    setEndpoint: (value) => { effectiveEndpoint = value; } };
}

test('failed later snapshot page preserves old products, user references and sync watermark', async () => {
  const f = fixture({ products: [rawProduct('old', 'milk')], favorites: [{ id: 'fav', product_id: 'old' }],
    items: [{ id: 'basket', product_id: 'old', list_id: 'weekly', quantity: 3 }] });
  f.respond((_, __, call) => {
    if (call === 1) return changes([rawProduct('new', 'milk')], [], { has_more: true, next_cursor: 'page-two' });
    throw new Error('network interrupted');
  });
  await assert.rejects(f.sync(f.db), /network interrupted/);
  assert.equal(f.db.tables.get('products').get('old')._raw.price, 2);
  assert.equal(f.db.tables.get('favorites').get('fav').productId, 'old');
  assert.equal(f.db.tables.get('shopping_list_items').get('basket').quantity, 3);
  assert.equal(f.db.lastPull, 1000);
  assert.equal(f.db.storage.has(SOURCE_KEY), false);
  assert.equal(f.db.writes.length, 0);
});

test('completed replacement snapshot relinks exact products and retains missing referenced products without stale prices', async () => {
  const f = fixture({ products: [rawProduct('old', 'milk'), rawProduct('missing', 'rice'), rawProduct('unused', 'oil')],
    favorites: [{ id: 'fav', product_id: 'old' }, { id: 'missing-fav', product_id: 'missing' }],
    items: [{ id: 'basket', product_id: 'old', list_id: 'weekly', quantity: 3 }] });
  f.respond(() => changes([rawProduct('new', 'milk')]));
  await f.sync(f.db);
  assert.equal(f.calls[0].params.last_pulled_at, new Date(0).toISOString());
  assert.equal(f.db.tables.get('favorites').get('fav').productId, 'new');
  assert.equal(f.db.tables.get('shopping_list_items').get('basket').productId, 'new');
  assert.equal(f.db.tables.get('shopping_list_items').get('basket').quantity, 3);
  assert.equal(f.db.tables.get('products').has('old'), false);
  assert.equal(f.db.tables.get('products').has('unused'), false);
  assert.equal(f.db.tables.get('products').get('missing')._raw.in_stock, false);
  assert.equal(f.db.tables.get('products').get('missing')._raw.price, 0);
  assert.equal(f.db.tables.get('products').get('missing')._raw._changed, '');
  assert.equal(f.db.lastPull, 2000);
  assert.equal(JSON.parse(f.db.storage.get(SOURCE_KEY)).endpoint, endpoint);
});

test('a changed backend URL forces a full pull even when source schema and previous sync were current', async () => {
  const f = fixture({ products: [rawProduct('old')], savedSource: JSON.stringify({ version: 1, endpoint: 'https://old.example' }) });
  f.respond(() => changes([]));
  await f.sync(f.db);
  assert.equal(f.calls[0].params.last_pulled_at, new Date(0).toISOString());
  assert.equal(f.db.tables.get('products').size, 0);
});

test('an exact identity under a new UUID on the same endpoint restarts incrementals as a full snapshot', async () => {
  const f = fixture({ products: [rawProduct('old', 'milk'), rawProduct('stale', 'oil')],
    favorites: [{ id: 'fav', product_id: 'old' }], savedSource: JSON.stringify({ version: 1, endpoint }) });
  f.respond(() => changes([rawProduct('new', 'milk')]));
  await f.sync(f.db);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].params.last_pulled_at, new Date(1000).toISOString());
  assert.equal(f.calls[1].params.last_pulled_at, new Date(0).toISOString());
  assert.equal(f.db.tables.get('products').has('stale'), false);
  assert.equal(f.db.tables.get('favorites').get('fav').productId, 'new');
});

test('incremental tombstones retain referenced products as unavailable and delete only unused rows', async () => {
  const f = fixture({ products: [rawProduct('used'), rawProduct('unused'), rawProduct('unchanged')],
    favorites: [{ id: 'fav', product_id: 'used' }], savedSource: JSON.stringify({ version: 1, endpoint }) });
  f.respond(() => changes([], ['used', 'unused']));
  await f.sync(f.db);
  assert.equal(f.calls.length, 1);
  assert.equal(f.db.tables.get('products').get('used')._raw.price, 0);
  assert.equal(f.db.tables.get('products').get('used')._raw.in_stock, false);
  assert.equal(f.db.tables.get('products').has('unused'), false);
  assert.equal(f.db.tables.get('products').get('unchanged')._raw.price, 2);
});

test('concurrent sync requests share one pull and endpoint changes cannot mix pages between servers', async () => {
  const f = fixture();
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  f.respond(async (_, __, call) => {
    if (call === 1) { await waiting; return changes([], [], { has_more: true, next_cursor: 'two' }); }
    return changes([]);
  });
  const one = f.sync(f.db);
  assert.equal(f.sync(f.db), one);
  f.setEndpoint('https://other.example');
  const next = f.sync(f.db);
  release();
  await Promise.all([one, next]);
  assert.deepEqual(f.calls.map((call) => call.url), [
    `${endpoint}/api/sync`, `${endpoint}/api/sync`, 'https://other.example/api/sync',
  ]);
  assert.equal(JSON.parse(f.db.storage.get(SOURCE_KEY)).endpoint, 'https://other.example');
});

test('an older restored server watermark retries from epoch without clearing referenced products', async () => {
  const f = fixture({ products: [rawProduct('old', 'milk')], favorites: [{ id: 'fav', product_id: 'old' }],
    savedSource: JSON.stringify({ version: 1, endpoint }), lastPull: 3000 });
  f.respond((_, __, call) => {
    if (call === 1) throw Object.assign(new Error('future client timestamp'), { response: { status: 400 } });
    return changes([rawProduct('new', 'milk')]);
  });
  await f.sync(f.db);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].params.last_pulled_at, new Date(0).toISOString());
  assert.equal(f.db.tables.get('favorites').get('fav').productId, 'new');
});

test('malformed or repeated pages never authorize pruning a stored catalogue', async () => {
  for (const response of [
    { status: 200, data: { timestamp: 2000, has_more: false, changes: { products: {} } } },
    changes([rawProduct('new')], [], { has_more: true, next_cursor: null }),
  ]) {
    const f = fixture({ products: [rawProduct('old')] });
    f.respond(() => response);
    await assert.rejects(f.sync(f.db), /inválida/);
    assert.equal(f.db.tables.get('products').has('old'), true);
    assert.equal(f.db.lastPull, 1000);
    assert.equal(f.db.storage.has(SOURCE_KEY), false);
  }
  const f = fixture({ products: [rawProduct('old')] });
  f.respond(() => changes([], [], { has_more: true, next_cursor: 'same-page' }));
  await assert.rejects(f.sync(f.db), /inválida/);
  assert.equal(f.calls.length, 2);
  assert.equal(f.db.tables.get('products').has('old'), true);
  assert.equal(f.db.lastPull, 1000);
});
