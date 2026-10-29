const NUTRIENTS = {
  calories: 'Energia', energy: 'Energia', energycontent: 'Energia', energia: 'Energia',
  fat: 'Lípidos', totalfat: 'Lípidos', fatcontent: 'Lípidos', lipidos: 'Lípidos', gorduras: 'Lípidos',
  saturatedfat: 'dos quais saturados', saturatedfatcontent: 'dos quais saturados', saturates: 'dos quais saturados', saturados: 'dos quais saturados',
  carbohydrates: 'Hidratos de carbono', carbohydrate: 'Hidratos de carbono', carbohydratecontent: 'Hidratos de carbono', hidratosdecarbono: 'Hidratos de carbono',
  sugar: 'dos quais açúcares', sugars: 'dos quais açúcares', sugarcontent: 'dos quais açúcares', acucares: 'dos quais açúcares',
  fiber: 'Fibra', fibre: 'Fibra', fibercontent: 'Fibra', fibra: 'Fibra',
  protein: 'Proteínas', proteincontent: 'Proteínas', proteinas: 'Proteínas',
  salt: 'Sal', saltcontent: 'Sal', sal: 'Sal',
  sodium: 'Sódio', sodiumcontent: 'Sódio', sodio: 'Sódio',
  cholesterol: 'Colesterol', cholesterolcontent: 'Colesterol', colesterol: 'Colesterol',
  transfat: 'Gorduras trans', transfatcontent: 'Gorduras trans',
};

function cleanText(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value !== 'string') return '';
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/p\s*>|<\/li\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity]))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function publishedText(value) {
  if (Array.isArray(value)) return value.map(publishedText).filter(Boolean).join('; ');
  if (value && typeof value === 'object') {
    const text = publishedText(value.text ?? value.value ?? value['@value'] ?? value.name);
    const unit = cleanText(value.unitText ?? value.unit);
    return text && unit && !text.endsWith(unit) ? `${text} ${unit}` : text;
  }
  return cleanText(value);
}

const nutrientKey = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

function formatProductInformation(product, details) {
  const metadata = details?.metadata && typeof details.metadata === 'object' ? details.metadata : {};
  let nutrition = metadata.nutrition || metadata.nutritionInformation;
  if (typeof nutrition === 'string' && /^[\[{]/.test(nutrition.trim())) {
    try { nutrition = JSON.parse(nutrition); } catch { nutrition = null; }
  }
  const nutritionObject = nutrition && typeof nutrition === 'object' && !Array.isArray(nutrition) ? nutrition : {};
  const nutritionRows = [];
  const addNutrient = (name, value) => {
    const label = NUTRIENTS[nutrientKey(name)];
    const text = publishedText(value);
    if (label && text && !nutritionRows.some((row) => row.label === label && row.value === text)) nutritionRows.push({ label, value: text });
  };
  if (Array.isArray(nutrition)) {
    for (const entry of nutrition) {
      if (entry && typeof entry === 'object') addNutrient(entry.name || entry.label || entry.nutrient, { value: entry.value ?? entry.amount ?? entry.text, unitText: entry.unitText || entry.unit });
    }
  } else {
    for (const [name, value] of Object.entries(nutritionObject)) addNutrient(name, value);
  }
  const sourceCandidates = [metadata.detail_source_url, product?.url, product?.sourceUrl, details?.url, details?.source_url];
  return {
    description: publishedText(product?.description) || publishedText(details?.description),
    barcode: cleanText(product?.barcode) || cleanText(details?.barcode),
    ingredients: publishedText(metadata.ingredients) || publishedText(metadata.ingredient),
    allergens: publishedText(metadata.allergens) || publishedText(metadata.allergen),
    nutritionText: typeof nutrition === 'string' ? cleanText(nutrition) : '',
    nutritionRows,
    nutritionBasis: publishedText(nutritionObject.basis || nutritionObject.per || metadata.nutrition_basis || metadata.basis),
    servingSize: publishedText(nutritionObject.servingSize || nutritionObject.serving_size || metadata.servingSize || metadata.serving_size),
    sourceUrl: sourceCandidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim()))?.trim() || '',
  };
}

function formatInformationForProduct(product, response) {
  // The modal is mounted before any product is selected. Two absent IDs must
  // not be treated as a matching response, or startup dereferences null.data.
  const details = product?.id && response?.productId === product.id ? response.data : null;
  return formatProductInformation(product, details);
}

module.exports = { cleanText, formatProductInformation, formatInformationForProduct };
