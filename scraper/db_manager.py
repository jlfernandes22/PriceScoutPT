import os
from datetime import datetime, timezone
import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_values

class DBManager:
    def __init__(self, dsn=None):
        self.dsn = dsn or os.environ.get('DATABASE_URL')
        if not self.dsn:
            raise ValueError('DATABASE_URL environment variable is required for DBManager.')
        self.conn = psycopg2.connect(self.dsn)
        self.conn.autocommit = False

    def ensure_canonical_categories(self):
        """Garante que a taxonomia canónica existe na BD (idempotente)."""
        from category_taxonomy import get_canonical_categories

        now = datetime.now(timezone.utc)
        query = sql.SQL(
            """
            INSERT INTO canonical_categories (name, slug, sort_order, created_at, updated_at)
            VALUES %s
            ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name,
                sort_order = EXCLUDED.sort_order,
                updated_at = now()
            """
        )
        values = [(name, slug, sort_order, now, now) for name, slug, sort_order in get_canonical_categories()]
        try:
            with self.conn.cursor() as cur:
                execute_values(cur, query.as_string(self.conn), values)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def resolve_category_ids(self, supermarket_id, category_names):
        """Resolve categorias de origem para ids canónicos.

        Devolve {name: canonical_id}. Nomes sem correspondência caem em 'outros';
        nunca são criadas categorias novas em runtime.
        """
        from category_taxonomy import resolve_source_category, DEFAULT_CATEGORY_SLUG

        names = {n for n in category_names if n}
        if not names:
            return {}

        self.ensure_canonical_categories()

        with self.conn.cursor() as cur:
            cur.execute("SELECT slug FROM supermarkets WHERE id = %s", (supermarket_id,))
            row = cur.fetchone()
            supermarket_slug = row[0] if row else None

            cur.execute("SELECT id, slug FROM canonical_categories")
            by_slug = {r[1]: r[0] for r in cur.fetchall()}

        if not supermarket_slug:
            fallback = by_slug.get(DEFAULT_CATEGORY_SLUG)
            return {name: fallback for name in names}

        resolved = {name: resolve_source_category(supermarket_slug, name) for name in names}
        mapping = {}
        unmatched = []
        for name, slug in resolved.items():
            cid = by_slug.get(slug)
            if cid:
                mapping[name] = cid
            else:
                unmatched.append(name)

        if unmatched:
            fallback = by_slug.get(DEFAULT_CATEGORY_SLUG)
            for name in unmatched:
                mapping[name] = fallback
                print(f"  ⚠ Categoria de origem sem mapeamento: {name!r} -> {DEFAULT_CATEGORY_SLUG}")

        self._upsert_category_mappings(supermarket_id, resolved, by_slug)
        return mapping

    def _upsert_category_mappings(self, supermarket_id, resolved, by_slug):
        query = sql.SQL(
            """
            INSERT INTO category_mappings (supermarket_id, source_name, canonical_category_id)
            VALUES %s
            ON CONFLICT (supermarket_id, source_name) DO UPDATE
            SET canonical_category_id = EXCLUDED.canonical_category_id
            """
        )
        values = [
            (supermarket_id, name, by_slug.get(slug))
            for name, slug in resolved.items()
            if by_slug.get(slug)
        ]
        if not values:
            return
        try:
            with self.conn.cursor() as cur:
                execute_values(cur, query.as_string(self.conn), values)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def bulk_upsert_products(self, supermarket_id, products):
        if not products:
            return

        # Deduplicate products by external_id before bulk upsert to avoid cardinality violations.
        unique = {}
        for item in products:
            external_id = item.get('external_id')
            if not external_id:
                continue
            if external_id not in unique:
                unique[external_id] = item
        products = list(unique.values())

        query = sql.SQL(
            """
            INSERT INTO products (
              supermarket_id, category_id, external_id, name, brand, description,
              price, price_currency, unit, url, image_url, in_stock, deleted,
              last_scraped_at, created_at, updated_at
            ) VALUES %s
            ON CONFLICT (supermarket_id, external_id) DO UPDATE
            SET category_id = EXCLUDED.category_id,
                name = EXCLUDED.name,
                brand = EXCLUDED.brand,
                description = EXCLUDED.description,
                price = EXCLUDED.price,
                price_currency = EXCLUDED.price_currency,
                unit = EXCLUDED.unit,
                url = EXCLUDED.url,
                image_url = EXCLUDED.image_url,
                in_stock = EXCLUDED.in_stock,
                deleted = EXCLUDED.deleted,
                last_scraped_at = EXCLUDED.last_scraped_at,
                updated_at = now()
            WHERE products.price IS DISTINCT FROM EXCLUDED.price
               OR products.name IS DISTINCT FROM EXCLUDED.name
               OR products.brand IS DISTINCT FROM EXCLUDED.brand
               OR products.in_stock IS DISTINCT FROM EXCLUDED.in_stock;
            """
        )

        now = datetime.now(timezone.utc)
        values = [(
            supermarket_id,
            item.get('category_id'),
            item['external_id'],
            item['name'],
            item.get('brand'),
            item.get('description'),
            item.get('price', 0.0),
            item.get('price_currency', 'EUR'),
            item.get('unit'),
            item.get('url'),
            item.get('image_url'),
            item.get('in_stock', True),
            item.get('deleted', False),
            item.get('last_scraped_at') or now,
            item.get('created_at') or now,
            item.get('updated_at') or now,
        ) for item in products]

        try:
            with self.conn.cursor() as cur:
                execute_values(cur, query.as_string(self.conn), values)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def bulk_insert_price_history(self, price_records):
        if not price_records:
            return

        query = """
            INSERT INTO price_history (
              product_id, price, price_currency, recorded_at, created_at
            ) VALUES %s
        """

        now = datetime.now(timezone.utc)
        values = [(
            item['product_id'],
            item['price'],
            item.get('price_currency', 'EUR'),
            item.get('recorded_at') or now,
            item.get('created_at') or now,
        ) for item in price_records]

        try:
            with self.conn.cursor() as cur:
                execute_values(cur, query, values)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def mark_missing_products(self, supermarket_id, scraped_external_ids):
        try:
            with self.conn.cursor() as cur:
                if scraped_external_ids:
                    # NOT EXISTS + unnest: evita uma lista de parâmetros gigante
                    # (o NOT IN com 44k ids do Continente satura o parser do
                    # PostgreSQL e degrada o plano de execução no free tier).
                    cur.execute(
                        """
                        UPDATE products
                        SET in_stock = false,
                            deleted = true,
                            updated_at = now()
                        WHERE supermarket_id = %s
                          AND (deleted = false OR in_stock = true)
                          AND NOT EXISTS (
                              SELECT 1
                              FROM unnest(%s::text[]) AS t(eid)
                              WHERE t.eid = external_id
                          )
                        """,
                        (supermarket_id, list(scraped_external_ids))
                    )
                else:
                    cur.execute(
                        """
                        UPDATE products
                        SET in_stock = false,
                            deleted = true,
                            updated_at = now()
                        WHERE supermarket_id = %s
                          AND (deleted = false OR in_stock = true)
                        """,
                        (supermarket_id,)
                    )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def prune_old_data(self) -> None:
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT prune_price_history_older_than_30_days();")
            self.conn.commit()
            print("  ✓ Histórico de preços com mais de 30 dias podado com sucesso.")
        except Exception as e:
            self.conn.rollback()
            print(f"  Erro ao podar dados antigos da BD: {e}")
            raise e

    def get_active_product_counts(self) -> dict[str, int]:
        query = """
            SELECT s.name, COUNT(p.id)
            FROM products p
            JOIN supermarkets s ON p.supermarket_id = s.id
            WHERE p.deleted = false AND p.in_stock = true
            GROUP BY s.name
        """
        counts = {}
        try:
            with self.conn.cursor() as cur:
                cur.execute(query)
                rows = cur.fetchall()
                for name, count in rows:
                    counts[name] = count
        except Exception as e:
            print(f"  Erro ao contar produtos ativos: {e}")
        return counts

    def close(self):
        if self.conn:
            self.conn.close()

