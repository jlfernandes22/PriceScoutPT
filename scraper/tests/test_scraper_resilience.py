"""Network-free regression coverage for observed retailer formats and partial runs."""
import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrapers.aldi import AldiScraper
from scrapers.auchan import AuchanScraper
from scrapers.continente import ContinenteScraper
from scrapers.lidl import LidlScraper
from scrapers.froiz import FroizScraper
from scrapers.pingodoce import PingoDoceScraper


def response(text='', data=None):
    return SimpleNamespace(text=text, json=lambda: data)


def tile(pid, price='1.29'):
    return f'<div class="product-tile" data-pid="{pid}" data-gtm=\'{json.dumps({"id": pid, "name": "Arroz", "price": price})}\'></div>'


def lidl_item(pid, price=2.95, loyalty=None):
    return {'type': 'product', 'gridbox': {'data': {
        'itemId': pid, 'title': 'Cajus torrados', 'brand': {'name': 'Alesto'},
        'canonicalUrl': '/p/cajus/p' + str(pid), 'store': True,
        'price': {'price': price, 'packaging': {'text': '250 g'}, 'basePrice': {'text': '1 kg = 11,80'}},
        'lidlPlus': loyalty or [],
    }, 'meta': {'ean': '20575922'}}}


class NormalizationTest(unittest.TestCase):
    def setUp(self):
        self.scraper = AuchanScraper(None)
        self.addCleanup(self.scraper.close)

    def test_portuguese_thousands_and_split_cents(self):
        for raw in ('1.234,56 €', '1\u00a0234,56 €', '1 234,56 €'):
            self.assertEqual(self.scraper._parse_price(raw), 1234.56)
        self.assertEqual(self.scraper._parse_price('1 ,20€'), 1.2)
        self.assertEqual(self.scraper._parse_price('2. 99'), 2.99)
        for raw in (float('nan'), float('inf'), -1, '-1,99', True):
            self.assertEqual(self.scraper._parse_price(raw), 0)

    def test_normalizes_published_unit_prices(self):
        for raw, expected in [('15,38€/kg', (15.38, 'kg')), ('1 kg = 11,80', (11.8, 'kg')),
                              ('0,99 €/100 g', (9.9, 'kg')), ('1 l = 3.73', (3.73, 'l')),
                              ('0,31€/un', (.31, 'un'))]:
            self.assertEqual(self.scraper._parse_unit_price(raw), expected)
        self.assertEqual(self.scraper._parse_unit_price('emb. 250 g'), (None, None))

    def test_validity_dates_use_local_end_of_day_and_accept_milliseconds(self):
        self.assertEqual(self.scraper._normalise_validity('2026-10-24', end_of_day=True), '2026-10-24T22:59:59.999999+00:00')
        self.assertEqual(self.scraper._normalise_validity(1793577599000), '2026-11-01T23:59:59+00:00')
        self.assertIsNone(self.scraper._normalise_validity('not-a-date'))

    def test_lazy_image_ignores_icons_and_resolves_url(self):
        card = BeautifulSoup('<div><img src="/wishlist.svg"><picture><img src=" " data-src="/arroz.jpg"></picture></div>', 'html.parser').div
        self.assertEqual(self.scraper._extract_image(card), 'https://www.auchan.pt/arroz.jpg')

    def test_unsafe_urls_ignored(self):
        card = BeautifulSoup('<div><a href="javascript:alert(1)">like</a><a href="produto/arroz">Arroz</a></div>', 'html.parser').div
        self.assertEqual(self.scraper._extract_url(card), 'https://www.auchan.pt/produto/arroz')
        self.assertIsNone(self.scraper._absolute_url('data:text/plain,x'))

    def test_duplicate_category_prefers_priced_observation_and_keeps_rich_fields(self):
        database = Mock()
        database.resolve_category_ids.return_value = {'Mercearia': 'category-1'}
        self.scraper.db_manager = database
        self.scraper.sync_to_db([
            {'external_id': '1', 'name': 'Arroz', 'price': 0, 'in_stock': False, 'description': 'Integral', 'category_name': 'Mercearia'},
            {'external_id': '1', 'name': 'Arroz', 'price': 1.99, 'in_stock': True, 'category_name': 'Mercearia'},
        ])
        products = database.bulk_upsert_products.call_args.args[1]
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]['price'], 1.99)
        self.assertTrue(products[0]['in_stock'])
        self.assertEqual(products[0]['description'], 'Integral')

    def test_duplicate_category_keeps_newest_price_and_provenance(self):
        database = Mock()
        database.resolve_category_ids.return_value = {}
        self.scraper.db_manager = database
        older = {'external_id': '1', 'name': 'Arroz', 'price': 1.99, 'brand': 'Auchan', 'observed_at': '2026-10-28T23:00:00Z', 'metadata': {'requires_loyalty_card': True, 'nutrition': {'energy': '350kcal'}}}
        newer = {'external_id': '1', 'name': 'Arroz', 'price': 2.49, 'observed_at': '2026-10-29T10:00:00+01:00', 'metadata': {'requires_loyalty_card': False}}
        for observations in ([older, newer], [newer, older]):
            self.scraper.sync_to_db(observations)
            product = database.bulk_upsert_products.call_args.args[1][0]
            self.assertEqual(product['price'], 2.49)
            self.assertEqual(product['observed_at'], newer['observed_at'])
            self.assertEqual(product['brand'], 'Auchan')
            self.assertFalse(product['metadata']['requires_loyalty_card'])
            self.assertEqual(product['metadata']['nutrition'], {'energy': '350kcal'})

    def test_403_is_not_retried(self):
        http_response = requests.Response()
        http_response.status_code = 403
        self.scraper.session.get = Mock(return_value=http_response)
        with patch('scraper_base.time.sleep') as sleep:
            with self.assertRaises(requests.HTTPError):
                self.scraper.get_with_retry('https://www.auchan.pt')
        self.assertEqual(self.scraper.session.get.call_count, 1)
        sleep.assert_not_called()

    def test_transient_response_honors_retry_after(self):
        fail = requests.Response()
        fail.status_code = 429
        fail.headers['Retry-After'] = '4'
        success = requests.Response()
        success.status_code = 200
        self.scraper.session.get = Mock(side_effect=[fail, success])
        with patch('scraper_base.time.sleep') as sleep:
            self.assertIs(self.scraper.get_with_retry('https://www.auchan.pt'), success)
            sleep.assert_called_once_with(4)


