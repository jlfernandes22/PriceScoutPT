import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scrapers.intermarche import IntermarcheScraper


FIXTURE = (Path(__file__).parent / 'fixtures/intermarche-listing.html').read_text()
CATEGORY = {'name': 'Promoções', 'listing_id': '2119', 'url': 'https://intermarche.pt/shop/2119'}


class FakePage:
    def __init__(self, pages, status=200):
        self.pages = iter(pages)
        self.status = status
        self.urls = []
        self.first = self

    def goto(self, url, **kwargs):
        self.urls.append(url)
        self.html = next(self.pages)
        return self

    def locator(self, selector):
        return self

    def wait_for(self, **kwargs):
        pass

    def content(self):
        return self.html


class IntermarcheTest(unittest.TestCase):
    def setUp(self):
        self.scraper = IntermarcheScraper(None)
        self.scraper.request_delay = 0

    def test_explicit_campaign_configuration_is_required_and_not_assumed_to_be_store_ids(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'not store IDs'):
                self.scraper.discover_categories()
        with patch.dict(os.environ, {'INTERMARCHE_LISTING_IDS': '2119,2871,2119'}, clear=True):
            categories = self.scraper.discover_categories()
            self.assertEqual([c['listing_id'] for c in categories], ['2119', '2871'])
        with patch.dict(os.environ, {'INTERMARCHE_LISTING_IDS': '../admin'}, clear=True):
            with self.assertRaises(ValueError):
                self.scraper.discover_categories()

    def test_live_dom_fixture_preserves_barcode_price_brand_unit_and_validity(self):
        with patch.dict(os.environ, {}, clear=True):
            products = self.scraper._extract_products(FIXTURE, CATEGORY)
        self.assertEqual(len(products), 2)
        flour, butter = products
        self.assertEqual(flour['barcode'], '5601043111019')
        self.assertEqual(flour['brand'], 'Branca de neve')
        self.assertEqual(flour['price'], .89)
        self.assertEqual(flour['unit'], '1 kg')
        self.assertEqual(butter['unit_price'], 7.96)
        self.assertEqual(butter['unit_price_unit'], 'kg')
        self.assertEqual(flour['metadata']['valid_to'], '2026-11-05T23:59:59.999999+00:00')
        self.assertFalse(flour['metadata']['requires_loyalty_card'])
        self.assertEqual(flour['metadata']['availability_scope'], 'public_listing_unverified_store')
        self.assertIsNone(flour['store_location'])
        self.assertTrue(flour['image_url'].startswith('https://driveimg1.intermarche.com/'))

    def test_cashback_is_kept_separate_from_a_card_only_selling_price(self):
        cashback = FIXTURE.replace('Artigo de Folheto', '35% A acumular no cartão')
        only_card = FIXTURE.replace('Artigo de Folheto', 'Preço com cartão')
        product = self.scraper._extract_products(cashback, CATEGORY)[0]
        self.assertFalse(product['metadata']['requires_loyalty_card'])
        self.assertTrue(product['metadata']['has_loyalty_cashback'])
        self.assertEqual(product['price'], .89)
        self.assertTrue(self.scraper._extract_products(only_card, CATEGORY)[0]['metadata']['requires_loyalty_card'])

    def test_location_labels_do_not_invent_verified_store_context_or_overwrite_other_observations(self):
        with patch.dict(os.environ, {'INTERMARCHE_STORE_LOCATION': 'Public campaign observed for comparison'}, clear=True):
            labeled = self.scraper._extract_products(FIXTURE, CATEGORY)[0]
        with patch.dict(os.environ, {}, clear=True):
            unlabeled = self.scraper._extract_products(FIXTURE, CATEGORY)[0]
        self.assertNotEqual(labeled['external_id'], unlabeled['external_id'])
        self.assertFalse(labeled['metadata']['store_stock_confirmed'])
        self.assertEqual(labeled['metadata']['availability_scope'], 'public_listing_unverified_store')

    def test_normal_listing_completes_without_marking_any_missing_products(self):
        page = FakePage([FIXTURE])
        self.assertEqual(len(self.scraper._collect_pages(page, CATEGORY)), 2)
        self.assertEqual(self.scraper.scrape_errors, [])
        self.assertFalse(self.scraper.allow_mark_missing)

    def test_pagination_repeats_and_limits_report_partial_collection(self):
        next_link = '<a rel="next" href="/shop/2119?page=2&amp;trier=pertinence">Ver mais produtos</a>'
        page = FakePage([FIXTURE + next_link, FIXTURE])
        self.assertEqual(len(self.scraper._collect_pages(page, CATEGORY)), 2)
        self.assertTrue(any('repeated product' in error for error in self.scraper.scrape_errors))
        self.scraper.scrape_errors = []
        self.scraper.max_pages = 1
        self.scraper._collect_pages(FakePage([FIXTURE + next_link]), CATEGORY)
        self.assertTrue(any('page limit' in error for error in self.scraper.scrape_errors))

    def test_http_restrictions_and_cross_origin_pagination_are_not_bypassed(self):
        self.assertEqual(self.scraper._collect_pages(FakePage([FIXTURE], status=403), CATEGORY), [])
        self.assertTrue(any('HTTP 403' in error for error in self.scraper.scrape_errors))
        self.scraper.scrape_errors = []
        self.scraper._collect_pages(FakePage([FIXTURE + '<a rel="next" href="https://unrelated.example/page=2">Next</a>']), CATEGORY)
        self.assertTrue(any('left the configured' in error for error in self.scraper.scrape_errors))

    def test_unrecognised_or_truncated_cards_report_incomplete_coverage(self):
        truncated = FIXTURE.replace('2 produtos', '300 produtos')
        self.scraper._collect_pages(FakePage([truncated]), CATEGORY)
        self.assertTrue(any('2 of 300' in error for error in self.scraper.scrape_errors))
        self.scraper.scrape_errors = []
        broken = FIXTURE.replace('data-price="0.89"', 'data-price="0"').replace('0<!-- -->,<!-- -->89 €', 'Preço indisponível')
        self.assertEqual(len(self.scraper._collect_pages(FakePage([broken]), CATEGORY)), 1)
        self.assertTrue(any('cards lacked' in error for error in self.scraper.scrape_errors))


if __name__ == '__main__':
    unittest.main()
