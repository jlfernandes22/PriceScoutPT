const test = require('node:test');
const assert = require('node:assert');
const {
  normalize,
  contentTokens,
  getSimilarity,
  getMandatoryKeyword,
  significantTokens,
  likeVariants,
} = require('../src/utils/fuzzyCore.js');

test('normalize remove acentos e minúsculas', () => {
  assert.strictEqual(normalize('Camarão Àçúcar Pêra'), 'camarao acucar pera');
  assert.strictEqual(normalize(null), '');
});

test('contentTokens remove marcas, unidades, números e stopwords', () => {
  const tokens = contentTokens('Miolo de Camarão 80/100 Ultracongelado Continente', 'Continente');
  assert.deepStrictEqual(tokens, ['miolo', 'camarao', 'ultracongelado']);
  const t2 = contentTokens('Leite Meio Gordo 1L Pack', 'Mimosa');
  assert.deepStrictEqual(t2, ['leite', 'meio', 'gordo']);
});

test('getSimilarity Jaccard', () => {
  // "Miolo de Camarão 80/100 Ultracongelado Continente" vs "Miolo de Camarão 80/100 Congelado"
  const sim = getSimilarity(
    'Miolo de Camarão 80/100 Ultracongelado Continente', 'Continente',
    'Miolo de Camarão 80/100 Congelado', 'Pescanova'
  );
  assert.strictEqual(sim, 0.5);
  // Produtos diferentes: semelhança baixa
  const low = getSimilarity('Arroz Agulha', 'Seara', 'Miolo de Porco', 'Continente');
  assert.ok(low < 0.3);
});

test('getSimilarity nunca passa de 1 (tokens duplicados deduped)', () => {
  // Regressão: com tokens repetidos a semelhança chegava a 1.5, furando os
  // gates de qualidade do matcher (bestSim >= 0.5).
  const sim = getSimilarity('Arroz Agulha Arroz Agulha', '', 'Arroz Agulha', '');
  assert.ok(sim <= 1, `semelhança deve ser <= 1, foi ${sim}`);
  assert.strictEqual(sim, 1);
});

test('getMandatoryKeyword casa palavras acentuadas (normalizadas)', () => {
  assert.strictEqual(getMandatoryKeyword('Miolo de Camarão 80/100'), 'camarao');
  assert.strictEqual(getMandatoryKeyword('Leite de búfala'), 'bufala');
  assert.strictEqual(getMandatoryKeyword('Ananás em calda'), 'ananas');
  assert.strictEqual(getMandatoryKeyword('Lombo de Salmão'), 'salmao');
  assert.strictEqual(getMandatoryKeyword('Frango assado'), 'frango');
  assert.strictEqual(getMandatoryKeyword('Papel higiénico'), undefined);
});

test('significantTokens devolve os mais longos', () => {
  const tokens = significantTokens('Miolo de Camarão 80/100 Ultracongelado Continente', 'Continente', 3);
  assert.deepStrictEqual(tokens, ['ultracongelado', 'camarao', 'miolo']);
});

test('likeVariants gera variantes acentuadas por posição', () => {
  const variants = likeVariants('camarao');
  assert.ok(variants.includes('camarão'), 'deve incluir a variante com til');
  assert.ok(variants.includes('camarao'), 'inclui o token original');
  // 'miolo' tem vogais (i/o) -> variantes acentuadas existem
  const v2 = likeVariants('miolo');
  assert.ok(v2.length > 1);
  assert.ok(v2.includes('miolo'));
  // Token sem vogais acentuáveis -> apenas o próprio
  assert.deepStrictEqual(likeVariants('ttx'), ['ttx']);
});
