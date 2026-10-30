"""Report storage and stop collection before the 1 GB free quota is full."""
import os
import psycopg2


def check_database():
    with psycopg2.connect(os.environ['DATABASE_URL'], connect_timeout=30) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_database_size(current_database())')
            size = cursor.fetchone()[0]
            print(f'Database storage: {size / 1024 / 1024:.1f} MiB (collection guard: 800 MiB).', flush=True)
            cursor.execute('SELECT count(*) FROM products WHERE NOT deleted AND in_stock AND price > 0')
            print('Active priced products:', cursor.fetchone()[0], flush=True)
            if size >= 800 * 1024 * 1024:
                raise RuntimeError('Collection stopped before the free quota is full. Review storage and retention; do not enable a paid upgrade.')


if __name__ == '__main__':
    try:
        check_database()
    except psycopg2.Error as exc:
        raise SystemExit(f'Database check failed (SQLSTATE {exc.pgcode or "connection"}).') from None
    except RuntimeError as exc:
        raise SystemExit(str(exc))
