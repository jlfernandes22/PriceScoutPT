-- Run after 003_product_sources.sql. Reuses the existing GIN search index;
-- no fuzzy-search extension or duplicate product-text index is required.
BEGIN;

CREATE OR REPLACE FUNCTION public.product_search_normalize(value TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    lower(regexp_replace(normalize(coalesce(value, ''), NFKD), U&'[\0300-\036f]', '', 'g')),
    '[^[:alnum:]]+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.product_search_vector(
  product_name TEXT, product_brand TEXT, product_description TEXT, product_barcode TEXT
) RETURNS TSVECTOR LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('pg_catalog.portuguese', public.product_search_normalize(product_name)), 'A')
      || setweight(to_tsvector('pg_catalog.simple', coalesce(product_barcode, '')), 'A')
      || setweight(to_tsvector('pg_catalog.portuguese', public.product_search_normalize(product_brand)), 'B')
      || setweight(to_tsvector('pg_catalog.portuguese', public.product_search_normalize(left(product_description, 2000))), 'D');
$$;

-- Build ANDed prefixes from lexemes rather than accepting tsquery operators
-- from users. Accents, punctuation, word order and Portuguese inflections are
-- handled consistently. Stopword-only input produces an empty query.
CREATE OR REPLACE FUNCTION public.product_search_query(value TEXT)
RETURNS TSQUERY LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(
    to_tsquery('pg_catalog.simple', string_agg(quote_literal(lexeme) || ':*', ' & ')),
    ''::tsquery
  )
  FROM unnest(tsvector_to_array(to_tsvector(
    'pg_catalog.portuguese', public.product_search_normalize(value)
  ))) AS terms(lexeme);
$$;

CREATE OR REPLACE FUNCTION products_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  -- Coordinate the sync watermark with writers that have not committed yet.
  PERFORM pg_advisory_xact_lock_shared(76231027);
  NEW.search_vector := public.product_search_vector(NEW.name, NEW.brand, NEW.description, NEW.barcode);
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rebuild indexed text without making every product look newly observed or
-- creating sync deltas for a search-only migration. Transactional trigger
-- changes are rolled back if the backfill fails.
ALTER TABLE products DISABLE TRIGGER trg_products_search_vector;
UPDATE products
SET search_vector = public.product_search_vector(name, brand, description, barcode);
ALTER TABLE products ENABLE TRIGGER trg_products_search_vector;

COMMIT;
