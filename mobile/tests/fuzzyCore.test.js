const test = require('node:test');
const assert = require('node:assert');
const {
  normalize,
  contentTokens,
  getSimilarity,
  getMandatoryKeyword,
  significantTokens,
  likeVariants,
  getDietaryQualifiers,
  haveCompatibleDietaryQualifiers,
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

test('dietary matching rejects contradictory and unlabelled candidates for explicit restrictions', () => {
  for (const [restricted, ordinary] of [
    ['Leite sem lactose', 'Leite com lactose'],
    ['Leite sem lactose', 'Leite magro'],
    ['Pão sem glúten', 'Pão integral'],
    ['Bolachas sem açúcar', 'Bolachas com açúcar'],
    ['Cerveja sem álcool', 'Cerveja tradicional'],
    ['Manteiga sem sal', 'Manteiga com sal'],
  ]) {
    assert.strictEqual(haveCompatibleDietaryQualifiers(restricted, ordinary), false, `${restricted} vs ${ordinary}`);
    assert.strictEqual(haveCompatibleDietaryQualifiers(ordinary, restricted), false, 'a guarda é simétrica');
  }
});

test('dietary matching recognizes equivalent explicit labels without inferring suitability', () => {
  assert.strictEqual(haveCompatibleDietaryQualifiers('Bolachas zero açúcar', 'Bolachas sem açúcar'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Bolachas 0% açúcar', 'Bolachas sem açúcares'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Leite isento de lactose', 'Leite sem lactose'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Pão gluten-free', 'Pão sem glúten'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Cerveja 0,0% de álcool', 'Cerveja sem álcool'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Manteiga s/ sal', 'Manteiga sem sal'), true);
  assert.deepStrictEqual(getDietaryQualifiers('Arroz Agulha Integral'), {});
  assert.strictEqual(haveCompatibleDietaryQualifiers('Arroz Agulha', 'Arroz Integral'), true);
});

test('no-added and reduced claims stay distinct from free-of claims', () => {
  assert.deepStrictEqual(getDietaryQualifiers('Sumo sem adição de açúcar'), { sugar: 'no_added' });
  assert.strictEqual(haveCompatibleDietaryQualifiers('Sumo sem adição de açúcar', 'Sumo sem açúcares adicionados'), true);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Sumo sem adição de açúcar', 'Sumo sem açúcar'), false);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Sopa baixo teor de sal', 'Sopa sem sal'), false);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Iogurte menos açúcar', 'Iogurte natural'), false);
  assert.strictEqual(haveCompatibleDietaryQualifiers('Pão sem glúten e sem lactose', 'Pão sem glúten'), false);
});
