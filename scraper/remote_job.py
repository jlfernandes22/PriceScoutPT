"""Run a bounded collector on the deployed API and wait for its actual result."""
import argparse
import os
import time
from urllib.parse import urlsplit

import requests


def run_remote_job(base_url, secret, scrapers, details_limit=100, *, session=None,
                   timeout=1800, poll_interval=15, sleep=time.sleep,
                   monotonic=time.monotonic):
    parsed = urlsplit(base_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('PRICESCOUT_API_URL must be a plain HTTPS base URL.')
    allowed = {'Continente', 'Lidl', 'PingoDoce', 'Aldi', 'Auchan', 'Froiz'}
    if not secret or not scrapers or any(name not in allowed for name in scrapers):
        raise ValueError('An API secret and explicit supported collectors are required.')
    if type(details_limit) is not int or not 0 <= details_limit <= 250:
        raise ValueError('details_limit must be between 0 and 250.')
    session = session or requests.Session()
    base = base_url.rstrip('/')
    headers = {'X-Scrape-Secret': secret}

    def request(method, path, **kwargs):
        response = session.request(method, base + path, headers=headers,
                                   timeout=120, allow_redirects=False, **kwargs)
        if 300 <= response.status_code < 400:
            raise RuntimeError('The API redirected the request; refusing to forward credentials.')
        return response

    response = request('POST', '/api/scrape', json={
        'scrapers': list(dict.fromkeys(scrapers)), 'details_limit': details_limit,
    })
    if response.status_code not in (202, 409):
        raise RuntimeError(f'The API refused collection (HTTP {response.status_code}).')
    data = response.json()
    job_id = data.get('job_id') if response.status_code == 202 else data.get('running_job_id')
    # UUID-only status paths cannot turn a server response into another URL.
    import uuid
    try:
        job_id = str(uuid.UUID(job_id))
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError('The API returned an invalid collection job ID.') from None
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        status = request('GET', '/api/scrape/status/' + job_id)
        if status.status_code != 200:
            raise RuntimeError(f'Collection status unavailable (HTTP {status.status_code}); do not start a duplicate job blindly.')
        job = status.json()
        if set(job.get('scrapers', [])) != set(scrapers):
            raise RuntimeError('The running job belongs to different collectors; refusing to join it.')
        state = job.get('status')
        print(f'Remote collection {job_id}: {state}', flush=True)
        if state in ('completed', 'failed'):
            for line in job.get('log_tail', [])[-20:]:
                print(str(line).replace(secret, '[redacted]'), flush=True)
            if state != 'completed' or job.get('exit_code', 0) != 0:
                raise RuntimeError('Remote collection failed or reported incomplete source coverage.')
            return job
        if state != 'running':
            raise RuntimeError('The API returned an unknown collection status.')
        sleep(poll_interval)
    raise RuntimeError('Remote collection did not finish before the deadline; inspect its status before retrying.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scrapers', default='Froiz')
    parser.add_argument('--details-limit', type=int, default=100)
    args = parser.parse_args()
    try:
        run_remote_job(os.environ.get('PRICESCOUT_API_URL', ''),
                       os.environ.get('PRICESCOUT_API_SCRAPE_SECRET', ''),
                       args.scrapers.split(','), args.details_limit)
    except (ValueError, RuntimeError, requests.RequestException) as exc:
        # Requests exception messages may contain URLs. Never include a secret
        # supplied by the operator in a CI log, including malformed responses.
        secret = os.environ.get('PRICESCOUT_API_SCRAPE_SECRET')
        message = str(exc).replace(secret, '[redacted]') if secret else str(exc)
        raise SystemExit(message)
