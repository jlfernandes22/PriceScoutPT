// Run against an isolated database initialized with init.sql and migrations:
// SEARCH_TEST_DATABASE_URL=postgresql://... npm test
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { parseProductQuery, buildProductQuery } = require('../product-search');

const databaseUrl = process.env.SEARCH_TEST_DATABASE_URL;

describe('product search against PostgreSQL', { skip: !databaseUrl }, () => {
  let pool;
  let server;
  let baseUrl;
  const supermarketId = randomUUID();
  const categoryId = randomUUID();
  const slug = `search-test-${supermarketId}`;

  async function insert(externalId, name, overrides = {}) {
    const fields = {
      id: randomUUID(), supermarket_id: supermarketId, category_id: categoryId,
      external_id: externalId, name, price: 2, ...overrides,
    };
    const keys = Object.keys(fields);
    await pool.query(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})`, Object.values(fields));
    return fields;
  }

  async function search(query = {}) {
    const built = buildProductQuery(parseProductQuery({ supermarket: slug, ...query }));
    return (await pool.query(built.text, built.params)).rows;
  }

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = require('../db');
    pool = db.pool;
    await pool.query('INSERT INTO supermarkets (id, name, slug) VALUES ($1, $2, $3)', [supermarketId, slug, slug]);
    await pool.query('INSERT INTO canonical_categories (id, name, slug) VALUES ($1, $2, $3)', [categoryId, slug, slug]);
    await insert('coffee', 'Café', { brand: 'Sical', barcode: '5601234567890' });
    await insert('coffee-capsules', 'Cápsulas de café', { price: 1 });
    await insert('description', 'Bolacha de aveia', { description: 'Aromatizada com café' });
    await insert('milk', 'Leite sem lactose Mimosa 1L', { brand: 'Mimosa', unit_price: 1.5, unit_price_unit: 'l' });
    await insert('milk-other', 'Leite magro', { price: 1 });
    await insert('apple', 'Maçãs vermelhas', { brand: 'Fruta' });
    await insert('expired', 'Café expirado', { valid_to: '2000-01-01' });
    await insert('future', 'Café futuro', { valid_from: '2999-01-01' });
    await insert('loyalty', 'Café cartão', { requires_loyalty_card: true });
    await insert('unknown', 'Café preço desconhecido', { price: 0 });
    await insert('deleted', 'Café removido', { deleted: true });
    await insert('out-of-stock', 'Café esgotado', { in_stock: false });

    const express = require('express');
    const app = express();
    app.use('/api/products', require('../products'));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api/products`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) {
      await pool.query('DELETE FROM supermarkets WHERE id = $1', [supermarketId]);
      await pool.query('DELETE FROM canonical_categories WHERE id = $1', [categoryId]);
      await pool.end();
    }
  });

  test('accent-insensitive search ranks exact names ahead of cheaper incidental matches', async () => {
    const rows = await search({ q: 'CAFE' });
    assert.equal(rows[0].external_id, 'coffee');
    assert.deepEqual(new Set(rows.map((row) => row.external_id)), new Set(['coffee', 'coffee-capsules', 'description']));
    assert.equal((await search({ q: 'cafe\u0301' }))[0].external_id, 'coffee');
    assert.equal((await search({ q: 'maca' }))[0].external_id, 'apple');
  });

  test('word order, brand, Portuguese inflections and partial words work together', async () => {
    assert.equal((await search({ q: 'mimosa lact lei' }))[0].external_id, 'milk');
    assert.equal((await search({ q: 'leite lactose' }))[0].external_id, 'milk');
    assert.equal((await search({ q: 'sical' }))[0].external_id, 'coffee');
    assert.equal((await search({ q: '5601234567890' }))[0].external_id, 'coffee');
    assert.deepEqual(await search({ q: 'leite cafe' }), []);
  });

  test('stopwords, symbols and SQL-like input never turn into a broad search', async () => {
    assert.deepEqual(await search({ q: 'o de a' }), []);
    assert.deepEqual(await search({ q: "' | ! :*" }), []);
    assert.deepEqual(await search({ q: "cafe' OR 1=1 --" }), []);
  });

  test('offer validity and loyalty constraints also apply when browsing', async () => {
    const rows = await search();
    for (const externalId of ['expired', 'future', 'loyalty', 'unknown', 'deleted', 'out-of-stock']) {
      assert.ok(!rows.some((row) => row.external_id === externalId), externalId);
    }
    assert.ok((await search({ q: 'cafe', include_loyalty: 'true' })).some((row) => row.external_id === 'loyalty'));
  });

  test('filters and pagination use a stable order across pages', async () => {
    const all = await search({ q: 'cafe', sort: 'price_asc' });
    const first = await search({ q: 'cafe', sort: 'price_asc', limit: '1' });
    const second = await search({ q: 'cafe', sort: 'price_asc', limit: '1', offset: '1' });
    assert.equal(first[0].id, all[0].id);
    assert.equal(second[0].id, all[1].id);
    assert.deepEqual(await search({ q: 'cafe', category: 'missing-category' }), []);
    assert.equal((await search({ q: 'cafe', category: slug })).length, 3);
  });

  test('HTTP endpoints preserve arrays, expose provenance and reject invalid input', async () => {
    const response = await fetch(`${baseUrl}/compare?name=cafe&supermarket=${slug}`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.ok(Array.isArray(rows));
    assert.equal(rows[0].external_id, 'coffee');
    for (const field of ['barcode', 'regular_price', 'source_type', 'source_url', 'store_location', 'observed_at', 'metadata', 'requires_loyalty_card']) {
      assert.ok(Object.hasOwn(rows[0], field), field);
    }
    assert.equal(response.headers.get('x-result-limit'), '50');
    for (const suffix of ['?limit=-1', '?offset=2abc', '?q[]=cafe', '/compare', '?include_loyalty=perhaps']) {
      assert.equal((await fetch(`${baseUrl}${suffix}`)).status, 400, suffix);
    }
    const detail = await fetch(`${baseUrl}/${rows[0].id}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).barcode, '5601234567890');
  });

  test('search backfill is repeatable and preserves sync timestamps and price history', async () => {
    const snapshot = async () => (await pool.query(`SELECT p.id, p.updated_at, p.last_scraped_at,
      (SELECT count(*)::int FROM price_history h WHERE h.product_id = p.id) AS history
      FROM products p WHERE p.supermarket_id = $1 ORDER BY p.id`, [supermarketId])).rows;
    const beforeRows = await snapshot();
    await pool.query(await readFile(path.join(__dirname, '../../database/migrations/004_product_search.sql'), 'utf8'));
    assert.deepEqual(await snapshot(), beforeRows);
    assert.equal((await search({ q: 'cafe' }))[0].external_id, 'coffee');
  });
});
