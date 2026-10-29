const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InvalidProductQuery, normalizeSearch, parseProductQuery, buildProductQuery } = require('../product-search');

test('search normalization handles accents, decomposed input, punctuation and spacing', () => {
  assert.equal(normalizeSearch('  CAFÉ, AÇÚCAR / Maçã!  '), 'cafe acucar maca');
  assert.equal(normalizeSearch('cafe\u0301'), 'cafe');
  assert.equal(normalizeSearch('1,5L + sem-lactose'), '1 5l sem lactose');
});

test('existing compare and browse parameters remain supported', () => {
  assert.equal(parseProductQuery({ name: ' Café ' }, true).text, 'cafe');
  assert.equal(parseProductQuery({ search: 'leite' }).text, 'leite');
  assert.equal(parseProductQuery({ q: 'leite' }).sort, 'relevance');
  assert.equal(parseProductQuery({}).sort, 'name');
  assert.equal(parseProductQuery({ limit: '200', offset: '0' }).limit, 200);
});

test('invalid pagination, repeated parameters and excessive queries fail before SQL', () => {
  for (const query of [
    { limit: '-1' }, { limit: '0' }, { limit: '201' }, { limit: '10abc' },
    { offset: '-1' }, { offset: '1.5' }, { offset: '100001' },
    { q: ['leite', 'cafe'] }, { supermarket: { slug: 'lidl' } },
    { limit: ['10'] }, { sort: 'price; DROP TABLE products' },
    { q: 'x'.repeat(161) }, { q: Array(13).fill('leite').join(' ') },
    { include_loyalty: 'yes' },
  ]) {
    assert.throws(() => parseProductQuery(query), InvalidProductQuery, JSON.stringify(query));
  }
  assert.throws(() => parseProductQuery({}, true), InvalidProductQuery);
  assert.throws(() => parseProductQuery({ name: '  ' }, true), InvalidProductQuery);
});

test('query text and filters are bound, with active offer and loyalty constraints', () => {
  const attack = "x' OR true --";
  const query = buildProductQuery(parseProductQuery({ q: attack, supermarket: attack, category: attack }));
  assert.ok(!query.text.includes(attack));
  assert.ok(query.params.includes(attack));
  assert.match(query.text, /p\.price > 0/);
  assert.match(query.text, /p\.requires_loyalty_card = false/);
  assert.match(query.text, /p\.valid_to >= now\(\)/);
  assert.match(query.text, /p\.id ASC/);
  const loyaltyQuery = buildProductQuery(parseProductQuery({ include_loyalty: 'true' }));
  assert.ok(!loyaltyQuery.text.includes('p.requires_loyalty_card = false'));
});
