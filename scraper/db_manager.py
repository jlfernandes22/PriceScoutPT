import os
from datetime import datetime, timezone
import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_values, Json

# Tamanho dos lotes de escrita. O free tier (B1ms, 1 vCPU burstable) não
# aguenta um único INSERT com 40k+ linhas (cada linha dispara o trigger
# to_tsvector em pt-PT) — satura a CPU e o servidor fecha ligações. Lotes
# pequenos mantêm cada statement leve e permitem progresso parcial.
# 2000 por statement + commit por statement: equilíbrio entre round-trips
# de rede (cada commit é uma ida ao servidor) e segurança de progresso.
UPSERT_CHUNK_SIZE = 2000
HISTORY_CHUNK_SIZE = 4000


class DBManager:
    def __init__(self, dsn=None):
        self.dsn = dsn or os.environ.get('DATABASE_URL')
        if not self.dsn:
            raise ValueError('DATABASE_URL environment variable is required for DBManager.')
        # Retry no arranque: redes de datacenter/domésticas são intermitentes;
        # sem isto uma falha transitória matava a recolha antes de começar.
        import time as _time
        last_exc = None
        for attempt in range(3):
            try:
                self.conn = self._connect()
                break
            except psycopg2.OperationalError as e:
                last_exc = e
                if attempt < 2:
                    _time.sleep(3 * (attempt + 1))
        else:
            raise last_exc

    def _connect(self):
        """Abre uma ligação com timeouts explícitos.

        - `tcp_user_timeout` (libpq): se a rede "engolir" ACKs (ligação morta sem
          erro visível), o SO fecha-a ao fim de 60s e a operação falha em vez de
          ficar presa para sempre.
        - `statement_timeout` (servidor): a BD do free tier é lenta; um statement
          preso > 3 min é cancelado e o erro dispara a reconexão.
        """
        conn = psycopg2.connect(self.dsn, connect_timeout=15, tcp_user_timeout=60000)
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = 180000")
        conn.commit()
        return conn

    def _ensure_conn(self):
        """Reconecta se a ligação caiu (ex.: o servidor fecha-a sob carga no free
        tier). Sem isto, um único 'connection already closed' matava a recolha."""
        if self.conn is None or self.conn.closed:
            self.conn = self._connect()
        return self.conn

    def _retry_write(self, fn):
        """Executa fn(conn). Em caso de ligação morta OU timeout (rede a "engolir"
        respostas, statement lento), força reconexão e tenta de novo uma vez."""
        try:
            return fn(self._ensure_conn())
        except (psycopg2.InterfaceError, psycopg2.OperationalError):
            try:
                self.conn.close()
            except Exception:
                pass
            self.conn = None
            return fn(self._ensure_conn())

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

        def _run(conn):
            with conn.cursor() as cur:
                execute_values(cur, query.as_string(conn), values)
            conn.commit()

        try:
            self._retry_write(_run)
        except Exception:
            try:
                self._ensure_conn().rollback()
            except Exception:
                pass
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

        conn = self._ensure_conn()
        with conn.cursor() as cur:
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

        def _run(conn):
            with conn.cursor() as cur:
                execute_values(cur, query.as_string(conn), values)
            conn.commit()

        try:
            self._retry_write(_run)
        except Exception:
            try:
                self._ensure_conn().rollback()
            except Exception:
                pass
            raise

    def bulk_upsert_products(self, supermarket_id, products):
        if not products:
            return 0

        # One export can contain several dated receipts for the same SKU/store.
        # Keep the latest observation even when the input is oldest-first.
        unique = {}
        fallback_time = datetime.now(timezone.utc)
        def observed_time(item):
            value = item.get('observed_at') or item.get('last_scraped_at') or fallback_time
            if isinstance(value, str):
                value = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value
        for item in products:
            external_id = item.get('external_id')
            if not external_id:
                continue
            if external_id not in unique or observed_time(item) >= observed_time(unique[external_id]):
                unique[external_id] = item
        products = list(unique.values())

        query = sql.SQL(
            """
            INSERT INTO products (
              supermarket_id, category_id, external_id, name, brand, description,
              price, price_currency, unit, url, image_url, in_stock, deleted,
              last_scraped_at, created_at, updated_at,
              barcode, regular_price, unit_price, unit_price_unit,
              source_type, source_url, observed_at, requires_loyalty_card,
              valid_from, valid_to, metadata, store_location
            ) VALUES %s
            ON CONFLICT (supermarket_id, external_id) DO UPDATE
            SET category_id = COALESCE(EXCLUDED.category_id, products.category_id),
                name = EXCLUDED.name,
                brand = COALESCE(EXCLUDED.brand, products.brand),
                description = COALESCE(EXCLUDED.description, products.description),
                price = EXCLUDED.price,
                price_currency = EXCLUDED.price_currency,
                unit = COALESCE(EXCLUDED.unit, products.unit),
                url = COALESCE(EXCLUDED.url, products.url),
                image_url = COALESCE(EXCLUDED.image_url, products.image_url),
                barcode = COALESCE(EXCLUDED.barcode, products.barcode),
                regular_price = EXCLUDED.regular_price,
                unit_price = EXCLUDED.unit_price,
                unit_price_unit = EXCLUDED.unit_price_unit,
                source_type = EXCLUDED.source_type,
                source_url = EXCLUDED.source_url,
                store_location = EXCLUDED.store_location,
                observed_at = EXCLUDED.observed_at,
                requires_loyalty_card = EXCLUDED.requires_loyalty_card,
                valid_from = EXCLUDED.valid_from,
                valid_to = EXCLUDED.valid_to,
                metadata = products.metadata || EXCLUDED.metadata,
                in_stock = EXCLUDED.in_stock,
                deleted = EXCLUDED.deleted,
                last_scraped_at = EXCLUDED.last_scraped_at,
                updated_at = now()
            -- Older exports must never overwrite a newer price observation.
            WHERE products.observed_at IS NULL
               OR EXCLUDED.observed_at >= products.observed_at;
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
            item.get('barcode') or item.get('gtin'),
            item.get('regular_price'),
            item.get('unit_price'),
            item.get('unit_price_unit'),
            item.get('source_type', 'online_catalog'),
            item.get('source_url') or item.get('url'),
            item.get('observed_at') or item.get('last_scraped_at') or now,
            item.get('requires_loyalty_card', (item.get('metadata') or {}).get('requires_loyalty_card', False)),
            item.get('valid_from') or (item.get('metadata') or {}).get('valid_from'),
            item.get('valid_to') or (item.get('metadata') or {}).get('valid_to'),
            Json(item.get('metadata') or {}),
            item.get('store_location'),
        ) for item in products]

        # Escrita em lotes: cada lote é um statement pequeno + commit. Se a BD
        # do free tier ficar sobrecarregada e fechar a ligação, apenas o lote
        # atual se perde — e a reconexão retoma nos seguintes.
        written = 0
        for start in range(0, len(values), UPSERT_CHUNK_SIZE):
            chunk = values[start:start + UPSERT_CHUNK_SIZE]

            def _run(conn, chunk=chunk):
                with conn.cursor() as cur:
                    execute_values(cur, query.as_string(conn), chunk, page_size=UPSERT_CHUNK_SIZE)
                    count = cur.rowcount
                conn.commit()
                return count

            try:
                written += self._retry_write(_run)
            except Exception:
                try:
                    self._ensure_conn().rollback()
                except Exception:
                    pass
                raise

        return written

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

        for start in range(0, len(values), HISTORY_CHUNK_SIZE):
            chunk = values[start:start + HISTORY_CHUNK_SIZE]

            def _run(conn, chunk=chunk):
                with conn.cursor() as cur:
                    execute_values(cur, query, chunk)
                conn.commit()

            try:
                self._retry_write(_run)
            except Exception:
                try:
                    self._ensure_conn().rollback()
                except Exception:
                    pass
                raise

    def mark_missing_products(self, supermarket_id, scraped_external_ids, source_type='online_catalog'):
        def _run(conn):
            with conn.cursor() as cur:
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
                          AND source_type = %s
                          AND (deleted = false OR in_stock = true)
                          AND NOT EXISTS (
                              SELECT 1
                              FROM unnest(%s::text[]) AS t(eid)
                              WHERE t.eid = external_id
                          )
                        """,
                        (supermarket_id, source_type, list(scraped_external_ids))
                    )
                else:
                    cur.execute(
                        """
                        UPDATE products
                        SET in_stock = false,
                            deleted = true,
                            updated_at = now()
                        WHERE supermarket_id = %s
                          AND source_type = %s
                          AND (deleted = false OR in_stock = true)
                        """,
                        (supermarket_id, source_type)
                    )
            conn.commit()

        try:
            self._retry_write(_run)
        except Exception:
            try:
                self._ensure_conn().rollback()
            except Exception:
                pass
            raise

    def prune_old_data(self) -> None:
        def _run(conn):
            with conn.cursor() as cur:
                cur.execute("SELECT prune_price_history_older_than_30_days();")
            conn.commit()

        try:
            self._retry_write(_run)
            print("  ✓ Histórico de preços com mais de 30 dias podado com sucesso.")
        except Exception as e:
            try:
                self._ensure_conn().rollback()
            except Exception:
                pass
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
            with self._ensure_conn().cursor() as cur:
                cur.execute(query)
                rows = cur.fetchall()
                for name, count in rows:
                    counts[name] = count
        except Exception as e:
            print(f"  Erro ao contar produtos ativos: {e}")
        return counts

    def close(self):
        if self.conn and not self.conn.closed:
            self.conn.close()
