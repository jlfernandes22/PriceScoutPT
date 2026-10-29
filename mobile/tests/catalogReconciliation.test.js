const test = require('node:test');
const assert = require('node:assert/strict');
const {
  productIdentity, requiresCatalogSnapshot, planCatalogReconciliation,
} = require('../src/utils/catalogReconciliation.js');

const product = (id, external_id = 'milk', supermarket_id = 'shop') => ({ id, external_id, supermarket_id });
const favorite = (id, product_id) => ({ id, product_id });
const item = (id, product_id, quantity, list_id = 'weekly') => ({ id, product_id, quantity, list_id });
const remote = (...products) => new Map(products.map((record) => [productIdentity(record), record.id]));

test('legacy installs and changed endpoints require a completed snapshot before advancing their source marker', () => {
  const source = JSON.stringify({ version: 1, endpoint: 'https://old.example' });
  assert.equal(requiresCatalogSnapshot(null, 'https://old.example', '6', 1234), true);
  assert.equal(requiresCatalogSnapshot('broken', 'https://old.example', '6', 1234), true);
  assert.equal(requiresCatalogSnapshot(source, 'https://new.example', '6', 1234), true);
  assert.equal(requiresCatalogSnapshot(source, 'https://old.example/', '6', 1234), false);
  assert.equal(requiresCatalogSnapshot(source, 'https://old.example', '5', 1234), true);
  assert.equal(requiresCatalogSnapshot(source, 'https://old.example', '6', 0), true);
});

test('exact retailer identities distinguish stores and external IDs without guessing by product name', () => {
  assert.notEqual(productIdentity(product('a', 'milk', 'one')), productIdentity(product('b', 'milk', 'two')));
  assert.notEqual(productIdentity(product('a', 'milk')), productIdentity(product('b', 'Milk')));
  assert.notEqual(productIdentity(product('a', 'a,b', 'c')), productIdentity(product('b', 'b', 'c,a')));
  assert.equal(productIdentity({ id: 'missing-identity' }), null);
});

test('a restored catalogue relinks favorites and every basket without changing quantities or list identity', () => {
  const plan = planCatalogReconciliation([product('old')], remote(product('new')),
    [favorite('fav', 'old')], [item('list-one', 'old', 3), item('list-two', 'old', 2, 'party')]);
  assert.deepEqual(plan.favoriteUpdates, [{ id: 'fav', productId: 'new' }]);
  assert.deepEqual(plan.itemUpdates, [
    { id: 'list-one', productId: 'new', quantity: 3 }, { id: 'list-two', productId: 'new', quantity: 2 },
  ]);
  assert.deepEqual(plan.deleteProductIds, ['old']);
  assert.deepEqual(plan.unavailableProductIds, []);
});

test('matching old and new UUIDs merge duplicate selections while preserving total basket quantities', () => {
  const plan = planCatalogReconciliation([product('old'), product('older')], remote(product('new')),
    [favorite('a-old-favorite', 'old'), favorite('z-current-favorite', 'new'), favorite('b-older-favorite', 'older')],
    [item('a-old-item', 'old', 2), item('z-current-item', 'new', 4), item('b-older-item', 'older', 3)]);
  assert.deepEqual(plan.favoriteUpdates, []);
  assert.deepEqual(plan.favoriteDeletes.sort(), ['a-old-favorite', 'b-older-favorite']);
  assert.deepEqual(plan.itemUpdates, [{ id: 'z-current-item', productId: 'new', quantity: 9 }]);
  assert.deepEqual(plan.itemDeletes.sort(), ['a-old-item', 'b-older-item']);
  assert.deepEqual(plan.deleteProductIds.sort(), ['old', 'older']);
});

test('missing referenced products survive as unavailable while unreferenced stale rows can be removed', () => {
  const stale = [product('favorite-only', 'one'), product('basket-only', 'two'), product('unused', 'three')];
  const plan = planCatalogReconciliation(stale, new Map(), [favorite('f', 'favorite-only')], [item('i', 'basket-only', 5)]);
  assert.deepEqual(plan.unavailableProductIds.sort(), ['basket-only', 'favorite-only']);
  assert.deepEqual(plan.deleteProductIds, ['unused']);
  assert.deepEqual(plan.favoriteUpdates, []);
  assert.deepEqual(plan.favoriteDeletes, []);
  assert.deepEqual(plan.itemUpdates, []);
  assert.deepEqual(plan.itemDeletes, []);
});

test('a same-named product with a different external identity never absorbs user references', () => {
  const plan = planCatalogReconciliation([product('old', 'old-code')], remote(product('new', 'different-code')),
    [favorite('f', 'old')], [item('i', 'old', 2)]);
  assert.deepEqual(plan.unavailableProductIds, ['old']);
  assert.deepEqual(plan.favoriteUpdates, []);
  assert.deepEqual(plan.itemUpdates, []);
});

test('reference merging leaves unrelated existing favorites and baskets untouched', () => {
  const plan = planCatalogReconciliation([product('old')], remote(product('new')),
    [favorite('old-f', 'old'), favorite('other-f', 'other'), favorite('other-f2', 'other')],
    [item('old-i', 'old', 2), item('other-i', 'other', 7), item('other-i2', 'other', 3)]);
  assert.deepEqual(plan.favoriteDeletes, []);
  assert.deepEqual(plan.itemDeletes, []);
  assert.deepEqual(plan.itemUpdates, [{ id: 'old-i', productId: 'new', quantity: 2 }]);
});
