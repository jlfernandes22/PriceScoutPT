"""Import verified Portuguese prices from CSV/JSON exports or transcribed receipts.

Validate the entire input before opening the database; never infer prices or
delete products missing from an observation file. No account credentials needed.
"""
import argparse
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

RETAILERS = json.loads(Path(__file__).with_name('retailers.json').read_text())
SOURCES = ('manual', 'receipt', 'authorised_feed', 'leaflet', 'public_listing')


def money(value, field='price', required=True):
    if value is None or str(value).strip() == '':
        if required:
            raise ValueError(f'{field} is required')
        return None
    text = str(value).strip().replace('€', '').replace('\xa0', '').replace(' ', '')
    if ',' in text:
        text = text.replace('.', '').replace(',', '.')
    try:
        result = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f'{field}: invalid number {value!r}') from exc
    if not result.is_finite() or result <= 0 or result >= 1000000:
        raise ValueError(f'{field} must be a positive finite unit price below 1000000')
    return result


def parse_date(value, field, end_of_day=False):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace('Z', '+00:00'))
        if end_of_day and len(str(value).strip()) == 10:
            parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo('Europe/Lisbon'))
        return parsed.astimezone(timezone.utc)
    except ValueError as exc:
        raise ValueError(f'{field} must be an ISO date or timestamp') from exc


def boolean(value, default=False):
    if value is None or value == '':
        return default
    if str(value).lower() in ('true', '1', 'yes', 'sim'):
        return True
    if str(value).lower() in ('false', '0', 'no', 'nao', 'não'):
        return False
    raise ValueError(f'invalid boolean {value!r}')


def web_url(value, field):
    if not value:
        return None
    parsed = urlparse(str(value).strip())
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username:
        raise ValueError(f'{field} must be an http(s) URL')
    return parsed.geturl()


def normalize_row(row, source, now=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(row, dict):
        raise ValueError('each product must be an object')
    name = str(row.get('name') or '').strip()
    if not name or len(name) > 500:
        raise ValueError('name is required (max 500 characters)')
    price = money(row.get('price'))
    observed = parse_date(row.get('observed_at'), 'observed_at')
    if observed is None:
        raise ValueError('observed_at is required: record when the price was actually seen')
    if observed > now + timedelta(minutes=5):
        raise ValueError('observed_at cannot be in the future')
    location = str(row.get('store_location') or '').strip()
    if source in ('receipt', 'manual') and not location:
        raise ValueError('store_location is required for receipt/manual observations')
    barcode = str(row.get('barcode') or row.get('gtin') or '').strip() or None
    if barcode and not re.fullmatch(r'\d{8}|\d{12,14}', barcode):
        raise ValueError('barcode must contain 8, 12, 13 or 14 digits')
    valid_from = parse_date(row.get('valid_from'), 'valid_from')
    valid_to = parse_date(row.get('valid_to'), 'valid_to', end_of_day=True)
    if source in ('leaflet', 'public_listing') and valid_to is None:
        raise ValueError('valid_to is required for promotional observations')
    if valid_to is None and source in ('manual', 'receipt'):
        valid_to = observed + timedelta(days=14)
    if valid_from and valid_to and valid_to <= valid_from:
        raise ValueError('valid_to must be after valid_from')
    metadata = row.get('metadata') or {}
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    if not isinstance(metadata, dict):
        raise ValueError('metadata must be an object')
    if str(row.get('country') or metadata.get('country') or 'PT').upper() != 'PT':
        raise ValueError('only prices observed in Portugal (country=PT) can be imported')
    if str(row.get('price_currency') or 'EUR').upper() != 'EUR':
        raise ValueError('only EUR prices can be imported')
    metadata = dict(metadata, country='PT')
    # Keep receipt/account/customer data out of the catalogue.
    for key in ('customer', 'customer_name', 'nif', 'email', 'address', 'loyalty_number', 'receipt_number'):
        metadata.pop(key, None)
    identity = row.get('external_id') or barcode or '|'.join(
        str(row.get(key) or '').strip().casefold() for key in ('name', 'brand', 'unit'))
    digest = hashlib.sha256(f'{source}|{location.casefold()}|{identity}'.encode()).hexdigest()[:24]
    return {
        'external_id': f'import:{source}:{digest}',
        'name': name, 'price': price, 'price_currency': 'EUR',
        'brand': row.get('brand') or None,
        'description': row.get('description') or None,
        'category_name': row.get('category_name') or 'Outros',
        'unit': row.get('unit') or None, 'barcode': barcode,
        'regular_price': money(row.get('regular_price'), 'regular_price', required=False),
        'unit_price': money(row.get('unit_price'), 'unit_price', required=False),
        'unit_price_unit': row.get('unit_price_unit') or None,
        'source_type': source, 'store_location': location or None,
        'source_url': web_url(row.get('source_url'), 'source_url'),
        'url': web_url(row.get('url'), 'url'),
        'image_url': web_url(row.get('image_url'), 'image_url'),
        'observed_at': observed,
        'requires_loyalty_card': boolean(row.get('requires_loyalty_card', metadata.get('requires_loyalty_card'))),
        'valid_from': valid_from, 'valid_to': valid_to,
        'metadata': metadata,
        'in_stock': boolean(row.get('in_stock'), default=True), 'deleted': False,
    }


def read_products(path):
    with path.open(encoding='utf-8-sig', newline='') as handle:
        if path.suffix.lower() == '.json':
            data = json.load(handle)
            rows = data.get('products') if isinstance(data, dict) else data
        elif path.suffix.lower() == '.csv':
            sample = handle.read(8192)
            handle.seek(0)
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
            except csv.Error:
                dialect = csv.excel
            rows = list(csv.DictReader(handle, dialect=dialect))
        else:
            raise ValueError('use a .csv or .json file')
    if not isinstance(rows, list) or not rows or len(rows) > 50000:
        raise ValueError('file must contain between 1 and 50000 products')
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path, nargs='?')
    parser.add_argument('--supermarket', choices=[r['slug'] for r in RETAILERS])
    parser.add_argument('--source', choices=SOURCES, default='manual')
    parser.add_argument('--dry-run', action='store_true', help='validate without connecting to the database')
    parser.add_argument('--list-supermarkets', action='store_true')
    args = parser.parse_args(argv)
    if args.list_supermarkets:
        for retailer in RETAILERS:
            print(f"{retailer['slug']}: {retailer['name']} ({retailer['collection']})")
        return 0
    if not args.file or not args.supermarket:
        parser.error('file and --supermarket are required')
    try:
        products = []
        for index, row in enumerate(read_products(args.file), 1):
            try:
                products.append(normalize_row(row, args.source))
            except (ValueError, TypeError) as exc:
                raise ValueError(f'row {index}: {exc}') from exc
        if args.dry_run:
            print(f'Validated {len(products)} {args.supermarket} price observations; no database writes.')
            return 0
        from dotenv import load_dotenv
        from db_manager import DBManager
        load_dotenv()
        manager = DBManager(os.environ.get('DATABASE_URL'))
        try:
            retailer = next(r for r in RETAILERS if r['slug'] == args.supermarket)
            mapping = manager.resolve_category_ids(retailer['id'], [p['category_name'] for p in products])
            for product in products:
                product['category_id'] = mapping.get(product['category_name'])
            written = manager.bulk_upsert_products(retailer['id'], products)
            print(f'Validated {len(products)} rows; saved {written} latest observations for {retailer["name"]}. Sync the app to download them.')
        finally:
            manager.close()
        return 0
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    raise SystemExit(main())
