const MAX_SEARCH_LENGTH = 160;
const MAX_SEARCH_WORDS = 12;
const SORTS = new Set(['relevance', 'name', 'price_asc', 'price_desc', 'unit_price_asc']);

class InvalidProductQuery extends Error {}

function scalar(query, key) {
  const value = query[key];
  if (value !== undefined && typeof value !== 'string') {
    throw new InvalidProductQuery(`Query parameter ${key} must be a single value.`);
  }
  return value;
}

function integer(value, fallback, min, max, key) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new InvalidProductQuery(`Query parameter ${key} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function normalizeSearch(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function parseProductQuery(query, requireSearch = false) {
  const q = scalar(query, 'q');
  const name = scalar(query, 'name');
  const search = scalar(query, 'search');
  const raw = (q ?? search ?? name ?? '').trim();
  if (requireSearch && !raw) {
    throw new InvalidProductQuery('Query parameter name or q is required.');
  }
  if (raw.length > MAX_SEARCH_LENGTH) {
    throw new InvalidProductQuery(`Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`);
  }
  const text = normalizeSearch(raw);
  if (text.split(/\s+/).length > MAX_SEARCH_WORDS) {
    throw new InvalidProductQuery(`Search must contain ${MAX_SEARCH_WORDS} words or fewer.`);
  }

  const category = scalar(query, 'category')?.trim() || null;
  const supermarket = scalar(query, 'supermarket')?.trim() || null;
  if ((category && category.length > 100) || (supermarket && supermarket.length > 100)) {
    throw new InvalidProductQuery('Category and supermarket filters must be 100 characters or fewer.');
  }
  const sort = scalar(query, 'sort') || (raw ? 'relevance' : 'name');
  if (!SORTS.has(sort)) {
    throw new InvalidProductQuery(`Query parameter sort must be one of: ${[...SORTS].join(', ')}.`);
  }
  const includeLoyalty = scalar(query, 'include_loyalty');
  if (includeLoyalty !== undefined && !['true', 'false'].includes(includeLoyalty)) {
    throw new InvalidProductQuery('Query parameter include_loyalty must be true or false.');
  }
  return {
    text, hasSearch: Boolean(raw), category, supermarket, sort,
    includeLoyalty: includeLoyalty === 'true',
    limit: integer(scalar(query, 'limit'), 50, 1, 200, 'limit'),
    offset: integer(scalar(query, 'offset'), 0, 0, 100000, 'offset'),
  };
}

const PRODUCT_COLUMNS = `p.id, p.supermarket_id, s.name AS supermarket_name, s.slug AS supermarket_slug,
  p.category_id, c.name AS category_name, c.slug AS category_slug,
  p.external_id, p.name, p.brand, p.description, p.price, p.price_currency,
  p.unit, p.url, p.image_url, p.in_stock, p.deleted, p.created_at, p.updated_at,
  p.barcode, p.regular_price, p.unit_price, p.unit_price_unit,
  p.source_type, p.source_url, p.store_location, p.observed_at, p.last_scraped_at,
  p.requires_loyalty_card, p.valid_from, p.valid_to, p.metadata`;

function buildProductQuery(options) {
  const params = [];
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  const conditions = [
    'p.deleted = false', 'p.in_stock = true', 'p.price > 0',
    '(p.valid_from IS NULL OR p.valid_from <= now())',
    '(p.valid_to IS NULL OR p.valid_to >= now())',
  ];
  if (options.hasSearch && !options.text) conditions.push('false');
  if (!options.includeLoyalty) conditions.push('p.requires_loyalty_card = false');
  if (options.category) conditions.push(`c.slug = ${bind(options.category)}`);
  if (options.supermarket) conditions.push(`s.slug = ${bind(options.supermarket)}`);

  let searchCte = '';
  let searchJoin = '';
  let rank = '0::real';
  if (options.text) {
    const text = bind(options.text);
    const prefix = bind(`${options.text}%`);
    searchCte = `WITH search AS (SELECT public.product_search_query(${text}) AS query)`;
    searchJoin = 'CROSS JOIN search';
    conditions.push('numnode(search.query) > 0', 'p.search_vector @@ search.query');
    rank = `(CASE WHEN p.barcode = ${text} THEN 120 ELSE 0 END
      + CASE WHEN public.product_search_normalize(p.name) = ${text} THEN 100 ELSE 0 END
      + CASE WHEN public.product_search_normalize(p.name) LIKE ${prefix} THEN 15 ELSE 0 END
      + CASE WHEN public.product_search_normalize(p.brand) = ${text} THEN 8 ELSE 0 END
      + ts_rank_cd(p.search_vector, search.query, 32) * 10)::real`;
  }

  const order = {
    relevance: 'rank DESC, p.price ASC, p.name ASC, p.id ASC',
    name: 'p.name ASC, p.price ASC, p.id ASC',
    price_asc: 'p.price ASC, rank DESC, p.name ASC, p.id ASC',
    price_desc: 'p.price DESC, rank DESC, p.name ASC, p.id ASC',
    // Missing unit prices remain visible at the end. Consumers should only
    // compare unit prices with the same unit_price_unit (kg, l, un, ...).
    unit_price_asc: 'p.unit_price ASC NULLS LAST, p.unit_price_unit ASC, rank DESC, p.id ASC',
  }[options.sort];
  const limit = bind(options.limit);
  const offset = bind(options.offset);
  return {
    text: `${searchCte}
      SELECT ${PRODUCT_COLUMNS}, ${rank} AS rank
      FROM products p
      JOIN supermarkets s ON p.supermarket_id = s.id
      LEFT JOIN canonical_categories c ON p.category_id = c.id
      ${searchJoin}
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY ${order}
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  };
}

module.exports = { InvalidProductQuery, normalizeSearch, parseProductQuery, buildProductQuery };
