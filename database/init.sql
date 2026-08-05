-- PostgreSQL 15 schema for PriceScoutPT
-- Supabase optimized schema with native FTS and UUID primary keys.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE supermarkets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Taxonomia canónica global: todos os supermercados mapeiam as suas categorias
-- de origem para esta lista, evitando centenas de categorias quase duplicadas.
CREATE TABLE canonical_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resolução de categoria de origem (por supermercado) para a taxonomia canónica.
CREATE TABLE category_mappings (
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  canonical_category_id UUID NOT NULL REFERENCES canonical_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (supermarket_id, source_name)
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_id UUID NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
  category_id UUID REFERENCES canonical_categories(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  price_currency TEXT NOT NULL DEFAULT 'EUR',
  unit TEXT,
  url TEXT,
  image_url TEXT,
  in_stock BOOLEAN NOT NULL DEFAULT true,
  deleted BOOLEAN NOT NULL DEFAULT false,
  last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supermarket_id, external_id)
);

CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'EUR',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_canonical_categories_slug ON canonical_categories(slug);
CREATE INDEX idx_products_supermarket_id ON products(supermarket_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_price ON products(price);
CREATE INDEX idx_products_deleted ON products(deleted);
CREATE INDEX idx_products_in_stock ON products(in_stock);
-- Suporta a paginação por cursor do /api/sync (range scan por created_at + ordenação id).
CREATE INDEX idx_products_created_at_id ON products(created_at, id);
-- Suporta as consultas de delta (updated) do /api/sync — as consultas permitem
-- deleted IS NULL e não exigem in_stock = true, pelo que os índices parciais
-- existentes não servem para todos os casos.
CREATE INDEX idx_products_updated_at ON products(updated_at);
CREATE INDEX idx_products_active_updated_at ON products(updated_at) WHERE deleted = false AND in_stock = true;
CREATE INDEX idx_products_deleted_out_of_stock_updated_at ON products(updated_at) WHERE deleted = true OR in_stock = false;
CREATE INDEX idx_price_history_product_id ON price_history(product_id);
CREATE INDEX idx_price_history_recorded_at ON price_history(recorded_at);
-- Suportam o browe GET /api/products?category=...|supermarket=... ORDER BY name:
-- o predicado de "ativo" é parcial, permitindo um index scan ordenado por name
-- em vez de um sort a partir de um seq scan sobre os ~56k produtos.
CREATE INDEX idx_products_active_category_name
  ON products(category_id, name) WHERE deleted = false AND in_stock = true;
CREATE INDEX idx_products_active_supermarket_name
  ON products(supermarket_id, name) WHERE deleted = false AND in_stock = true;

CREATE INDEX idx_products_search_vector ON products USING GIN(search_vector);

CREATE FUNCTION products_search_vector_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('pg_catalog.portuguese', coalesce(NEW.name, '') || ' ' || coalesce(NEW.brand, ''));
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION products_search_vector_trigger();

CREATE OR REPLACE FUNCTION log_price_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.price IS DISTINCT FROM OLD.price) THEN
    INSERT INTO price_history (product_id, price, price_currency, recorded_at)
    VALUES (NEW.id, NEW.price, NEW.price_currency, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_price_history
AFTER INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION log_price_history();

CREATE OR REPLACE FUNCTION prune_price_history_older_than_30_days() RETURNS void AS $$
DELETE FROM price_history
WHERE recorded_at < now() - INTERVAL '30 days';
$$ LANGUAGE sql;


INSERT INTO supermarkets (id, name, slug)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Continente', 'continente'),
  ('00000000-0000-0000-0000-000000000002', 'Lidl', 'lidl'),
  ('00000000-0000-0000-0000-000000000003', 'Pingo Doce', 'pingo-doce'),
  ('00000000-0000-0000-0000-000000000004', 'Aldi', 'aldi'),
  ('00000000-0000-0000-0000-000000000005', 'Auchan', 'auchan')
ON CONFLICT DO NOTHING;

-- Taxonomia canónica (19 categorias globais)
INSERT INTO canonical_categories (name, slug, sort_order) VALUES
  ('Frescos', 'frescos', 1),
  ('Frutas e Vegetais', 'frutas-e-vegetais', 2),
  ('Talho', 'talho', 3),
  ('Peixaria', 'peixaria', 4),
  ('Padaria e Pastelaria', 'padaria-e-pastelaria', 5),
  ('Charcutaria e Queijos', 'charcutaria-e-queijos', 6),
  ('Laticínios e Ovos', 'laticinios-e-ovos', 7),
  ('Congelados', 'congelados', 8),
  ('Mercearia', 'mercearia', 9),
  ('Bebidas', 'bebidas', 10),
  ('Higiene e Beleza', 'higiene-e-beleza', 11),
  ('Limpeza e Casa', 'limpeza-e-casa', 12),
  ('Animais', 'animais', 13),
  ('Bebé e Criança', 'bebe-e-crianca', 14),
  ('Bio e Saudável', 'bio-e-saudavel', 15),
  ('Livros e Papelaria', 'livros-e-papelaria', 16),
  ('Desporto e Brinquedos', 'desporto-e-brinquedos', 17),
  ('Promoções', 'promocoes', 18),
  ('Outros', 'outros', 99)
ON CONFLICT (slug) DO NOTHING;

