const test = require('node:test');
const assert = require('node:assert/strict');
const { createProductSearchIndex, normalizeSearch, searchTokens, isOneTypo } = require('../src/utils/searchCore.js');

const now = Date.UTC(2026, 9, 29, 12);
const product = (id, name, extra = {}) => ({
  id, name, price: 2, supermarketId: 'continente', categoryId: 'mercearia',
  inStock: true, deleted: false, ...extra,
});
const search = (index, query, options = {}) => index.search(query, { now, ...options });

test('normalizes Portuguese accents, punctuation and quantities without discarding sem', () => {
  assert.equal(normalizeSearch('CAFÉ com Açúcar · 500 gr'), 'cafe com acucar 500g');
  assert.deepEqual(searchTokens('Leite de Aveia sem açúcar 1 L', true), ['leite', 'aveia', 'sem', 'acucar', '1l']);
  assert.equal(normalizeSearch('Água 1,5 lt'), 'agua 1.5l');
});

test('searches every query word in any order across product names, brands and units', () => {
  const index = createProductSearchIndex([
    product('a', 'Leite Magro', { brand: 'Mimosa', unit: '1L' }),
    product('b', 'Leite Meio Gordo', { brand: 'Mimosa', unit: '1 L' }),
    product('c', 'Leite Magro', { brand: 'Continente', unit: '1,5 L' }),
  ]);
  assert.deepEqual(search(index, 'MIMOSA magro 1 l').ids, ['a']);
  assert.deepEqual(search(index, 'leite mim').ids, ['a', 'b']);
  assert.deepEqual(search(index, 'leite 1,5L').ids, ['c']);
});

test('accent-free queries match names with several accents and uppercase accented letters', () => {
  const index = createProductSearchIndex([
    product('a', 'AÇÚCAR mascavado'), product('b', 'Café de São Tomé'), product('c', 'Maçã Reineta'),
  ]);
  assert.deepEqual(search(index, 'acucar').ids, ['a']);
  assert.deepEqual(search(index, 'sao cafe tome').ids, ['b']);
  assert.deepEqual(search(index, 'maçã').ids, ['c']);
});

test('preserves dietary qualifiers and requires all query tokens', () => {
  const index = createProductSearchIndex([
    product('a', 'Leite sem lactose'), product('b', 'Leite com lactose'), product('c', 'Iogurte sem lactose'),
  ]);
  assert.deepEqual(search(index, 'leite sem lactose').ids, ['a']);
  assert.deepEqual(search(index, 'leite lactose').ids, ['b', 'a']);
  assert.deepEqual(search(index, 'leite glúten').ids, []);
});

test('looks up barcodes exactly without correcting digits', () => {
  const index = createProductSearchIndex([product('a', 'Café', { barcode: '5601234567890' })]);
  assert.deepEqual(search(index, '5601234567890').ids, ['a']);
  assert.deepEqual(search(index, '5601234567891').ids, []);
});

test('typo fallback handles substitutions, missing letters and transpositions, clearly marked', () => {
  const index = createProductSearchIndex([product('a', 'Leite Magro'), product('b', 'Iogurte Natural')]);
  for (const query of ['leitw', 'leiet', 'lete', 'leeite']) {
    const result = search(index, query);
    assert.deepEqual(result.ids, ['a'], query);
    assert.equal(result.approximate, true, query);
  }
  assert.equal(search(index, 'leite').approximate, false);
  assert.deepEqual(search(index, 'leite magor').ids, ['a']);
  assert.equal(isOneTypo('leite', 'leiet'), true);
  assert.equal(isOneTypo('leite', 'ligth'), false);
});

test('does not mix approximate results into exact matches or correct short words', () => {
  const index = createProductSearchIndex([
    product('a', 'Café sem açúcar'), product('b', 'Capa de papel'), product('c', 'Sol'),
  ]);
  assert.deepEqual(search(index, 'cafe').ids, ['a']);
  assert.deepEqual(search(index, 'sal').ids, []);
  assert.deepEqual(search(index, 'cafe com acucar').ids, []);
});

test('ranks across the whole catalogue before pagination', () => {
  const rows = Array.from({ length: 100 }, (_, i) => product(`dessert-${i}`, `Bola ${i} com leite`));
  const index = createProductSearchIndex([...rows, product('best', 'Leite Magro')]);
  const result = search(index, 'leite', { limit: 3 });
  assert.equal(result.total, 101);
  assert.equal(result.ids.length, 3);
  assert.equal(result.ids[0], 'best');
  assert.deepEqual(search(index, 'leite', { limit: 2 }).ids, result.ids.slice(0, 2));
});