class SFCCPaginationTest(unittest.TestCase):
    def setUp(self):
        self.scraper = AuchanScraper(None)
        self.scraper.page_size = 100
        self.scraper.request_delay = 0
        self.category = {'name': 'Mercearia', 'cgid': 'mercearia'}
        self.addCleanup(self.scraper.close)

    def test_server_page_cap_does_not_skip_products(self):
        first = tile('1') + tile('2') + '<div data-total-count="3"></div>'
        second = tile('3') + '<div data-total-count="3"></div>'
        self.scraper.get_with_retry = Mock(side_effect=[response(first), response(second)])
        products = self.scraper.scrape_category(self.category)
        self.assertEqual([p['external_id'] for p in products], ['1', '2', '3'])
        self.assertEqual(self.scraper.get_with_retry.call_args_list[1].kwargs['params']['start'], 2)
        self.assertEqual(self.scraper.scrape_errors, [])

    def test_repeated_page_is_partial_failure(self):
        self.scraper.get_with_retry = Mock(side_effect=[response(tile('1')), response(tile('1'))])
        self.assertEqual(len(self.scraper.scrape_category(self.category)), 1)
        self.assertTrue(any('repeated' in e for e in self.scraper.scrape_errors))

    def test_200_challenge_is_partial_failure(self):
        self.scraper.get_with_retry = Mock(side_effect=[response(tile('1')), response('<h1>Access denied</h1>')])
        self.assertEqual(len(self.scraper.scrape_category(self.category)), 1)
        self.assertTrue(self.scraper.scrape_errors)

    def test_missing_cards_before_advertised_total_is_partial(self):
        self.scraper.get_with_retry = Mock(side_effect=[response(tile('1') + '<div data-total-count="3"></div>'), response('<div class="grid-footer" data-total-count="3"></div>')])
        self.scraper.scrape_category(self.category)
        self.assertTrue(self.scraper.scrape_errors)

    def test_partial_card_parse_is_reported(self):
        self.scraper.get_with_retry = Mock(return_value=response(tile('1') + '<div class="product-tile" data-pid="2"></div><div data-total-count="2"></div>'))
        self.assertEqual(len(self.scraper.scrape_category(self.category)), 1)
        self.assertTrue(any('1 of 2' in e for e in self.scraper.scrape_errors))

    def test_page_limit_is_partial_failure(self):
        self.scraper.max_pages = 1
        self.scraper.get_with_retry = Mock(return_value=response(tile('1')))
        self.scraper.scrape_category(self.category)
        self.assertTrue(any('page limit' in e for e in self.scraper.scrape_errors))

    def test_missing_cgid_is_reported(self):
        self.assertEqual(self.scraper.scrape_category({'name': 'Unknown'}), [])
        self.assertTrue(self.scraper.scrape_errors)


