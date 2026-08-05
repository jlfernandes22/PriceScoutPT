#!/usr/bin/env python
"""Migração da BD existente para a taxonomia canónica de categorias.

Colapsa as 126 categorias per-supermercado nas 19 categorias canónicas:

  1. Cria canonical_categories e category_mappings (se não existirem).
  2. Popula canonical_categories a partir de scraper/category_taxonomy.py.
  3. Constrói category_mappings para todas as categorias antigas.
  4. Redireciona products.category_id para as categorias canónicas.
  5. Troca a FK de products para canonical_categories e remove a tabela
     antiga categories.

Uso:  DATABASE_URL=postgres://... python scraper/backfill_categories.py
"""

import os
import sys
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from category_taxonomy import (
    CANONICAL_CATEGORIES,
    SOURCE_CATEGORY_MAP,
    resolve_source_category,
)


def main():
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        print('DATABASE_URL é obrigatório.')
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # 1. Tabelas canónicas (idempotente)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS canonical_categories (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  name TEXT NOT NULL UNIQUE,
                  slug TEXT NOT NULL UNIQUE,
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS category_mappings (
                  supermarket_id UUID NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
                  source_name TEXT NOT NULL,
                  canonical_category_id UUID NOT NULL REFERENCES canonical_categories(id) ON DELETE CASCADE,
                  PRIMARY KEY (supermarket_id, source_name)
                )
            """)

            # 2. Seed canónico
            now = datetime.now(timezone.utc)
            execute_values(cur, """
                INSERT INTO canonical_categories (name, slug, sort_order, created_at, updated_at)
                VALUES %s
                ON CONFLICT (slug) DO UPDATE
                SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, updated_at = now()
            """, [(n, s, o, now, now) for n, s, o in CANONICAL_CATEGORIES])

            cur.execute("SELECT id, slug FROM canonical_categories")
            by_slug = {row[1]: row[0] for row in cur.fetchall()}

            cur.execute("SELECT id, slug FROM supermarkets")
            supermarket_by_slug = {row[1]: row[0] for row in cur.fetchall()}

            # 3. Mappings: taxonomia estática + quaisquer categorias antigas
            mapping_values = []
            for sm_slug, smapping in SOURCE_CATEGORY_MAP.items():
                sm_id = supermarket_by_slug.get(sm_slug)
                if not sm_id:
                    continue
                for src_name, canon_slug in smapping.items():
                    cid = by_slug.get(canon_slug)
                    if cid:
                        mapping_values.append((sm_id, src_name, cid))

            cur.execute("SELECT to_regclass('public.categories')")
            if cur.fetchone()[0] is not None:
                cur.execute("""
                    SELECT s.id, s.slug, c.name
                    FROM categories c
                    JOIN supermarkets s ON s.id = c.supermarket_id
                """)
                for sm_id, sm_slug, src_name in cur.fetchall():
                    canon_slug = resolve_source_category(sm_slug, src_name)
                    cid = by_slug.get(canon_slug)
                    if cid:
                        mapping_values.append((sm_id, src_name, cid))

            if mapping_values:
                mapping_values = list(dict.fromkeys(mapping_values))
                execute_values(cur, """
                    INSERT INTO category_mappings (supermarket_id, source_name, canonical_category_id)
                    VALUES %s
                    ON CONFLICT (supermarket_id, source_name) DO UPDATE
                    SET canonical_category_id = EXCLUDED.canonical_category_id
                """, mapping_values)

            # 4. (Idempotente) Re-mapeia produtos vindos da tabela antiga 'categories'.
            #    Se a tabela já não existir, é porque a migração já foi executada.
            cur.execute("SELECT to_regclass('public.categories')")
            old_categories_exist = cur.fetchone()[0] is not None
            if old_categories_exist:
                cur.execute("""
                    DO $$
                    BEGIN
                      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_fkey') THEN
                        ALTER TABLE products DROP CONSTRAINT products_category_id_fkey;
                      END IF;
                    END $$
                """)
                cur.execute("""
                    UPDATE products p
                    SET category_id = m.canonical_category_id,
                        updated_at = now()
                    FROM categories oldc
                    JOIN category_mappings m
                      ON m.supermarket_id = oldc.supermarket_id
                     AND m.source_name = oldc.name
                    WHERE oldc.id = p.category_id
                      AND p.category_id IS NOT NULL
                """)
                print(f"  ✓ Produtos re-mapeados: {cur.rowcount}")
                cur.execute("DROP INDEX IF EXISTS idx_categories_supermarket_id")
                cur.execute("DROP TABLE IF EXISTS categories")

            # 4b. Produtos sem categoria (legacy/NULL) caem em 'Outros'
            cur.execute("""
                UPDATE products p
                SET category_id = cc.id,
                    updated_at = now()
                FROM canonical_categories cc
                WHERE p.category_id IS NULL
                  AND cc.slug = 'outros'
            """)
            print(f"  ✓ Produtos sem categoria -> Outros: {cur.rowcount}")

            # 5. Garante a FK correta para a taxonomia canónica
            cur.execute("""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_fkey'
                  ) THEN
                    ALTER TABLE products
                    ADD CONSTRAINT products_category_id_fkey
                    FOREIGN KEY (category_id) REFERENCES canonical_categories(id) ON DELETE SET NULL;
                  END IF;
                END $$
            """)

        conn.commit()
        print("  ✓ Migração de categorias concluída.")

        with conn.cursor() as cur:
            cur.execute("SELECT name, count(*) FROM canonical_categories GROUP BY name")
            cur.execute("SELECT count(*) FROM canonical_categories")
            print(f"  ✓ Categorias canónicas: {cur.fetchone()[0]}")
            cur.execute("SELECT count(*) FROM category_mappings")
            print(f"  ✓ Mappings de origem: {cur.fetchone()[0]}")
            cur.execute("""
                SELECT c.slug, count(p.id)
                FROM products p
                JOIN canonical_categories c ON c.id = p.category_id
                WHERE p.deleted = false AND p.in_stock = true
                GROUP BY c.slug ORDER BY count DESC
            """)
            print("  Produtos ativos por categoria:")
            for slug, cnt in cur.fetchall():
                print(f"    {slug}: {cnt}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
