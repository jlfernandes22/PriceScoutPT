// Detecção de peso/volume/unidade de um produto a partir da string de unidade
// (ex: "emb. 300 gr", "12 x 330 ml", "1,5 l", "garrafa 75 cl", "emb. 4 un")
// e cálculo do preço por unidade de referência (€/kg, €/l, €/un).
//
// Isto permite comparar o VALOR real de dois produtos: um pode custar menos,
// mas ter muito menos peso/volume.

const UNIT_TABLE = {
  kg: { type: 'weight', factor: 1000 },
  kilos: { type: 'weight', factor: 1000 },
  kilo: { type: 'weight', factor: 1000 },
  quilos: { type: 'weight', factor: 1000 },
  quilo: { type: 'weight', factor: 1000 },
  g: { type: 'weight', factor: 1 },
  gr: { type: 'weight', factor: 1 },
  gramas: { type: 'weight', factor: 1 },
  grama: { type: 'weight', factor: 1 },
  l: { type: 'volume', factor: 1000 },
  lt: { type: 'volume', factor: 1000 },
  litros: { type: 'volume', factor: 1000 },
  litro: { type: 'volume', factor: 1000 },
  cl: { type: 'volume', factor: 10 },
  ml: { type: 'volume', factor: 1 },
  un: { type: 'count', factor: 1 },
  unid: { type: 'count', factor: 1 },
  unidade: { type: 'count', factor: 1 },
  unidades: { type: 'count', factor: 1 },
};

// Formata um número em estilo português (1.5 -> "1,5").
const ptNum = (n) => String(parseFloat(n.toFixed(3))).replace('.', ',');

const toBaseQty = (qty, unit) => {
  const u = UNIT_TABLE[unit];
  if (!u) return null;
  return { type: u.type, baseQty: qty * u.factor };
};

// Texto amigável da quantidade na unidade base (g/ml/un).
const qtyText = (type, baseQty) => {
  if (type === 'weight') {
    return baseQty >= 1000 ? `${ptNum(baseQty / 1000)} kg` : `${ptNum(baseQty)} g`;
  }
  if (type === 'volume') {
    return baseQty >= 1000 ? `${ptNum(baseQty / 1000)} l` : `${ptNum(baseQty)} ml`;
  }
  return `${ptNum(baseQty)} un`;
};

// Tenta extrair "quantidade unidade" de um texto (ex: "330 ml", "75 cl", "4 un").
const matchQty = (text) => {
  const m = text.match(/(\d+(?:\.\d+)?)\s*([a-z]+)\.?\b/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  const unit = m[2].replace('.', '').toLowerCase();
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const base = toBaseQty(qty, unit);
  if (!base) return null;
  return { qty, unit, ...base };
};

const normalize = (str) =>
  String(str || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.')
    .replace(/[×]/g, 'x')
    .trim();

// Analisa a unidade (com fallback no nome do produto). Devolve null se nada
// reconhecível; caso contrário { type, baseQty, display, multi? }.
export const parseUnit = (unitStr, nameStr) => {
  const s = normalize(unitStr);
  const name = normalize(nameStr);

  const tryString = (str) => {
    if (!str) return null;

    // Multi-pack: "<n> x <qty> <unidade>" (ex: "12 x 330 ml")
    const mp = str.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*([a-z]+)\.?\b/);
    if (mp) {
      const count = parseInt(mp[1], 10);
      const single = matchQty(`${mp[2]} ${mp[3]}`);
      if (count >= 1 && single && count * single.baseQty > single.baseQty) {
        return {
          type: single.type,
          baseQty: single.baseQty * count,
          display: `${count} x ${qtyText(single.type, single.baseQty)}`,
          totalText: `${count} x ${qtyText(single.type, single.baseQty)} (${qtyText(single.type, single.baseQty * count)})`,
          multi: true,
        };
      }
    }

    const single = matchQty(str);
    if (single) {
      return {
        type: single.type,
        baseQty: single.baseQty,
        display: qtyText(single.type, single.baseQty),
        totalText: qtyText(single.type, single.baseQty),
        multi: false,
      };
    }
    return null;
  };

  return tryString(s) || tryString(name) || null;
};

// Preço por unidade de referência: €/kg, €/l ou €/un.
// Devolve { per, label } ou null.
export const computeUnitPrice = (price, unitStr, nameStr) => {
  const parsed = parseUnit(unitStr, nameStr);
  if (!parsed) return null;
  const priceNum = parseFloat(price);
  if (!Number.isFinite(priceNum) || parsed.baseQty <= 0) return null;

  let per;
  let label;
  if (parsed.type === 'weight') {
    per = priceNum / (parsed.baseQty / 1000);
    label = '€/kg';
  } else if (parsed.type === 'volume') {
    per = priceNum / (parsed.baseQty / 1000);
    label = '€/l';
  } else {
    per = priceNum / parsed.baseQty;
    label = '€/un';
  }

  return { per, label, parsed };
};

// Formata um valor monetário em estilo português (12.5 -> "12,50 €").
export const formatEuro = (n) => {
  const value = parseFloat(n);
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2).replace('.', ',')} €`;
};

// Atalho: "13,30 €/kg" para mostrar junto ao preço.
export const formatUnitPrice = (price, unitStr, nameStr) => {
  const info = computeUnitPrice(price, unitStr, nameStr);
  if (!info) return null;
  return `${info.per.toFixed(2).replace('.', ',')} ${info.label}`;
};