class RetailerFieldsTest(unittest.TestCase):
    def test_continente_hierarchy_reference_and_unit_price(self):
        scraper = ContinenteScraper(None)
        self.addCleanup(scraper.close)
        impression = json.dumps({'id': '1', 'name': 'Atum', 'price': '1,20', 'category': 'Supermercado/Mercearia/Atum'})
        source = f'<div class="product-tile" data-product-tile-impression=\'{impression}\'><p class="pwc-tile--quantity">120 g</p><div class="list"><span>PVPR</span> 1,72€</div><div class="pwc-tile--price-secondary">15,38€/kg</div></div>'
        product = scraper._extract_products(source, {'name': 'Mercearia'})[0]
        self.assertEqual(product['category_name'], 'Mercearia')
        self.assertEqual(product['regular_price'], 1.72)
        self.assertEqual(product['unit_price'], 15.38)
        self.assertEqual(product['source_type'], 'online_catalog')
        self.assertIn('observed_at', product)

    def test_current_price_precedes_reference_price_and_unit_price(self):
        scraper = AuchanScraper(None)
        self.addCleanup(scraper.close)
        source = '<div class="product-tile" data-pid="1"><h3>Arroz 1kg</h3><span class="auc-measures--price-per-unit">2.99 €/Kg</span><div class="price"><span class="list"><span class="value">4.99€</span></span><span class="sales"><span class="value" content="2.99">2,99€</span></span></div></div>'
        product = scraper._extract_products(source, {'name': 'Mercearia'})[0]
        self.assertEqual(product['price'], 2.99)
        self.assertEqual(product['regular_price'], 4.99)
        self.assertEqual(product['unit'], '1kg')
        self.assertEqual(product['unit_price'], 2.99)

    def test_pingo_gtm_on_tile_is_read_and_wrapper_deduplicated(self):
        scraper = PingoDoceScraper(None)
        self.addCleanup(scraper.close)
        gtm = json.dumps({'items': [{'item_id': '650222', 'item_name': 'Farinha', 'price': .59, 'item_brand': 'Pingo Doce'}]})
        source = f'<div class="product" data-pid="650222"><div class="product-tile-pd" data-pid="650222" data-gtm-info=\'{gtm}\'><div class="product-unit">1 Kg | 0,59 €/Kg</div></div></div>'
        products = scraper._extract_products(source, {'name': 'Mercearia'})
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]['name'], 'Farinha')
        self.assertEqual(products[0]['unit'], '1 Kg')
        self.assertEqual(products[0]['unit_price'], .59)

    def test_unpriced_pingo_and_continente_never_look_buyable(self):
        for cls, markup in [(PingoDoceScraper, '<div class="product-tile-pd" data-pid="1"><h3>Arroz</h3></div>'), (ContinenteScraper, '<div class="product-tile" data-pid="1"><h3>Arroz</h3></div>')]:
            scraper = cls(None)
            self.addCleanup(scraper.close)
            self.assertFalse(scraper._extract_products(markup, {'name': 'Mercearia'})[0]['in_stock'])


