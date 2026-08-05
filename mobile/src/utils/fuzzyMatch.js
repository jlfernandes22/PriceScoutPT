import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../model';
import { SUPERMARKET_BRANDS } from '../components/ProductCard';

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

const normalize = (name) =>
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

export const getMandatoryKeyword = (name) => {
  const normalized = normalize(name);
  return MANDATORY_KEYWORDS.find((kw) => normalized.includes(kw));
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
function significantTokens(name, brand, max = 3) {
  return [...contentTokens(name, brand)]
    .sort((a, b) => b.length - a.length)
    .slice(0, max);
}

/**
 * Encontra a melhor correspondência de um produto num supermercado alvo,
 * resolvendo produtos com marcas/nomes distintos ("Miolo de Noz Pecan Continente"
 * ↔ "Miolo Noz Pecan"), ignorando marcas, unidades e palavras de ruído.
 */
export const findLocalFuzzyMatch = async (db, product, targetSupermarketId) => {
  if (!product) return null;
  if (product.supermarketId === targetSupermarketId) {
    return product;
  }

  const srcTokens = contentTokens(product.name, product.brand);
  const sig = significantTokens(product.name, product.brand, 2);

  if (srcTokens.length === 0 || sig.length === 0) return null;

// Pesquisar por tokens significativos (sem filtrar por marca — o maior erro do
// matcher antigo, que impedia produtos de marca própria de serem comparados).
// LIKE é sensível a acentos, por isso usam-se vários tokens para capturar pelo
// menos um sem acentos.
const orConds = sig.map((t) =>
  Q.where('name', Q.like(`%${Q.sanitizeLikeString(t)}%`))
);

  let candidates;
  try {
    candidates = await db.collections.get('products').query(
      Q.where('supermarket_id', targetSupermarketId),
      Q.where('deleted', false),
      Q.where('in_stock', true),
      Q.or(...orConds),
      Q.take(300)
    ).fetch();
  } catch (e) {
    console.error("[findLocalFuzzyMatch Query Error]:", e);
    return null;
  }

  const foundKeyword = getMandatoryKeyword(product.name);

  let best = null;
  let bestSim = -1;
  let bestShared = 0;

  for (const cand of candidates) {
    const candNorm = normalize(cand.name);

    // Guarda de espécie
    if (foundKeyword && !candNorm.includes(foundKeyword)) continue;

    // (Guarda de categoria removida: as categorias canónicas de topo são demasiado
    //  grosseiras/inconsistentes entre supermercados, ex "Miolo de Noz Pecan" em
    //  "Frescos" vs "Mercearia". A qualidade da semelhança decide em baixo.)

    const candTokens = contentTokens(cand.name, cand.brand);
    const shareSignificant = sig.some((t) => candNorm.includes(t));
    if (!shareSignificant) continue;

    const sim = getSimilarity(product.name, product.brand, cand.name, cand.brand);
    const shared = srcTokens.filter((t) => candTokens.includes(t)).length;

    if (sim > bestSim) {
      bestSim = sim;
      bestShared = shared;
      best = cand;
    }
  }

  // Qualidade: exigir ≥2 tokens partilhados OU semelhança forte (≥0.5), com mínimo 0.3.
  if (best && bestSim >= 0.3 && (bestShared >= 2 || bestSim >= 0.5)) {
    return best;
  }

  return null;
};

// Custom Hook reativo para correspondência local
export const useLocalFuzzyMatch = (product) => {
  const [matches, setMatches] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (!product) {
      setMatches({});
      return;
    }

    const loadMatches = async () => {
      setLoading(true);
      try {
        const result = {};

        // Corridas em paralelo — fazer os 4-5 lookups de supermercado em
        // sequência duplica 4-5x a latência no ecrã. Nenhum depende do outro.
        const supermarkets = Object.keys(SUPERMARKET_BRANDS);
        const entries = await Promise.all(
          supermarkets.map(async (sId) => {
            if (sId === product.supermarketId) {
              return [
                sId,
                {
                  available: true,
                  price: parseFloat(product.price),
                  name: product.name,
                  id: product.id,
                },
              ];
            }
            const match = await findLocalFuzzyMatch(database, product, sId);
            if (match) {
              return [
                sId,
                {
                  available: true,
                  price: parseFloat(match.price),
                  name: match.name,
                  id: match.id,
                },
              ];
            }
            return [
              sId,
              {
                available: false,
                price: 0,
                name: 'Indisponível',
                id: null,
              },
            ];
          })
        );
        for (const [sId, value] of entries) {
          result[sId] = value;
        }

        if (isMounted) {
          setMatches(result);
        }
      } catch (e) {
        console.error("[useLocalFuzzyMatch Error]:", e);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadMatches();

    return () => {
      isMounted = false;
    };
  }, [product]);

  return { matches, loading };
};