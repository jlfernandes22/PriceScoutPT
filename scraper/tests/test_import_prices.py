from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from import_prices import normalize_row, read_products, money


class PriceImportTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
        self.row = {'name': 'Leite meio gordo', 'price': '0,89 €', 'unit': '1 l',
                    'observed_at': '2026-10-28', 'store_location': 'Porto - loja A'}

    def test_decimal_prices_and_invalid_values(self):
        self.assertEqual(money('1.234,56 €'), Decimal('1234.56'))
        for value in ('nan', 'Infinity', '-1', '0', 'abc', ''):
            with self.assertRaises(ValueError):
                money(value)

    def test_receipt_scope_expiry_and_provenance(self):
        product = normalize_row(self.row, 'receipt', self.now)
        self.assertEqual(product['source_type'], 'receipt')
        self.assertEqual(product['price'], Decimal('.89'))
        self.assertEqual(product['store_location'], self.row['store_location'])
        self.assertEqual(product['valid_to'] - product['observed_at'], timedelta(days=14))
        self.assertEqual(product['metadata']['country'], 'PT')
        self.assertTrue(product['external_id'].startswith('import:receipt:'))

    def test_reimport_identity_is_stable_price_is_not_identity(self):
        first = normalize_row(self.row, 'manual', self.now)
        self.row['price'] = '0,99'
        self.assertEqual(first['external_id'], normalize_row(self.row, 'manual', self.now)['external_id'])
        self.row['store_location'] = 'Lisboa - loja B'
        self.assertNotEqual(first['external_id'], normalize_row(self.row, 'manual', self.now)['external_id'])

    def test_observation_date_and_location_are_required(self):
        for key in ('observed_at', 'store_location'):
            row = dict(self.row)
            del row[key]
            with self.assertRaises(ValueError):
                normalize_row(row, 'receipt', self.now)

    def test_future_dates_and_bad_barcodes_rejected(self):
        with self.assertRaises(ValueError):
            normalize_row(dict(self.row, observed_at='2027-01-01'), 'manual', self.now)
        with self.assertRaises(ValueError):
            normalize_row(dict(self.row, barcode='abcd1234'), 'manual', self.now)

    def test_end_date_includes_local_calendar_day(self):
        row = normalize_row(dict(self.row, valid_to='2026-10-29'), 'leaflet', self.now)
        self.assertEqual(row['valid_to'].hour, 23)
        self.assertEqual(row['valid_to'].minute, 59)
        with self.assertRaises(ValueError):
            normalize_row(self.row, 'leaflet', self.now)

    def test_flags_and_urls_validated(self):
        row = normalize_row(dict(self.row, requires_loyalty_card='sim'), 'manual', self.now)
        self.assertTrue(row['requires_loyalty_card'])
        self.assertTrue(normalize_row(dict(self.row, metadata={'requires_loyalty_card': True}), 'manual', self.now)['requires_loyalty_card'])
        for fields in ({'in_stock': 'maybe'}, {'source_url': 'javascript:alert(1)'}, {'image_url': 'file:///tmp/a'}):
            with self.assertRaises(ValueError):
                normalize_row(dict(self.row, **fields), 'manual', self.now)
        for fields in ({'country': 'ES'}, {'price_currency': 'GBP'}):
            with self.assertRaises(ValueError):
                normalize_row(dict(self.row, **fields), 'manual', self.now)

    def test_json_and_portuguese_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'prices.csv')
            path.write_text('name;price;observed_at;store_location\nLeite;0,89;2026-10-28;Porto\n')
            self.assertEqual(read_products(path)[0]['price'], '0,89')
            path = Path(directory, 'prices.json')
            path.write_text(json.dumps({'products': [self.row]}))
            self.assertEqual(len(read_products(path)), 1)


if __name__ == '__main__':
    unittest.main()
