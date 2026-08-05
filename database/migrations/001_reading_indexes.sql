-- Migração para BD em produção: adiciona índices de leitura que aceleram o
-- browse de produtos (GET /api/products). Aplicar apenas uma vez:
--   psql "$DATABASE_URL" -f database/migrations/001_reading_indexes.sql
-- (No índices são criados com IF NOT EXISTS, pelo que é seguro re-executar.)

CREATE INDEX IF NOT EXISTS idx_products_active_category_name
  ON products(category_id, name) WHERE deleted = false AND in_stock = true;

CREATE INDEX IF NOT EXISTS idx_products_active_supermarket_name
  ON products(supermarket_id, name) WHERE deleted = false AND in_stock = true;