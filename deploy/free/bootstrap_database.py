"""Initialize an empty Neon database and save a restricted runtime connection.

Run with scraper/.venv/bin/python deploy/free/bootstrap_database.py.
Credentials are read/written only in deploy/free/.env, never printed.
Existing application schemas require explicit migrations, never an implicit reset.
"""
import os
from pathlib import Path
import secrets
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit

from dotenv import load_dotenv
import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[2]
CREDENTIALS = Path(__file__).parent / '.env'


def main():
    load_dotenv(CREDENTIALS)
    admin_url = os.environ.get('DATABASE_ADMIN_URL', '')
    parsed = urlsplit(admin_url)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.username:
        raise SystemExit('Configure DATABASE_ADMIN_URL in deploy/free/.env first.')
    if parse_qs(parsed.query).get('sslmode', [''])[0] not in ('require', 'verify-ca', 'verify-full'):
        raise SystemExit('The production database connection must require TLS.')
    if '-pooler.' in parsed.hostname:
        raise SystemExit('Use the direct Neon connection for database initialization.')
    runtime_url = os.environ.get('DATABASE_URL')
    with psycopg2.connect(admin_url, connect_timeout=30) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.products')")
            if cursor.fetchone()[0] is None:
                cursor.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
                if cursor.fetchone()[0]:
                    raise SystemExit('This database already has public tables; use a new dedicated database.')
                cursor.execute((ROOT / 'database/init.sql').read_text())
                print('Initialized the complete schema in the empty database.')
            else:
                cursor.execute("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name IN ('observed_at','barcode','source_type','metadata')")
                if cursor.fetchone()[0] != 4:
                    raise SystemExit('Existing schema needs the documented migrations; no changes made.')
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname='pricescout_runtime'")
            if cursor.fetchone():
                if not runtime_url:
                    raise SystemExit('Runtime role already exists; supply its existing DATABASE_URL. Credentials were not reset.')
                existing = urlsplit(runtime_url)
                if existing.username != 'pricescout_runtime' or existing.path != parsed.path or existing.hostname != parsed.hostname:
                    raise SystemExit('Existing runtime connection must match this dedicated database and role.')
            else:
                password = secrets.token_urlsafe(36)
                cursor.execute(sql.SQL('CREATE ROLE pricescout_runtime LOGIN PASSWORD {}').format(sql.Literal(password)))
                authority = 'pricescout_runtime:' + quote(password, safe='') + '@' + parsed.hostname
                if parsed.port:
                    authority += ':' + str(parsed.port)
                runtime_url = urlunsplit((parsed.scheme, authority, parsed.path, parsed.query, ''))
            cursor.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO pricescout_runtime').format(sql.Identifier(parsed.path.lstrip('/'))))
            cursor.execute('GRANT USAGE ON SCHEMA public TO pricescout_runtime')
            cursor.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO pricescout_runtime')
            cursor.execute('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO pricescout_runtime')
            cursor.execute('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO pricescout_runtime')
    # Persist credentials before verification so a transient network failure
    # cannot leave a new role with an unknown password.
    descriptor = os.open(CREDENTIALS, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as destination:
        destination.write('DATABASE_ADMIN_URL=' + admin_url + '\nDATABASE_URL=' + runtime_url + '\n')
    CREDENTIALS.chmod(0o600)
    with psycopg2.connect(runtime_url, connect_timeout=30) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user,has_database_privilege(current_user,current_database(),'CREATE'),pg_database_size(current_database())")
            user, can_create, size = cursor.fetchone()
            if can_create:
                raise SystemExit('Runtime role unexpectedly has database creation rights; inspect grants before deployment.')
            print(f'Runtime role {user} verified. Database size: {size / 1024 / 1024:.1f} MiB.')
    print('Runtime credentials saved to ignored deploy/free/.env. Do not publish this file.')


if __name__ == '__main__':
    try:
        main()
    except psycopg2.Error as exc:
        # Connection errors can include infrastructure details. SQLSTATE is
        # sufficient here; credentials remain in the local ignored file.
        raise SystemExit(f'Database setup failed (SQLSTATE {exc.pgcode or "connection"}); inspect the connection locally.') from None
