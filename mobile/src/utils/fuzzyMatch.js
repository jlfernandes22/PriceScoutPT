import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../model';
import { SUPERMARKET_BRANDS } from '../components/ProductCard';
import {
  contentTokens,
  getSimilarity,
  getMandatoryKeyword,
  significantTokens,
  likeVariants,
  normalize,
} from './fuzzyCore';

// A lógica pura (normalização, tokens, semelhança, variantes de LIKE) vive em
// fuzzyCore.js (testável em Node). Este ficheiro só contém a parte que depende
// do WatermelonDB/React.

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
  const sig = significantTokens(product.name, product.brand, 3);

  if (srcTokens.length === 0 || sig.length === 0) return null;

// Pesquisar por tokens significativos (sem filtrar por marca — o maior erro do
// matcher antigo, que impedia produtos de marca própria de serem comparados).
// LIKE é sensível a acentos, por isso geram-se variantes acentuadas de cada
// token para capturar nomes como "Camarão" quando o token é "camarao".
const orConds = [...new Set(
  sig.flatMap((t) => likeVariants(t))
)].map((v) =>
  Q.where('name', Q.like(`%${Q.sanitizeLikeString(v)}%`))
);

  let candidates;
  try {
    candidates = await db.collections.get('products').query(
      Q.where('supermarket_id', targetSupermarketId),
      Q.where('deleted', false),
      Q.where('in_stock', true),
      Q.or(...orConds),
      Q.take(500)
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
