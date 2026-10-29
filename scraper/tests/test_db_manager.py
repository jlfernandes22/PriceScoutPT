"""Opt-in database tests: use an isolated schema initialized from init.sql."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from db_manager import DBManager


@unittest.skipUnless(os.environ.get('SCRAPER_TEST_DATABASE_URL'), 'set SCRAPER_TEST_DATABASE_URL to an isolated database')
class ProductPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.manager = DBManager(os.environ['SCRAPER_TEST_DATABASE_URL'])
        self.store = str(uuid4())
        with self.manager.conn.cursor() as cursor:
            cursor.execute('INSERT INTO supermarkets(id,name,slug) VALUES(%s,%s,%s)',
                           (self.store, self.store, self.store))
        self.manager.conn.commit()
        self.now = datetime.now(timezone.utc)

    def tearDown(self):
        with self.manager.conn.cursor() as cursor:
            cursor.execute('DELETE FROM supermarkets WHERE id=%s', (self.store,))
        self.manager.conn.commit()
        self.manager.close()

    def write(self, **fields):
        self.manager.bulk_upsert_products(self.store, [dict(external_id='test', name='Leite', price=1.2,
                                                          observed_at=self.now, **fields)])

    def row(self):
        from psycopg2.extras import RealDictCursor
        with self.manager.conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute('SELECT * FROM products WHERE supermarket_id=%s', (self.store,))
            return cursor.fetchone()

    def history_count(self):
        with self.manager.conn.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM price_history WHERE product_id=%s', (self.row()['id'],))
            return cursor.fetchone()[0]

    def test_unchanged_price_refreshes_metadata_and_freshness_without_duplicate_history(self):
        self.write(brand='Marca', barcode='5601234567890', unit='1 l', image_url='https://example.pt/a.png')
        first = self.row()
        self.now += timedelta(seconds=1)
        self.write(brand=None, unit_price=1.2, unit_price_unit='l', metadata={'ingredients': 'Leite'})
        second = self.row()
        self.assertGreater(second['observed_at'], first['observed_at'])
        self.assertGreater(second['last_scraped_at'], first['last_scraped_at'])
        self.assertEqual(second['barcode'], first['barcode'])
        self.assertEqual(second['image_url'], first['image_url'])
        self.assertEqual(second['metadata']['ingredients'], 'Leite')
        self.assertEqual(self.history_count(), 1)

    def test_old_export_does_not_replace_new_price(self):
        self.write()
        self.now -= timedelta(days=1)
        self.manager.bulk_upsert_products(self.store, [dict(external_id='test', name='Old name', price=.5, observed_at=self.now)])
        self.assertEqual(float(self.row()['price']), 1.2)
        self.assertEqual(self.row()['name'], 'Leite')
        self.assertEqual(self.history_count(), 1)

    def test_richer_price_details_and_conditional_dates_are_saved(self):
        self.write(source_type='receipt', store_location='Porto', regular_price=1.5,
                   metadata={'requires_loyalty_card': True, 'valid_to': '2026-12-31T23:59:59Z'})
        row = self.row()
        self.assertTrue(row['requires_loyalty_card'])
        self.assertEqual(row['store_location'], 'Porto')
        self.assertEqual(float(row['regular_price']), 1.5)
        self.assertEqual(row['valid_to'].year, 2026)

    def test_catalogue_retirement_does_not_delete_imported_observations(self):
        self.write(source_type='receipt')
        self.manager.mark_missing_products(self.store, ['different-product'])
        self.assertFalse(self.row()['deleted'])

    def test_duplicate_receipts_keep_newest_regardless_of_input_order(self):
        older = dict(external_id='test', name='Older', price=.5, observed_at=self.now - timedelta(days=1))
        newer = dict(external_id='test', name='Newer', price=1.5, observed_at=self.now)
        self.assertEqual(self.manager.bulk_upsert_products(self.store, [older, newer]), 1)
        self.assertEqual(self.row()['name'], 'Newer')
        self.assertEqual(float(self.row()['price']), 1.5)
        self.assertEqual(self.manager.bulk_upsert_products(self.store, [older]), 0)

    def test_history_records_observation_time_and_never_invents_a_zero_price(self):
        self.now -= timedelta(days=3)
        self.write()
        with self.manager.conn.cursor() as cursor:
            cursor.execute('SELECT recorded_at FROM price_history WHERE product_id=%s', (self.row()['id'],))
            self.assertEqual(cursor.fetchone()[0], self.now)
        self.now += timedelta(days=1)
        self.manager.bulk_upsert_products(self.store, [dict(external_id='test', name='Leite', price=0,
                                                         in_stock=False, observed_at=self.now)])
        self.assertEqual(self.history_count(), 1)


if __name__ == '__main__':
    unittest.main()
