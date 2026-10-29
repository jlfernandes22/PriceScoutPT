import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../model';
import { isOfferCurrent } from './offerEligibility';
import { parseUnit } from './unitPrice';
import { useProductCatalogRevision } from './useProductCatalogRevision';
import { PUBLIC_COMPARISON_SOURCES, isInComparisonContext, selectComparisonContexts } from './comparisonScope';
import {
  contentTokens,
  getSimilarity,
  getMandatoryKeyword,
  significantTokens,
  likeVariants,
  normalize,
  getDietaryQualifiers,
  haveCompatibleDietaryQualifiers,
} from './fuzzyCore';

// A lógica pura (normalização, tokens, semelhança, variantes de LIKE) vive em
// fuzzyCore.js (testável em Node). Este ficheiro só contém a parte que depende
// do WatermelonDB/React.

/**
 * Encontra a melhor correspondência de um produto num supermercado alvo,
 * resolvendo produtos com marcas/nomes distintos ("Miolo de Noz Pecan Continente"
 * ↔ "Miolo Noz Pecan"), ignorando marcas, unidades e palavras de ruído.
 */
export const findLocalFuzzyMatch = async (db, product, targetContext) => {
  if (!product) return null;
  // Keep legacy callers safely scoped to public catalogue prices as well.
  const context = typeof targetContext === 'string' ? { supermarketId: targetContext, storeLocation: null } : targetContext;
  if (!context?.supermarketId) return null;
  const targetSupermarketId = context.supermarketId;
  const scopeConditions = context.storeLocation
    ? [Q.where('store_location', context.storeLocation)]
    : [Q.or(Q.where('store_location', null), Q.where('store_location', '')),
      Q.or(Q.where('source_type', null), Q.where('source_type', Q.oneOf(PUBLIC_COMPARISON_SOURCES)))];
  if (isInComparisonContext(product, context) && isOfferCurrent(product)) return product;

  // A manufacturer barcode is stronger evidence than a similar display name.
  if (product.barcode) {
    const exact = await db.collections.get('products').query(
      Q.where('supermarket_id', targetSupermarketId), Q.where('barcode', product.barcode),
      Q.where('deleted', false), Q.where('in_stock', true), ...scopeConditions
    ).fetch();
    const eligible = exact.filter(candidate => isOfferCurrent(candidate) && isInComparisonContext(candidate, context))
      .sort((a, b) => Number(a.price) - Number(b.price));
    if (eligible.length) return eligible[0];
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
      ...scopeConditions,
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
  const sourceQuantity = parseUnit(product.unit, product.name);
  const sourceDietary = getDietaryQualifiers(product.name);

  for (const cand of candidates) {
    if (!isOfferCurrent(cand) || !isInComparisonContext(cand, context)) continue;
    if (!haveCompatibleDietaryQualifiers(sourceDietary, getDietaryQualifiers(cand.name))) continue;
    const candidateQuantity = parseUnit(cand.unit, cand.name);
    // Basket totals count packages. Comparing 100 g with 1 kg as one item
    // creates a false saving even when the names look identical.
    if (sourceQuantity && candidateQuantity &&
        (sourceQuantity.type !== candidateQuantity.type ||
         Math.abs(sourceQuantity.baseQty - candidateQuantity.baseQty) / sourceQuantity.baseQty > 0.05)) continue;
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

export const getComparisonContexts = async (db) => {
  const now = Date.now();
  const sourcePlaceholders = PUBLIC_COMPARISON_SOURCES.map(() => '?').join(', ');
  const rows = await db.collections.get('products').query(Q.unsafeSqlQuery(
    `SELECT supermarket_id, NULLIF(TRIM(store_location), '') AS store_location,
            COUNT(*) AS product_count,
            MAX(COALESCE(observed_at, last_scraped_at, updated_at, 0)) AS latest_observed_at
     FROM products
     WHERE _status != 'deleted' AND deleted = 0 AND in_stock = 1 AND price > 0
       AND requires_loyalty_card = 0
       AND (valid_from IS NULL OR valid_from <= ?)
       AND (valid_to IS NULL OR valid_to >= ?)
       AND (NULLIF(TRIM(store_location), '') IS NOT NULL OR source_type IS NULL OR source_type IN (${sourcePlaceholders}))
     GROUP BY supermarket_id, NULLIF(TRIM(store_location), '')`, [now, now, ...PUBLIC_COMPARISON_SOURCES]
  )).unsafeFetchRaw();
  return selectComparisonContexts(rows);
};

export const getComparableSupermarkets = async (db) => (await getComparisonContexts(db)).map((context) => context.supermarketId);

// Custom Hook reativo para correspondência local
export const useLocalFuzzyMatch = (product) => {
  const [matches, setMatches] = useState({});
  const [loading, setLoading] = useState(false);
  const catalogRevision = useProductCatalogRevision(!!product);

  useEffect(() => {
    let isMounted = true;
    if (!product) {
      setMatches({});
      setLoading(false);
      return;
    }

    const loadMatches = async () => {
      setLoading(true);
      try {
        const result = {};

        // Corridas em paralelo — fazer os 4-5 lookups de supermercado em
        // sequência duplica 4-5x a latência no ecrã. Nenhum depende do outro.
        const contexts = await getComparisonContexts(database);
        const entries = await Promise.all(
          contexts.map(async (context) => {
            const sId = context.supermarketId;
            const match = await findLocalFuzzyMatch(database, product, context);
            if (match) {
              return [
                sId,
                {
                  available: true,
                  price: parseFloat(match.price),
                  name: match.name,
                  id: match.id,
                  scopeLabel: context.label,
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
                scopeLabel: context.label,
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
  }, [product, catalogRevision]);

  return { matches, loading };
};