class LidlTest(unittest.TestCase):
    def setUp(self):
        self.scraper = LidlScraper(None)
        self.scraper.request_delay = 0
        self.addCleanup(self.scraper.close)

    def test_general_price_used_without_lidl_plus(self):
        product = self.scraper._extract_item(lidl_item(1), {'name': 'Mercearia'})
        self.assertEqual(product['price'], 2.95)
        self.assertEqual(product['barcode'], '20575922')
        self.assertEqual(product['brand'], 'Alesto')
        self.assertEqual(product['unit_price'], 11.8)
        self.assertFalse(product['metadata']['requires_loyalty_card'])

    def test_general_price_not_replaced_by_card_discount(self):
        item = lidl_item(1, price=2.95, loyalty=[{'price': {'price': 2.49}, 'lidlPlusText': 'Com Lidl Plus'}])
        product = self.scraper._extract_item(item, {'name': 'Mercearia'})
        self.assertEqual(product['price'], 2.95)
        self.assertFalse(product['metadata']['requires_loyalty_card'])
        self.assertEqual(product['metadata']['loyalty_offers'][0]['price'], 2.49)

    def test_card_only_price_retains_conditions_and_dates(self):
        item = lidl_item(1, price=None)
        data = item['gridbox']['data']
        data['regionsPrices'] = {'1': {'currentLidlPlusPrice': {'price': {'price': 1.49, 'oldPrice': 1.69, 'startDate': '2026-10-26', 'endDate': '2026-11-01'}}}}
        product = self.scraper._extract_item(item, {'name': 'Mercearia'})
        self.assertEqual(product['price'], 1.49)
        self.assertEqual(product['regular_price'], 1.69)
        self.assertTrue(product['metadata']['requires_loyalty_card'])
        self.assertEqual(product['metadata']['valid_to'], '2026-11-01T23:59:59.999999+00:00')

    def test_missing_total_does_not_stop_after_first_page(self):
        self.scraper.get_with_retry = Mock(side_effect=[response(data={'items': [lidl_item(1)]}), response(data={'items': [lidl_item(2)]}), response(data={'items': []})])
        products = self.scraper.scrape_category({'name': 'Mercearia', 'api_id': '1'})
        self.assertEqual(len(products), 2)
        self.assertEqual(self.scraper.get_with_retry.call_args_list[1].kwargs['params']['offset'], 1)
        self.assertEqual(self.scraper.scrape_errors, [])

    def test_malformed_api_response_is_reported(self):
        self.scraper.get_with_retry = Mock(return_value=response(data={'error': 'blocked'}))
        self.assertEqual(self.scraper.scrape_category({'name': 'Mercearia', 'api_id': '1'}), [])
        self.assertTrue(self.scraper.scrape_errors)


