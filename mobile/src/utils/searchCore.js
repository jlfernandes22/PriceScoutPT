// Offline search over compact product snapshots. The index contains no images,
// descriptions or Watermelon Models; only the visible page is fetched as Models.
import { isOfferCurrent } from './offerEligibility.js';

const QUERY_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'para', 'por']);

export function normalizeSearch(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*(kg|gr|g|ml|cl|lt|l|un)\b/g, (_, n, unit) => `${n}${unit === 'gr' ? 'g' : unit === 'lt' ? 'l' : unit}`)
    .replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function searchTokens(value, query = false) {
  const tokens = normalizeSearch(value).match(/[a-z]+|\d+(?:\.\d+)?[a-z]*/g) || [];
  return [...new Set(tokens.filter((token) => !query || !QUERY_STOPWORDS.has(token)))];
}

// A single insertion, deletion, substitution or transposition. Short words and
// numbers are deliberately never corrected ("sem" and "com", sizes and EANs).
export function isOneTypo(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1)
      || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function lowerBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function createProductSearchIndex(products = []) {
  const documents = new Map();
  const postings = new Map();
  let vocabulary = null;

  function remove(id) {
    const previous = documents.get(id);
    if (!previous) return;
    previous.tokens.forEach((token) => {
      const ids = postings.get(token);
      ids.delete(id);
      if (ids.size === 0) {
        postings.delete(token);
        vocabulary = null;
      }
    });
    documents.delete(id);
  }

  function upsert(product) {
    remove(product.id);
    if (product.deleted || product.inStock === false || product.inStock === 0) return;
    const name = normalizeSearch(product.name);
    const nameTokens = searchTokens(product.name);
    const brandTokens = searchTokens(product.brand);
    const tokens = [...new Set([
      ...nameTokens, ...brandTokens, ...searchTokens(product.unit),
      ...searchTokens(product.barcode),
    ])];
    const price = Number(product.price);
    documents.set(product.id, {
      id: product.id, name, nameTokens, brandTokens, tokens,
      supermarketId: product.supermarketId, categoryId: product.categoryId,
      barcode: String(product.barcode || ''),
      price: Number.isFinite(price) && price > 0 ? price : null,
      validFrom: product.validFrom ? Number(product.validFrom) : null,
      validTo: product.validTo ? Number(product.validTo) : null,
      requiresLoyaltyCard: !!product.requiresLoyaltyCard,
    });
    tokens.forEach((token) => {
      if (!postings.has(token)) {
        postings.set(token, new Set());
        vocabulary = null;
      }
      postings.get(token).add(product.id);
    });
  }

  function tokenMatches(token, typos) {
    const matches = new Map();
    const add = (word, cost) => {
      for (const id of postings.get(word) || []) {
        if (!matches.has(id) || cost < matches.get(id)) matches.set(id, cost);
      }
    };
    add(token, 0);
    if (token.length >= 2) {
      for (let i = lowerBound(vocabulary, token); i < vocabulary.length && vocabulary[i].startsWith(token); i++) {
        const word = vocabulary[i];
        if (word !== token) add(word, 0.15);
      }
    }
    if (typos && token.length >= 4 && /^[a-z]+$/.test(token)) {
      for (const word of vocabulary) {
        if (word !== token && isOneTypo(token, word)) add(word, 1);
      }
    }
    return matches;
  }

  function search(query = '', { supermarketId, categoryId, sort = 'relevance', limit = 60, now = Date.now(), includeLoyalty = false } = {}) {
    const normalized = normalizeSearch(query);
    const content = searchTokens(query, true);
    const tokens = content.length ? content : searchTokens(query);
    if (!vocabulary) vocabulary = [...postings.keys()].sort();
    const eligible = (doc) => isOfferCurrent(doc, now, includeLoyalty) && (!supermarketId || supermarketId === 'all' || doc.supermarketId === supermarketId)
      && (!categoryId || doc.categoryId === categoryId);
    const collect = (typos) => {
      if (tokens.length === 0) return [...documents.values()].filter(eligible).map((doc) => ({ doc, cost: 0 }));
      const sets = tokens.map((token) => tokenMatches(token, typos)).sort((a, b) => a.size - b.size);
      const matches = [];
      for (const [id, cost] of sets[0]) {
        const doc = documents.get(id);
        if (!eligible(doc)) continue;
        let totalCost = cost;
        let all = true;
        for (let i = 1; i < sets.length; i++) {
          if (!sets[i].has(id)) { all = false; break; }
          totalCost += sets[i].get(id);
        }
        if (all) matches.push({ doc, cost: totalCost });
      }
      return matches;
    };
    let matches = collect(false);
    // Corrections are a transparent fallback, never mixed into exact results.
    const approximate = tokens.length > 0 && matches.length === 0;
    if (approximate) matches = collect(true);
    const score = ({ doc, cost }) => {
      let value = -cost * 100;
      if (doc.barcode === normalized && normalized) value += 1000;
      if (doc.name === normalized) value += 200;
      else if (doc.name.startsWith(`${normalized} `)) value += 100;
      else if (doc.name.includes(normalized) && normalized) value += 50;
      for (const token of tokens) {
        if (doc.nameTokens.includes(token)) value += 20;
        else if (doc.nameTokens.some((word) => word.startsWith(token))) value += 10;
        else if (doc.brandTokens.includes(token)) value += 5;
      }
      return value;
    };
    for (const match of matches) match.score = score(match);
    matches.sort((a, b) => {
      if (sort === 'price_asc' || sort === 'price_desc') {
        if (a.doc.price === null && b.doc.price !== null) return 1;
        if (b.doc.price === null && a.doc.price !== null) return -1;
        if (a.doc.price !== b.doc.price) return sort === 'price_asc' ? a.doc.price - b.doc.price : b.doc.price - a.doc.price;
      } else if (sort === 'relevance' && tokens.length && a.score !== b.score) return b.score - a.score;
      // Names are already lowercase ASCII with accents removed. Calling
      // localeCompare for the whole catalogue repeatedly constructs Android
      // Intl collators on Hermes and can stall startup for several minutes.
      if (a.doc.name !== b.doc.name) return a.doc.name < b.doc.name ? -1 : 1;
      return a.doc.id === b.doc.id ? 0 : a.doc.id < b.doc.id ? -1 : 1;
    });
    return {
      ids: matches.slice(0, Math.max(0, limit)).map(({ doc }) => doc.id),
      total: matches.length,
      approximate: approximate && matches.length > 0,
    };
  }

  products.forEach(upsert);
  return {
    upsert, remove, search,
    get size() { return documents.size; },
    filters(now = Date.now()) {
      const supermarketIds = new Set();
      const categoryIds = new Set();
      for (const doc of documents.values()) {
        // Keep the store/category of card-only offers discoverable so users can
        // enable the explicit loyalty-price control even when those are all it has.
        if (!isOfferCurrent(doc, now, true)) continue;
        supermarketIds.add(doc.supermarketId);
        if (doc.categoryId) categoryIds.add(doc.categoryId);
      }
      return { supermarketIds, categoryIds };
    },
  };
}
