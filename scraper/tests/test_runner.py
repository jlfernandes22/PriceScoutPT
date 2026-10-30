import contextlib
import io
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import run_scraper


class FakeScraper:
    allow_mark_missing = False
    def __init__(self, products=None, categories=None, partial=False):
        self.products = products if products is not None else [{'external_id': '1', 'name': 'Leite', 'price': 1}]
        self.categories = categories if categories is not None else [{'name': 'Mercearia'}]
        self.partial = partial
        self.scrape_errors = []
        self.marked = False
        self.saved = []
    def discover_categories(self):
        return self.categories
    def scrape_category(self, category):
        if self.partial:
            self.scrape_errors.append('page 2 returned a repeated page')
        return self.products
    def sync_to_db(self, products):
        self.saved = products
        return len(products)
    def mark_missing(self, ids):
        self.marked = True


class RunnerTests(unittest.TestCase):
    def run_silently(self, scraper, errors):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return run_scraper(scraper, errors)

    def test_empty_discovery_and_empty_collection_are_failures(self):
        for scraper in (FakeScraper(categories=[]), FakeScraper(products=[])):
            errors = []
            self.assertEqual(self.run_silently(scraper, errors), 0)
            self.assertTrue(errors)
            self.assertFalse(scraper.marked)

    def test_discovery_failure_prints_recorded_source_error(self):
        class FailedDiscovery(FakeScraper):
            def discover_categories(self):
                self.scrape_errors.append('category discovery: HTTP 403 from the public source')
                return []

        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(run_scraper(FailedDiscovery(), []), 0)
        self.assertIn('category discovery: HTTP 403 from the public source', output.getvalue())

    def test_partial_collection_preserves_prices_and_surfaces_parser_errors(self):
        scraper = FakeScraper(partial=True)
        scraper.allow_mark_missing = True
        errors = []
        self.assertEqual(self.run_silently(scraper, errors), 1)
        self.assertEqual(len(scraper.saved), 1)
        self.assertTrue(any('repeated page' in error for error in errors))
        self.assertFalse(scraper.marked)

    def test_public_subsets_never_retire_absent_products(self):
        scraper = FakeScraper()
        self.assertEqual(self.run_silently(scraper, []), 1)
        self.assertFalse(scraper.marked)

    def test_retirement_requires_explicit_complete_catalogue_opt_in(self):
        scraper = FakeScraper()
        scraper.allow_mark_missing = True
        errors = []
        self.run_silently(scraper, errors)
        self.assertEqual(errors, [])
        self.assertTrue(scraper.marked)


if __name__ == '__main__':
    unittest.main()