class AldiTest(unittest.TestCase):
    def setUp(self):
        self.scraper = AldiScraper(None)
        self.addCleanup(self.scraper.close)

    def test_multiline_settings_json_with_braces_in_string(self):
        text = 'window.staticSettings = {\n"name": "{weekly}", "pageTexts": ["arroz"]\n};'
        self.assertEqual(self.scraper._extract_settings(text)['pageTexts'], ['arroz'])

    def test_unit_price_does_not_consume_name_or_become_sale_price(self):
        text = 'GOLDEN SEAFOOD ® Tentáculos de Pota 800 g embalagem (kg = 4.99) -28% 3. 99 5.59 Promoções válidas de 26/10/26 a 1/11/26.'
        product = self.scraper._extract_page_texts([text], {'name': 'Oportunidades'}, 'https://folhetos.aldi.pt/weekly')[0]
        self.assertEqual(product['name'], 'Tentáculos de Pota')
        self.assertEqual(product['brand'], 'GOLDEN SEAFOOD')
        self.assertEqual(product['unit'], '800 g')
        self.assertEqual(product['price'], 3.99)
        self.assertEqual(product['regular_price'], 5.59)
        self.assertEqual(product['unit_price'], 4.99)
        self.assertEqual(product['metadata']['valid_to'], '2026-11-01T23:59:59.999999+00:00')
        self.assertEqual(product['metadata']['extraction_confidence'], 'low')
        self.assertFalse(self.scraper.allow_mark_missing)

    def test_unit_price_is_not_borrowed_from_previous_product(self):
        text = 'GOLDEN SEAFOOD ® Filetes de Peixe 400 g embalagem (kg = 7.48) -21% 2. 99 3.79 REYMAR Posta de Bacalhau 1 kg embalagem -10% 17. 99 19.99'
        products = self.scraper._extract_page_texts([text], {'name': 'Oportunidades'}, 'https://folhetos.aldi.pt/weekly')
        self.assertEqual(len(products), 2)
        self.assertEqual(products[0]['unit_price'], 7.48)
        self.assertIsNone(products[1]['unit_price'])

    def test_trailing_unit_price_of_previous_item_is_not_borrowed(self):
        text = 'Maçã Jonagold Red Saco 1.5 KG APROVEITA 1. 99 (kg = 1.33) C ° Brócolos kg -20% 2. 39 2.99'
        products = self.scraper._extract_page_texts([text], {'name': 'Oportunidades'}, 'https://folhetos.aldi.pt/weekly')
        broccoli = next(p for p in products if p['name'] == 'Brócolos')
        self.assertIsNone(broccoli['unit_price'])

    def test_broken_price_layout_is_not_assigned_to_another_product(self):
        text = 'Maminha de Bovino APROVEITA 16 9 . 9 kg Peito de Frango APROVEITA 5. 89 kg'
        self.assertEqual(self.scraper._extract_page_texts([text], {'name': 'Oportunidades'}, 'https://folhetos.aldi.pt/weekly'), [])

    def test_missing_leaflet_link_reports_failure_without_unbound_response(self):
        self.scraper.get_with_retry = Mock(side_effect=[requests.ConnectionError('offline'), response('<div>no leaflet</div>')])
        self.assertEqual(self.scraper.scrape_category({'name': 'Oportunidades', 'path': '/folheto/esta-semana.html'}), [])
        self.assertTrue(any('current leaflet link' in e for e in self.scraper.scrape_errors))


class FroizTest(unittest.TestCase):
    def setUp(self):
        self.scraper = FroizScraper(None)
        self.scraper.request_delay = 0
        self.addCleanup(self.scraper.close)
        self.row = {
            'id': 10013, 'name': 'Vinho Porto Ferreira Tawny 75 cl', 'slug': '10013-vinho-porto-ferreira-tawny-75-cl',
            'brand_name': 'Ferreira', 'base_price': '7.39', 'order_price': 5.99,
            'category_name': 'Bebidas', 'category_slug': 'bebidas', 'section_name': 'Vinhos',
            'measurement_unit': 'Litro', 'measurement_unit_ratio': '0.750', 'enabled': True,
            'offer': {'price': 5.99, 'date_from': '2026-10-15', 'date_to': '2026-11-03'},
            'properties': {'is_bio': False}, 'image': '/public-account/image-id/desktop?exp=123&sig=temporary',
        }

    def test_public_product_preserves_offer_package_and_scope(self):
        product = self.scraper._extract_product(self.row, {'name': 'Bebidas'})
        self.assertEqual(product['price'], 5.99)
        self.assertEqual(product['regular_price'], 7.39)
        self.assertEqual(product['unit'], '75 cl')
        self.assertEqual(product['unit_price'], 7.986667)
        self.assertEqual(product['unit_price_unit'], 'l')
        self.assertEqual(product['metadata']['valid_to'], '2026-11-03T23:59:59.999999+00:00')
        self.assertFalse(product['metadata']['store_stock_confirmed'])
        self.assertEqual(product['metadata']['availability_scope'], 'public_default_catalogue')
        self.assertTrue(product['image_url'].endswith('/public-account/image-id/desktop'))
        self.assertEqual(product['url'], 'https://loja.froiz.com/product/10013-vinho-porto-ferreira-tawny-75-cl')

    def test_category_discovery_uses_public_live_list(self):
        self.scraper.get_with_retry = Mock(return_value=response(data=[{'id': 5, 'name': 'Mercearia', 'slug': 'mercearia'}]))
        self.assertEqual(self.scraper.discover_categories(), [{'name': 'Mercearia', 'slug': 'mercearia', 'source_id': 5}])
        self.assertFalse(self.scraper.allow_mark_missing)

    def test_pagination_respects_source_stats_and_filter(self):
        second = {**self.row, 'id': 10048}
        self.scraper.get_with_retry = Mock(side_effect=[response(data={'products': [self.row], 'stats': {'pageNumber': 1, 'totalPages': 2, 'productTotal': 2}}), response(data={'products': [second], 'stats': {'pageNumber': 2, 'totalPages': 2, 'productTotal': 2}})])
        products = self.scraper.scrape_category({'name': 'Bebidas', 'slug': 'bebidas'})
        self.assertEqual(len(products), 2)
        self.assertEqual(self.scraper.get_with_retry.call_args_list[1].kwargs['params']['page'], 2)
        self.assertEqual(self.scraper.get_with_retry.call_args_list[1].kwargs['params']['category'], 'bebidas')
        self.assertEqual(self.scraper.scrape_errors, [])

    def test_incomplete_last_page_is_reported(self):
        self.scraper.get_with_retry = Mock(return_value=response(data={'products': [self.row], 'stats': {'pageNumber': 1, 'totalPages': 1, 'productTotal': 2}}))
        self.assertEqual(len(self.scraper.scrape_category({'name': 'Bebidas', 'slug': 'bebidas'})), 1)
        self.assertTrue(self.scraper.scrape_errors)

    def test_ignored_category_filter_does_not_pollute_results(self):
        self.scraper.get_with_retry = Mock(return_value=response(data={'products': [self.row], 'stats': {'pageNumber': 1, 'totalPages': 1, 'productTotal': 1}}))
        self.assertEqual(self.scraper.scrape_category({'name': 'Mercearia', 'slug': 'mercearia'}), [])
        self.assertTrue(self.scraper.scrape_errors)


