-- Run before 004_product_search.sql on existing databases.
BEGIN;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS regular_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS unit_price_unit TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'online_catalog',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS store_location TEXT,
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_loyalty_card BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION log_price_history() RETURNS trigger AS $$
BEGIN
  IF NEW.price > 0 AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.price IS DISTINCT FROM OLD.price)) THEN
    INSERT INTO price_history (product_id, price, price_currency, recorded_at)
    VALUES (NEW.id, NEW.price, NEW.price_currency, coalesce(NEW.observed_at, clock_timestamp()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Legacy promotional rows were never a full online catalogue.
UPDATE products SET source_type = CASE
  WHEN supermarket_id = '00000000-0000-0000-0000-000000000004' THEN 'leaflet'
  ELSE 'public_listing' END
WHERE source_type = 'online_catalog'
  AND supermarket_id IN ('00000000-0000-0000-0000-000000000002',
                         '00000000-0000-0000-0000-000000000004');

INSERT INTO supermarkets (id, name, slug) VALUES
  ('00000000-0000-0000-0000-000000000006', 'Mercadona', 'mercadona'),
  ('00000000-0000-0000-0000-000000000007', 'Intermarché', 'intermarche'),
  ('00000000-0000-0000-0000-000000000008', 'El Corte Inglés', 'el-corte-ingles'),
  ('00000000-0000-0000-0000-000000000009', 'Froiz', 'froiz'),
  ('00000000-0000-0000-0000-000000000010', 'Minipreço', 'minipreco'),
  ('00000000-0000-0000-0000-000000000011', 'E.Leclerc', 'e-leclerc'),
  ('00000000-0000-0000-0000-000000000012', 'Amanhecer', 'amanhecer'),
  ('00000000-0000-0000-0000-000000000013', 'SPAR', 'spar')
ON CONFLICT DO NOTHING;

-- The sync cursor orders updates and tombstones by this pair.
DROP INDEX IF EXISTS idx_products_updated_at;
CREATE INDEX idx_products_updated_at ON products(updated_at, id);
COMMIT;
