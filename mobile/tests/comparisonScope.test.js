const test = require('node:test');
const assert = require('node:assert/strict');
const { selectComparisonContexts, isInComparisonContext } = require('../src/utils/comparisonScope.js');

const scope = (storeLocation, productCount, latestObservedAt = 0, extra = {}) => ({
  supermarketId: 'mercadona', storeLocation, productCount, latestObservedAt, ...extra,
});

test('comparison prefers a public catalogue over branch observations from the same chain', () => {
  const contexts = selectComparisonContexts([scope('Porto · Loja A', 100, 10), scope(null, 10, 1), scope('Lisboa · Loja B', 200, 20)]);
  assert.deepEqual(contexts, [{ supermarketId: 'mercadona', storeLocation: null, label: 'Catálogo público' }]);
});

test('one branch per chain is selected by coverage, then observation date, then stable name', () => {
  assert.equal(selectComparisonContexts([scope('Porto', 10, 20), scope('Lisboa', 20, 1)])[0].storeLocation, 'Lisboa');
  assert.equal(selectComparisonContexts([scope('Porto', 20, 20), scope('Lisboa', 20, 1)])[0].storeLocation, 'Porto');
  assert.equal(selectComparisonContexts([scope('Porto', 20, 20), scope('Lisboa', 20, 20)])[0].storeLocation, 'Lisboa');
  assert.equal(selectComparisonContexts([scope('Lisboa', 20, 20), scope('Porto', 20, 20)])[0].storeLocation, 'Lisboa');
});

test('contexts are independent across chains and support raw SQLite aggregate rows', () => {
  assert.deepEqual(selectComparisonContexts([
    { supermarket_id: 'b', store_location: ' Braga ', product_count: 2, latest_observed_at: 3 },
    { supermarket_id: 'a', store_location: null, product_count: 4, latest_observed_at: 5 },
    { supermarket_id: 'c', store_location: 'Porto', product_count: 0 },
  ]), [
    { supermarketId: 'a', storeLocation: null, label: 'Catálogo público' },
    { supermarketId: 'b', storeLocation: 'Braga', label: 'Braga' },
  ]);
});

test('unlocated observations cannot become a public catalogue context', () => {
  assert.deepEqual(selectComparisonContexts([
    scope(null, 100, 20, { sourceType: 'manual' }),
    scope('', 200, 30, { sourceType: 'receipt' }),
  ]), []);
});

test('every matched product must belong to the chosen branch of the chosen chain', () => {
  const context = { supermarketId: 'mercadona', storeLocation: 'Porto · Loja A' };
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona', storeLocation: 'Porto · Loja A', sourceType: 'manual' }, context), true);
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona', storeLocation: 'Lisboa · Loja B' }, context), false);
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona', storeLocation: null }, context), false);
  assert.equal(isInComparisonContext({ supermarketId: 'auchan', storeLocation: 'Porto · Loja A' }, context), false);
});

test('public scopes accept legacy/public catalogues and exclude unlocated receipts/manual prices', () => {
  const context = { supermarketId: 'mercadona', storeLocation: null };
  assert.equal(isInComparisonContext({ supermarket_id: 'mercadona', store_location: null, source_type: 'online_catalog' }, context), true);
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona' }, context), true);
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona', sourceType: 'manual' }, context), false);
  assert.equal(isInComparisonContext({ supermarketId: 'mercadona', sourceType: 'receipt' }, context), false);
});

test('basket context never combines the cheapest articles from Porto and Lisboa', () => {
  const [context] = selectComparisonContexts([scope('Porto', 2, 20), scope('Lisboa', 2, 10)]);
  const offers = [
    { supermarketId: 'mercadona', storeLocation: 'Porto', article: 'leite', price: 1 },
    { supermarketId: 'mercadona', storeLocation: 'Porto', article: 'arroz', price: 4 },
    { supermarketId: 'mercadona', storeLocation: 'Lisboa', article: 'leite', price: 5 },
    { supermarketId: 'mercadona', storeLocation: 'Lisboa', article: 'arroz', price: 1 },
  ];
  const selected = offers.filter((offer) => isInComparisonContext(offer, context));
  assert.equal(selected.reduce((total, offer) => total + offer.price, 0), 5);
  assert.deepEqual([...new Set(selected.map((offer) => offer.storeLocation))], ['Porto']);
  assert.equal(isInComparisonContext(offers[3], context), false, 'a direct source/cheaper exact barcode in Lisboa cannot bypass the selected Porto scope');
});
