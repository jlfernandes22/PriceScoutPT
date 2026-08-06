// Núcleo puro (sem dependências de React/WatermelonDB) do matcher fuzzy.
// Separado para poder ser testado diretamente em Node (node --test).

// --- Normalização de texto para comparação robusta ---

const STOPWORDS = new Set([
  'de', 'da', 'do', 'dos', 'das', 'a', 'o', 'as', 'os', 'e', 'em', 'com',
  'para', 'por', 'sem', 'no', 'na', 'ao', 'aos', 'um', 'uma', 'uns', 'umas',
  'se', 'p', 'c', 'as', 'à', 'é',
]);

// Palavras de unidade/embalagem que só adicionam ruído ao nome.
const UNIT_WORDS = new Set([
  'emb', 'embalagem', 'gr', 'g', 'kg', 'ml', 'cl', 'l', 'lt', 'un',
  'unidade', 'unidades', 'pack', 'saco', 'lata', 'garrafa', 'quant',
  'minima', 'peso', 'escorrido', 'pacote', 'fatia', 'fatias', 'x',
]);

export const normalize = (name) =>
  (name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

// Remove da string as palavras que fazem parte da marca,
// para que "Miolo de Noz Pecan Continente" e "Miolo de Noz Pecã" fiquem equivalentes.
function removeBrandTokens(text, brand) {
  if (!brand) return text;
  const words = normalize(brand).split(/\s+/).filter((w) => w.length > 2);
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${esc}\\b`, 'g'), ' ');
  }
  return text;
}

// Tokens de conteúdo (sem marcas, unidades, números e stopwords).
export function contentTokens(name, brand) {
  let text = normalize(name);
  text = removeBrandTokens(text, brand);
  return text
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .filter((w) => !/^\d+$/.test(w))
    // Quantidade colada à unidade ("1l", "250g", "12x") — só ruído.
    .filter((w) => !/^\d+[a-z]+$/.test(w))
    .filter((w) => !UNIT_WORDS.has(w))
    .filter((w) => !STOPWORDS.has(w));
}

// Palavras-chave de espécie: se o produto é peixe/carne específico,
// o candidato deve pertencer à mesma espécie (evita "Lombo de Salmão" == "Lombo de Porco").
const MANDATORY_KEYWORDS = [
  // Peixe e Marisco
  'tamboril', 'salmao', 'salmon', 'bacalhau', 'dourada', 'pescada', 'perca',
  'sardinha', 'atum', 'carapau', 'robalo', 'truta', 'polvo', 'lula',
  'gambas', 'camarao', 'mexilhao', 'amêijoa', 'amêijoas', 'lagosta',
  'linguado', 'cherne', 'garoupa', 'cavala', 'enguia', 'pregado',
  // Carnes
  'frango', 'peru', 'porco', 'vitela', 'novilho', 'borrego', 'cabrito',
  'pato', 'coelho', 'javali', 'avestruz',
  // Lacticínios
  'vaca', 'cabra', 'ovelha', 'búfala', 'soja', 'aveia', 'amendoa', 'coco', 'arroz',
  // Frutas e Legumes
  'banana', 'maca', 'laranja', 'limao', 'morango', 'cereja', 'pessego',
  'manga', 'abacate', 'ananás', 'melancia', 'melao', 'kiwi', 'uva',
  'tomate', 'batata', 'cebola', 'alho', 'cenoura', 'brocolo', 'couve',
  'espinafre', 'alface', 'pepino', 'pimento', 'beringela', 'abobora',
];

// Versão normalizada (sem acentos) das palavras-chave obrigatórias:
// o normalize() remove acentos do nome do produto, pelo que literais
// acentuados ("amêijoa") nunca casariam sem esta normalização.
const NORMALIZED_KEYWORDS = MANDATORY_KEYWORDS.map(normalize);

export const getMandatoryKeyword = (name) => {
  const normalized = normalize(name);
  return NORMALIZED_KEYWORDS.find((kw) => normalized.includes(kw));
};

// Semelhança Jaccard sobre tokens de conteúdo significativos.
export const getSimilarity = (name1, brand1, name2, brand2) => {
  const a = contentTokens(name1, brand1);
  const b = contentTokens(name2, brand2);
  if (a.length + b.length === 0) return 0;
  const sa = new Set(a);
  let inter = 0;
  for (const t of a) if (b.includes(t)) inter++;
  return inter / (a.length + b.length - inter);
};

// Tokens mais específicos (os mais longos) para pesquisar candidatos na BD.
// Quantos mais, maior a hipótese de um deles não ter acentos e casar na
// pesquisa LIKE (o SQLite LIKE é sensível a acentos — não interpreta classes
// como [eé], e "Pecã" não casa "%pecan%").
export function significantTokens(name, brand, max = 3) {
  return [...contentTokens(name, brand)]
    .sort((a, b) => b.length - a.length)
    .slice(0, max);
}

// Variantes com um acento por posição, para a pesquisa LIKE casar com nomes
// acentuados na BD ("camarao" -> "camarão", "pescanova" -> "pescanóva"...).
// O SQLite LIKE é sensível a acentos; sem isto, tokens com vogais acentuadas
// na BD nunca encontram candidatos ("Miolo de Camarão" não casa com "%camarao%").
const ACCENTED = {
  a: ['á', 'à', 'â', 'ã'],
  e: ['é', 'è', 'ê'],
  i: ['í', 'ì', 'î'],
  o: ['ó', 'ò', 'ô', 'õ'],
  u: ['ú', 'ù', 'û'],
  c: ['ç'],
};

export function likeVariants(token) {
  const variants = [token];
  const chars = token.split('');
  for (let i = 0; i < chars.length; i++) {
    const alts = ACCENTED[chars[i]];
    if (!alts) continue;
    for (const alt of alts) {
      const v = chars.slice();
      v[i] = alt;
      variants.push(v.join(''));
    }
  }
  return variants;
}