test('alphabetical browsing handles Portuguese names and stable ties across the whole catalogue', () => {
  const index = createProductSearchIndex([
    product('z', 'Zebra'), product('water-b', 'ÁGUA'), product('acai', 'Açaí'),
    product('water-a', 'Água'), product('sugar', 'Açúcar'),
  ]);
  assert.deepEqual(search(index, '', { sort: 'name' }).ids, ['acai', 'sugar', 'water-a', 'water-b', 'z']);
  assert.deepEqual(search(index, '', { sort: 'name', limit: 3 }).ids, ['acai', 'sugar', 'water-a']);
});

test('applies store/category filters and global price sort before taking a page', () => {
  const index = createProductSearchIndex([
    product('a', 'Leite A', { price: 3 }),
    product('b', 'Leite B', { price: 1, supermarketId: 'auchan' }),
    product('c', 'Leite C', { price: 2 }),
    product('d', 'Leite D', { price: 0.5, categoryId: 'frescos' }),
  ]);
  assert.deepEqual(search(index, 'leite', { sort: 'price_asc', limit: 2 }).ids, ['d', 'b']);
  assert.deepEqual(search(index, 'leite', { sort: 'price_desc', limit: 2 }).ids, ['a', 'c']);
  assert.deepEqual(search(index, 'leite', { supermarketId: 'continente', categoryId: 'mercearia' }).ids, ['a', 'c']);
});

test('excludes deleted, unavailable, invalid-price, expired, future and card offers by default', () => {
  const index = createProductSearchIndex([
    product('current', 'Arroz Agulha'),
    product('deleted', 'Arroz Carolino', { deleted: true }),
    product('unavailable', 'Arroz Integral', { inStock: false }),
    product('zero', 'Arroz Zero', { price: 0 }),
    product('nan', 'Arroz Inválido', { price: 'not a price' }),
    product('expired', 'Arroz Velho', { validTo: now - 1 }),
    product('future', 'Arroz Futuro', { validFrom: now + 1 }),
    product('loyalty', 'Arroz com Cartão', { requiresLoyaltyCard: true }),
  ]);
  assert.deepEqual(search(index, 'arroz').ids, ['current']);
  assert.deepEqual(search(index, 'arroz', { includeLoyalty: true }).ids, ['current', 'loyalty']);
  assert.deepEqual(search(index, 'arroz', { now: now + 2 }).ids, ['current', 'future']);
});

test('offers remain valid through their inclusive validity boundary', () => {
  const index = createProductSearchIndex([product('a', 'Arroz', { validFrom: now, validTo: now })]);
  assert.deepEqual(search(index, 'arroz').ids, ['a']);
  assert.deepEqual(search(index, 'arroz', { now: now + 1 }).ids, []);
});

test('updates and removals immediately repair postings, prices and filters', () => {
  const index = createProductSearchIndex([product('a', 'Leite'), product('b', 'Arroz')]);
  index.upsert(product('a', 'Café', { supermarketId: 'auchan', categoryId: 'bebidas', price: 1 }));
  assert.deepEqual(search(index, 'leite').ids, []);
  assert.deepEqual(search(index, 'cafe').ids, ['a']);
  assert.ok(index.filters(now).supermarketIds.has('auchan'));
  assert.ok(index.filters(now).categoryIds.has('bebidas'));
  index.upsert(product('a', 'Café', { deleted: true }));
  assert.deepEqual(search(index, 'cafe').ids, []);
  assert.ok(!index.filters(now).supermarketIds.has('auchan'));
  index.remove('b');
  assert.equal(index.size, 0);
  assert.deepEqual(search(index, '').ids, []);
});

test('filter discovery includes card-only stores but omits stores with no current prices', () => {
  const index = createProductSearchIndex([
    product('a', 'Leite', { supermarketId: 'card-store', requiresLoyaltyCard: true }),
    product('b', 'Arroz', { supermarketId: 'expired-store', validTo: now - 1 }),
  ]);
  assert.deepEqual([...index.filters(now).supermarketIds], ['card-store']);
});

test('empty and stopword-only queries are deterministic and never match arbitrary wildcards', () => {
  const index = createProductSearchIndex([product('b', 'Leite de Aveia'), product('a', 'Arroz')]);
  assert.deepEqual(search(index, '').ids, ['a', 'b']);
  assert.deepEqual(search(index, 'de').ids, ['b']);
  assert.deepEqual(search(index, '%_').ids, ['a', 'b']);
});
