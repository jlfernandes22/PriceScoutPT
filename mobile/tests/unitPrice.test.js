const test = require('node:test');
const assert = require('node:assert');
const {
  parseUnit,
  computeUnitPrice,
  formatEuro,
  formatUnitPrice,
} = require('../src/utils/unitPrice.js');

test('parseUnit: peso em gramas', () => {
  const u = parseUnit('emb. 300 gr', 'x');
  assert.strictEqual(u.type, 'weight');
  assert.strictEqual(u.baseQty, 300);
});

test('parseUnit: litros com vírgula', () => {
  const u = parseUnit('1,5 l', 'x');
  assert.strictEqual(u.type, 'volume');
  assert.strictEqual(u.baseQty, 1500);
});

test('parseUnit: multi-pack 12 x 330 ml', () => {
  const u = parseUnit('12 x 330 ml', 'x');
  assert.ok(u.multi);
  assert.strictEqual(u.baseQty, 12 * 330);
  assert.strictEqual(u.type, 'volume');
});

test('parseUnit: multi-pack com contagem 1 (1 x 500 g)', () => {
  // Regressão: antes devolvia null — o gate `count * baseQty > baseQty`
  // rejeitava count=1 e o fallback casava com "1 x" (unidade desconhecida).
  const u = parseUnit('1 x 500 g', 'x');
  assert.ok(u, 'devolve resultado para "1 x 500 g"');
  assert.strictEqual(u.type, 'weight');
  assert.strictEqual(u.baseQty, 500);
});

test('parseUnit: unidades', () => {
  const u = parseUnit('emb. 4 un', 'x');
  assert.strictEqual(u.type, 'count');
  assert.strictEqual(u.baseQty, 4);
});

test('parseUnit: fallback no nome do produto', () => {
  const u = parseUnit('', 'Água de Nascente Garrafa 1.5 L');
  assert.strictEqual(u.type, 'volume');
  assert.strictEqual(u.baseQty, 1500);
});

test('parseUnit: sem unidade reconhecível', () => {
  assert.strictEqual(parseUnit('saco', 'produto genérico'), null);
});

test('computeUnitPrice: €/kg', () => {
  const info = computeUnitPrice('2.99', 'emb. 300 gr', 'x');
  assert.strictEqual(info.label, '€/kg');
  assert.ok(Math.abs(info.per - 2.99 / 0.3) < 1e-9);
});

test('computeUnitPrice: €/l', () => {
  const info = computeUnitPrice('1.50', '1,5 l', 'x');
  assert.strictEqual(info.label, '€/l');
  assert.strictEqual(info.per, 1);
});

test('computeUnitPrice: €/un', () => {
  const info = computeUnitPrice('3.99', 'emb. 3 un', 'x');
  assert.strictEqual(info.label, '€/un');
  assert.strictEqual(info.per, 1.33);
});

test('formatEuro: estilo português', () => {
  assert.strictEqual(formatEuro(12.5), '12,50 €');
  assert.strictEqual(formatEuro('abc'), '—');
});

test('formatUnitPrice', () => {
  assert.strictEqual(formatUnitPrice('2.99', 'emb. 300 gr', 'x'), '9,97 €/kg');
});
