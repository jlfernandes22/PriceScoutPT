-- Migração para BD em produção: índice composto do histórico de preços.
-- A consulta GET /api/products/:id faz:
--   WHERE product_id = $1 AND recorded_at >= now() - INTERVAL '30 days'
--   ORDER BY recorded_at DESC
-- O índice simples (product_id) força um sort/filtro por registo; o composto
-- cobre produto + data. Aplicar uma vez:
--   psql "$DATABASE_URL" -f database/migrations/002_price_history_index.sql
-- (IF NOT EXISTS → seguro re-executar.)

CREATE INDEX IF NOT EXISTS idx_price_history_product_recorded
  ON price_history(product_id, recorded_at DESC);
