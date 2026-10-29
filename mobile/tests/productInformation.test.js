const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, formatProductInformation, formatInformationForProduct } = require('../src/utils/productInformation.js');

test('closed product modal renders safely before a product or detail response exists', () => {
  const information = formatInformationForProduct(null, null);
  assert.equal(information.description, '');
  assert.equal(information.barcode, '');
  assert.deepEqual(information.nutritionRows, []);
  assert.equal(formatInformationForProduct(undefined, undefined).ingredients, '');
});

test('only a response for the currently selected product supplies online details', () => {
  const response = { productId: 'old-product', data: { metadata: { ingredients: 'Published ingredients' } } };
  assert.equal(formatInformationForProduct({ id: 'new-product', description: 'Offline description' }, response).ingredients, '');
  assert.equal(formatInformationForProduct(null, response).ingredients, '');
  assert.equal(formatInformationForProduct({ id: 'old-product' }, response).ingredients, 'Published ingredients');
});

test('product description and barcode remain available without a network response', () => {
  const info = formatProductInformation({ description: '<p>Arroz <b>integral</b> &amp; legumes.</p>', barcode: '5601234567890' });
  assert.equal(info.description, 'Arroz integral & legumes.');
  assert.equal(info.barcode, '5601234567890');
  assert.equal(info.ingredients, '');
  assert.deepEqual(info.nutritionRows, []);
});

test('published schema.org nutrition uses human labels and preserves supplied dose and basis', () => {
  const info = formatProductInformation({}, { metadata: {
    ingredients: ['Leite', { name: 'Cacau' }], allergens: 'Contém leite.',
    nutrition: { '@type': 'NutritionInformation', energyContent: '350 kcal', proteinContent: { value: 12, unitText: 'g' }, servingSize: '30 g', basis: 'Por 100 g', debug: 'not public product information' },
  } });
  assert.equal(info.ingredients, 'Leite; Cacau');
  assert.equal(info.allergens, 'Contém leite.');
  assert.deepEqual(info.nutritionRows, [{ label: 'Energia', value: '350 kcal' }, { label: 'Proteínas', value: '12 g' }]);
  assert.equal(info.servingSize, '30 g');
  assert.equal(info.nutritionBasis, 'Por 100 g');
});

test('missing serving sizes and units are never invented from a nutrient value', () => {
  const info = formatProductInformation({}, { metadata: { ingredient: 'Arroz', nutritionInformation: { energyContent: 350 } } });
  assert.equal(info.ingredients, 'Arroz');
  assert.equal(info.nutritionRows[0].value, '350');
  assert.equal(info.servingSize, '');
  assert.equal(info.nutritionBasis, '');
});

test('published text and named nutrient arrays display without dumping arbitrary metadata', () => {
  assert.equal(formatProductInformation({}, { metadata: { nutrition: '<p>Por 100 g: energia 350 kcal.</p>' } }).nutritionText, 'Por 100 g: energia 350 kcal.');
  const info = formatProductInformation({}, { metadata: { nutrition: [{ name: 'Sal', value: '0,5', unit: 'g' }, { name: 'internal_id', value: 123 }], properties: { secret: 'omit' } } });
  assert.deepEqual(info.nutritionRows, [{ label: 'Sal', value: '0,5 g' }]);
});

test('cleans feed HTML and only exposes HTTP(S) source links', () => {
  assert.equal(cleanText('<script>omit()</script><p>Ma&#231;&#227; &amp; pêra</p><style>omit</style>'), 'Maçã & pêra');
  assert.equal(formatProductInformation({ url: 'javascript:alert(1)', sourceUrl: 'https://example.com/produto' }).sourceUrl, 'https://example.com/produto');
  assert.equal(formatProductInformation({ url: 'file:///private' }).sourceUrl, '');
});

test('serialized nutrition is interpreted using known labels rather than exposed as raw JSON', () => {
  const info = formatProductInformation({}, { metadata: { nutrition: '{"proteinContent":"5 g","debug":"omit"}', basis: '100 ml' } });
  assert.equal(info.nutritionText, '');
  assert.deepEqual(info.nutritionRows, [{ label: 'Proteínas', value: '5 g' }]);
  assert.equal(info.nutritionBasis, '100 ml');
});
