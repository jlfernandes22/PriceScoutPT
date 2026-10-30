"""GitHub-runner collectors plus a hosted Froiz job, with truthful final status."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scraper'))
from remote_job import run_remote_job
from check_database import check_database

DIRECT = ['Aldi', 'Lidl', 'PingoDoce', 'Auchan', 'Continente']


def select_collectors(value):
    names = DIRECT + ['Froiz'] if value == 'all' else list(dict.fromkeys(value.split(',')))
    if not names or any(name not in DIRECT + ['Froiz'] for name in names):
        raise ValueError('Unsupported collector selection.')
    return [name for name in DIRECT if name in names], 'Froiz' in names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scrapers', default='all')
    parser.add_argument('--details-limit', type=int, choices=(0, 25, 100, 250), default=100)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        direct, hosted = select_collectors(args.scrapers)
    except ValueError as exc:
        parser.error(str(exc))
    if args.dry_run:
        print('GitHub collectors:', ','.join(direct) or '(none)')
        print('Hosted Froiz:', hosted)
        return 0
    if not os.environ.get('DATABASE_URL'):
        raise SystemExit('Configure the restricted Neon DATABASE_URL in GitHub secrets.')
    if hosted and not all(os.environ.get(key) for key in ('PRICESCOUT_API_URL', 'PRICESCOUT_API_SCRAPE_SECRET')):
        raise SystemExit('Configure the API URL and collection secret before running Froiz.')
    check_database()
    failed = False
    if hosted:
        try:
            run_remote_job(os.environ['PRICESCOUT_API_URL'],
                           os.environ['PRICESCOUT_API_SCRAPE_SECRET'], ['Froiz'], args.details_limit)
        except Exception as exc:
            message = str(exc).replace(os.environ['PRICESCOUT_API_SCRAPE_SECRET'], '[redacted]')
            print('Froiz collection failed:', message, flush=True)
            failed = True
    if direct:
        environment = {**os.environ, 'DISCORD_WEBHOOK_URL': '', 'SLACK_WEBHOOK_URL': '', 'PYTHONUNBUFFERED': '1'}
        result = subprocess.run([sys.executable, '-u', 'main.py', '--scraper', ','.join(direct),
                                 '--details-limit', str(args.details_limit)],
                                cwd=ROOT / 'scraper', env=environment)
        failed = failed or result.returncode != 0
    check_database()
    if failed:
        print('One or more collectors failed or reported partial coverage. Saved observations were preserved.', file=sys.stderr)
    return 1 if failed else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        # No DSNs or request headers in CI failure messages.
        import psycopg2
        if isinstance(exc, psycopg2.Error):
            raise SystemExit(f'Database access failed (SQLSTATE {exc.pgcode or "connection"}).') from None
        raise
