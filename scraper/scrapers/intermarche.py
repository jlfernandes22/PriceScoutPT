"""Optional public-browser collector for explicitly configured campaign pages.

The /shop/ identifiers identify public listings, not verified physical stores.
No sign-in, browser profile, challenge solver or private mobile API is used.
"""
import hashlib
import os
import re
import time
from datetime import datetime
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup
from scraper_base import ScraperBase


class IntermarcheScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000007'
    base_url = 'https://intermarche.pt'
    source_type = 'public_listing'
    allow_mark_missing = False
    card_selector = '[id^="productEan_"]'
    max_pages = 40
    request_delay = 1

    def discover_categories(self):
        identifiers = [value.strip() for value in os.environ.get('INTERMARCHE_LISTING_IDS', '').split(',') if value.strip()]
        if not identifiers or any(not re.fullmatch(r'\d{1,10}', value) for value in identifiers):
            raise ValueError('Set INTERMARCHE_LISTING_IDS to explicitly selected public /shop/ campaign IDs (comma-separated). These are not store IDs.')
        raw_limit = os.environ.get('INTERMARCHE_MAX_PAGES', '40')
        if not raw_limit.isdigit() or not 1 <= int(raw_limit) <= 400:
            raise ValueError('INTERMARCHE_MAX_PAGES must be an integer from 1 to 400.')
        self.max_pages = int(raw_limit)
        return [{'name': 'Promoções', 'listing_id': value, 'url': f'{self.base_url}/shop/{value}'}
                for value in dict.fromkeys(identifiers)]

    def scrape_category(self, category):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError('Intermarché browser collection is optional: install scraper/requirements-browser.txt, then run python -m playwright install chromium.') from exc
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=os.environ.get('INTERMARCHE_HEADLESS', '1') != '0')
            try:
                context = browser.new_context(locale='pt-PT')
                page = context.new_page()
                return self._collect_pages(page, category)
            finally:
                browser.close()

    def _collect_pages(self, page, category):
        products, seen_ids, seen_urls = [], set(), set()
        current_url = category['url']
        expected_total = None
        for page_number in range(1, self.max_pages + 1):
            if current_url in seen_urls:
                self._record_error(category, f'repeated pagination URL on page {page_number}')
                break
            seen_urls.add(current_url)
            try:
                response = page.goto(current_url, wait_until='domcontentloaded', timeout=45000)
                if response is not None and response.status >= 400:
                    raise ValueError(f'public browser navigation returned HTTP {response.status}; access restrictions are not bypassed')
                # The public page supplies cards under an ordinary consent
                # overlay too. Reading them needs no cookie/profile changes.
                page.locator(self.card_selector).first.wait_for(state='attached', timeout=20000)
                soup = BeautifulSoup(page.content(), 'html.parser')
                cards = soup.select(self.card_selector)
                extracted = self._extract_products(soup, category)
                total_match = re.search(r'\b(\d(?:[\d .]*\d)?)\s+produtos\b', soup.get_text(' ', strip=True), re.I)
                if total_match:
                    expected_total = int(re.sub(r'\D', '', total_match[1]))
            except Exception as exc:
                self._record_error(category, f'page {page_number}: {exc}')
                break
            if len(extracted) != len(cards):
                self._record_error(category, f'page {page_number}: {len(cards) - len(extracted)} cards lacked a valid identifier, name or price')
            new_products = [product for product in extracted if product['external_id'] not in seen_ids]
            if not new_products:
                self._record_error(category, f'page {page_number}: empty or repeated product listing')
                break
            products.extend(new_products)
            seen_ids.update(product['external_id'] for product in new_products)
            try:
                next_url = self._next_page(soup, category, current_url)
            except ValueError as exc:
                self._record_error(category, str(exc))
                break
            if not next_url:
                if expected_total is not None and len(seen_ids) < expected_total:
                    self._record_error(category, f'listing ended after {len(seen_ids)} of {expected_total} advertised products')
                break
            if page_number == self.max_pages:
                self._record_error(category, f'page limit {self.max_pages} reached; campaign collection is partial')
                break
            current_url = next_url
            time.sleep(self.request_delay)
        return products

    def _next_page(self, soup, category, current_url):
        link = soup.select_one('a[rel~="next"][href]')
        if link is None:
            return None
        next_url = urljoin(current_url, link['href'])
        parsed = urlsplit(next_url)
        previous = urlsplit(current_url)
        if parsed.scheme != 'https' or parsed.netloc != 'intermarche.pt' or parsed.path.rstrip('/') != f"/shop/{category['listing_id']}":
            raise ValueError('Pagination left the configured public campaign listing; stopping.')
        try:
            current_page = int(parse_qs(previous.query).get('page', ['1'])[0])
            next_page = int(parse_qs(parsed.query)['page'][0])
        except (KeyError, ValueError, IndexError) as exc:
            raise ValueError('Unrecognised campaign pagination URL; stopping.') from exc
        if next_page != current_page + 1:
            raise ValueError('Non-sequential campaign pagination URL; stopping.')
        return next_url

    def _extract_products(self, html_or_soup, category):
        soup = BeautifulSoup(html_or_soup, 'html.parser') if isinstance(html_or_soup, str) else html_or_soup
        products = []
        for card in soup.select(self.card_selector):
            barcode = card.get('id', '').removeprefix('productEan_')
            name = self._text(card.select_one('.product__name'))
            brand = (self._text(card.select_one('.product__brand')) or '').rstrip(' -') or None
            price = self._parse_price(card.get('data-price'))
            if not price:
                price_node = card.select_one('.product__productPrice')
                price = self._parse_price(price_node.get_text('', strip=True) if price_node else None)
            if not re.fullmatch(r'\d{8,14}', barcode) or not name or price <= 0:
                continue
            price_nodes = card.select('.product__prices > span')
            unit_price_text = next((node.get_text('', strip=True) for node in price_nodes if '/' in node.get_text()), None)
            offer_tips = ' '.join(node.get_text(' ', strip=True) for node in card.select('.highlightTag__tip'))
            labels = [str(node.find(string=True, recursive=False) or '').strip() for node in card.select('.highlightTag')]
            flags = self._text(card.select_one('.product__flags')) or ''
            offer_text = ' '.join(labels + [offer_tips, flags])
            valid_to = None
            end_date = re.search(r'at[eé]\s+(\d{2}/\d{2}/\d{4})', offer_tips, re.I)
            if end_date:
                try:
                    valid_to = datetime.strptime(end_date[1], '%d/%m/%Y').date().isoformat()
                except ValueError:
                    pass
            requires_loyalty = bool(re.search(r'\bcom\s+(?:o\s+)?cart[aã]o\b', offer_text, re.I))
            cashback = bool(re.search(r'acumular\s+no\s+cart[aã]o', offer_text, re.I))
            location = os.environ.get('INTERMARCHE_STORE_LOCATION', '').strip() or None
            package = re.search(r'\b(?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|litros?|l|unidades?|un\.?)(?!\w)', name, re.I)
            # Different explicitly labeled observation contexts must not
            # overwrite each other under the retailer/external_id key.
            context = hashlib.sha256((location or 'unverified-public-listing').casefold().encode()).hexdigest()[:12]
            product = self._enrich_product({
                'external_id': f'public:{context}:{barcode}', 'barcode': barcode,
                'name': name, 'brand': brand, 'description': None,
                'category_name': category.get('name', 'Promoções'),
                'price': price, 'price_currency': 'EUR', 'unit': package[0] if package else None,
                'url': self._extract_url(card), 'image_url': self._extract_image(card),
                'store_location': location, 'in_stock': True, 'deleted': False,
            }, card=card, unit_price_text=unit_price_text, metadata={
                'coverage': 'partial_campaign',
                'availability_scope': 'public_listing_unverified_store',
                'store_stock_confirmed': False,
                'source_listing_id': category.get('listing_id'),
                'source_listing_url': category.get('url'),
                'offer_labels': labels, 'offer_details': offer_tips or None,
                'valid_to': valid_to, 'requires_loyalty_card': requires_loyalty,
                'has_loyalty_cashback': cashback,
            })
            products.append(product)
        return products
