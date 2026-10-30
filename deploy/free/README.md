# Free deployment

The API runs on Render Free in Frankfurt; persistent PostgreSQL runs on Neon
Free in Frankfurt. Do not provision Render's expiring free PostgreSQL service.
Production API: https://pricescoutpt-api.onrender.com (database check: `/api/health`).
No payment method or paid add-on is required. Free quotas can pause service;
review usage rather than upgrading automatically.

## Database initialization

Copy `.env.example` to the ignored `.env` file in this directory. Set
`DATABASE_ADMIN_URL` to the Neon **direct** owner connection with TLS required.
Run `scraper/.venv/bin/python deploy/free/bootstrap_database.py` from the repository
root. This initializes an empty database and creates a restricted runtime role.
It refuses to reset an existing or partially initialized schema. Save the ignored
file securely: it holds owner and runtime credentials. Never commit it.

## API

`render.yaml` records the Docker path, explicit Free plan and region. Set these
Render environment variables: `NODE_ENV=production`, the restricted runtime
`DATABASE_URL`, and a random `SCRAPE_SECRET`. Never use the owner connection in
the service. Build from `main` using `api/Dockerfile` and root Docker context.
Automatic deploys are off; deploy reviewed commits manually in Render.

Use `/api/live` for platform health probes; it does not wake Neon. Verify
`/api/health` separately after deployment and confirm `db` is `up`.

## Scheduled collection

Configure GitHub Actions secret `PRICESCOUTPT_DATABASE_URL` with the restricted
runtime connection and secret `PRICESCOUT_API_SCRAPE_SECRET` with the same
collection key as Render. Repository variable `PRICESCOUT_API_URL` is the actual
Render HTTPS service URL. Enable `daily-scrape.yml` after the API is healthy.

The workflow runs daily at 12:00 UTC, or manually with collector/detail choices.
Five collectors run on the public GitHub runner. Froiz runs through the API
because its catalogue has rejected GitHub runner traffic. Hosting may also be
rejected: the job reports failure rather than inventing prices or bypassing
access restrictions. It polls actual completion and never silently treats HTTP
202 as a successful scrape. Partial observations remain saved.

Collection stops when the database is already 800 MiB, leaving headroom below
the free storage quota. Review growth, retention and usage in Neon. The guard
is not a billing guarantee or an exact upper bound during a running collector.
App-only chains without a working feed remain explicitly unavailable; authorized
imports and receipt observations can add real prices.

Render Free sleeps when idle, so the first request can take about a minute.
There is no artificial keep-alive job. The mobile app should keep its offline
catalogue available while the server wakes.