class ProductDetailsTest(unittest.TestCase):
    def setUp(self):
        self.scraper = AuchanScraper(None)
        self.scraper.request_delay = 0
        self.addCleanup(self.scraper.close)
        self.product = {
            'external_id': '123', 'name': 'Arroz integral 1kg', 'price': 1.99,
            'unit': '1 kg', 'unit_price': 1.99, 'unit_price_unit': 'kg',
            'in_stock': True, 'url': 'https://www.auchan.pt/pt/arroz/123.html',
            'source_type': 'online_catalog', 'metadata': {'coverage': 'public_catalogue_subset'},
        }
        self.detail = {
            '@context': 'https://schema.org', '@type': 'Product', 'sku': '123',
            'name': 'Arroz integral 1kg', 'brand': {'name': 'Auchan'},
            'gtin13': '5601234567890', 'description': '<p>Arroz <b>integral</b>.</p>',
            'image': [{'@type': 'ImageObject', 'contentUrl': '/images/arroz.jpg'}],
            'ingredients': 'Arroz integral.', 'nutrition': {'@type': 'NutritionInformation', 'energyContent': '350 kcal'},
            'additionalProperty': [{'@type': 'PropertyValue', 'name': 'Alergénios', 'value': 'Pode conter soja'}],
            'offers': {'@type': 'Offer', 'price': '0.49', 'availability': 'https://schema.org/OutOfStock'},
        }

    def markup(self, detail=None):
        return '<script type="application/ld+json">' + json.dumps(detail or self.detail) + '</script>'

    def test_explicit_limit_zero_performs_no_reads(self):
        self.scraper.get_with_retry = Mock()
        products = [dict(self.product)]
        self.assertIs(self.scraper.enrich_product_details(products), products)
        self.scraper.get_with_retry.assert_not_called()

    def test_descriptions_enriched_without_changing_price_unit_or_stock(self):
        self.scraper.get_with_retry = Mock(return_value=response(self.markup()))
        product = dict(self.product)
        self.scraper.enrich_product_details([product], limit=1)
        self.assertEqual(product['brand'], 'Auchan')
        self.assertEqual(product['barcode'], '5601234567890')
        self.assertEqual(product['description'], 'Arroz integral.')
        self.assertEqual(product['image_url'], 'https://www.auchan.pt/images/arroz.jpg')
        self.assertEqual(product['metadata']['ingredients'], 'Arroz integral.')
        self.assertEqual(product['metadata']['nutrition']['energyContent'], '350 kcal')
        self.assertEqual(product['metadata']['allergens'], 'Pode conter soja')
        for key in ('price', 'unit', 'unit_price', 'unit_price_unit', 'in_stock'):
            self.assertEqual(product[key], self.product[key])
        self.assertFalse(self.scraper.get_with_retry.call_args.kwargs['allow_redirects'])

    def test_graph_references_and_matching_identity_exclude_recommendations(self):
        primary = {**self.detail, 'brand': {'@id': '#brand'}}
        unrelated = {'@type': 'Product', 'sku': '999', 'name': 'Massa de arroz', 'description': 'Wrong product'}
        source = {'@graph': [unrelated, primary, {'@id': '#brand', '@type': 'Organization', 'name': 'Auchan'}]}
        details = self.scraper._extract_product_details(self.markup(source), self.product, self.product['url'])
        self.assertEqual(details['brand'], 'Auchan')
        self.assertNotEqual(details['description'], 'Wrong product')

    def test_unrelated_product_is_not_merged(self):
        unrelated = {'@type': 'Product', 'sku': '999', 'name': 'Detergente', 'description': 'Wrong product'}
        self.assertEqual(self.scraper._extract_product_details(self.markup(unrelated), self.product, self.product['url']), {})

    def test_shared_product_url_does_not_assign_an_ambiguous_variant_barcode(self):
        variants = [
            {'@type': 'Product', 'name': self.product['name'], 'url': self.product['url'],
             'gtin13': barcode, 'description': description}
            for barcode, description in [('5600000000001', 'Variante A'), ('5600000000002', 'Variante B')]
        ]
        self.assertEqual(self.scraper._extract_product_details(self.markup(variants), self.product, self.product['url']), {})

    def test_duplicates_share_one_read_and_limit_caps_unique_urls(self):
        self.scraper.get_with_retry = Mock(return_value=response(self.markup()))
        duplicate = dict(self.product)
        another = {**self.product, 'url': 'https://www.auchan.pt/pt/arroz/456.html'}
        products = [dict(self.product), duplicate, another]
        self.scraper.enrich_product_details(products, limit=1)
        self.assertEqual(self.scraper.get_with_retry.call_count, 1)
        self.assertEqual(duplicate['brand'], 'Auchan')
        self.assertNotIn('brand', another)

    def test_cross_retailer_credentials_and_leaflets_are_not_fetched(self):
        self.scraper.get_with_retry = Mock()
        for url in ('https://external.example/product', 'https://auchan.pt.external.example/product', 'http://127.0.0.1/', 'https://user:password@www.auchan.pt/product'):
            self.scraper.enrich_product_details([{**self.product, 'url': url}], limit=1)
        self.scraper.enrich_product_details([{**self.product, 'source_type': 'leaflet'}], limit=1)
        self.scraper.get_with_retry.assert_not_called()

    def test_cross_host_redirect_is_not_followed(self):
        redirect = SimpleNamespace(text='', status_code=302, headers={'Location': 'https://external.example/product'})
        self.scraper.get_with_retry = Mock(return_value=redirect)
        product = dict(self.product)
        self.scraper.enrich_product_details([product], limit=1)
        self.assertEqual(self.scraper.get_with_retry.call_count, 1)
        self.assertTrue(self.scraper.detail_errors)
        self.assertEqual(self.scraper.scrape_errors, [])
        self.assertEqual(product['price'], 1.99)

    def test_failure_is_separate_from_listing_completeness_and_cached(self):
        self.scraper.get_with_retry = Mock(side_effect=requests.ConnectionError('offline'))
        self.scraper.enrich_product_details([dict(self.product), dict(self.product)], limit=2)
        self.assertEqual(self.scraper.get_with_retry.call_count, 1)
        self.assertEqual(len(self.scraper.detail_errors), 1)
        self.assertEqual(self.scraper.scrape_errors, [])

    def test_existing_descriptive_fields_are_retained(self):
        product = {**self.product, 'brand': 'Verified Brand', 'barcode': '5600000000000', 'description': 'Verified description'}
        self.scraper.get_with_retry = Mock(return_value=response(self.markup()))
        self.scraper.enrich_product_details([product], limit=1)
        self.assertEqual(product['brand'], 'Verified Brand')
        self.assertEqual(product['barcode'], '5600000000000')
        self.assertEqual(product['description'], 'Verified description')


if __name__ == '__main__':
    unittest.main()
