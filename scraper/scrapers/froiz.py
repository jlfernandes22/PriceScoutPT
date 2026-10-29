"""Froiz Portugal public catalogue, using the API linked by loja.froiz.com.

Prices are the public default catalogue; delivery coverage and store stock need
an explicit location in the retailer's service and are not inferred here.
"""
import re
from urllib.parse import quote

from scraper_base import ScraperBase


class FroizScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000009'
    base_url = 'https://loja.froiz.com'
    api_base_url = 'https://serviciospt.froiz.com'
    image_base_url = 'https://froiz.com/cdn-cgi/imagedelivery'
    source_type = 'online_catalog'
    page_size = 100

    def __init__(self, db_manager):
        super().__init__(db_manager)
        self.session.headers.update({'Accept': 'application/json', 'Accept-Language': 'pt-PT,pt;q=0.9'})

    def discover_categories(self):
        try:
            response = self.get_with_retry(self.api_base_url + '/api/categories', params={'channel.id': 1, 'isEnabled': 'true', 'coverage[gte]': 0})
            data = response.json()
            if not isinstance(data, list):
                raise ValueError('unrecognised public category response')
            categories = [{'name': c['name'], 'slug': c['slug'], 'source_id': c.get('id')} for c in data if isinstance(c, dict) and c.get('slug') and c.get('name')]
            if not categories:
                raise ValueError('empty public category response')
            return categories
        except Exception as exc:
            self._record_error({'name': 'category discovery'}, str(exc))
            return []

    def scrape_category(self, category):
        slug = category.get('slug')
        if not slug:
            self._record_error(category, 'missing category slug')
            return []
        products, seen_ids = [], set()
        for page in range(1, self.max_pages + 1):
            try:
                response = self.get_with_retry(self.api_base_url + '/api/products', params={'category': slug, 'page': page, 'size': self.page_size})
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get('products'), list):
                    raise ValueError('unrecognised public product response')
                rows = data['products']
                stats = data.get('stats') or {}
                current_page = int(stats.get('pageNumber', page))
                total_pages = int(stats['totalPages']) if stats.get('totalPages') is not None else None
                total = int(stats['productTotal']) if stats.get('productTotal') is not None else None
                if current_page != page:
                    raise ValueError(f'requested page {page}, received {current_page}')
            except Exception as exc:
                self._record_error(category, f'page {page}: {exc}')
                break
            if not rows:
                if not products or (total is not None and len(seen_ids) < total):
                    self._record_error(category, f'page {page}: empty listing before all products were observed')
                break
            new_count = 0
            for row in rows:
                try:
                    if not isinstance(row, dict):
                        raise ValueError('product must be an object')
                    if row.get('category_slug') and row['category_slug'] != slug:
                        raise ValueError('category filter was not respected')
                    product = self._extract_product(row, category)
                    if not product:
                        raise ValueError('missing product identifier or name')
                except (ValueError, TypeError, AttributeError) as exc:
                    self._record_error(category, f'page {page}: {exc}')
                    continue
                if product['external_id'] in seen_ids:
                    continue
                seen_ids.add(product['external_id'])
                products.append(product)
                new_count += 1
            if not new_count:
                self._record_error(category, f'page {page}: repeated or unparseable products')
                break
            if total_pages is not None and page >= total_pages:
                if total is not None and len(seen_ids) < total:
                    self._record_error(category, f'only {len(seen_ids)} of {total} advertised products were observed')
                break
            if page == self.max_pages:
                self._record_error(category, f'page limit {self.max_pages} reached')
                break
            import time
            time.sleep(self.request_delay)
        return products

    def _extract_product(self, row, category):
        if not row.get('id') or not row.get('name'):
            return None
        name = row['name'].strip()
        price = self._parse_price(row.get('order_price')) or self._parse_price(row.get('base_price'))
        base_price = self._parse_price(row.get('base_price'))
        offer = row.get('offer') or {}
        unit_match = re.search(r'\b(\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\s*(?:kg|gr|g|ml|cl|l|unidades?|un))\b', name, re.I)
        unit = unit_match[1] if unit_match else None
        ratio = self._parse_price(row.get('measurement_unit_ratio'))
        measurement = (row.get('measurement_unit') or '').lower()
        price_unit = {'litro': 'l', 'kilo': 'kg', 'quilo': 'kg', 'kilograma': 'kg', 'quilograma': 'kg', 'unidad': 'un', 'unidade': 'un'}.get(measurement)
        unit_price = round(price / ratio, 6) if price > 0 and ratio > 0 and price_unit else None
        image = row.get('image')
        image_url = None
        if isinstance(image, str) and image.strip():
            if image.startswith(('http://', 'https://')):
                image_url = self._absolute_url(image)
            elif image.startswith('/'):
                # The frontend constructs this same stable public image path;
                # omit the short-lived URL signature returned by the API.
                image_url = self.image_base_url + image.split('?', 1)[0]
        path = '/product/' + quote(str(row.get('slug') or row['id']), safe='-')
        metadata = {
            'coverage': 'public_catalogue_subset', 'availability_scope': 'public_default_catalogue',
            'store_stock_confirmed': False, 'delivery_coverage_confirmed': False,
            'source_category_path': [row[k] for k in ('category_name', 'section_name', 'family_name', 'subfamily_name') if row.get(k)],
            'properties': row.get('properties') or {}, 'offer': offer,
            'unit_price_derived_from_package_ratio': unit_price is not None,
        }
        if offer:
            metadata['valid_from'] = offer.get('date_from')
            metadata['valid_to'] = offer.get('date_to')
        return self._enrich_product({
            'category_id': None, 'category_name': row.get('category_name') or category.get('name'),
            'external_id': str(row['id']), 'name': name, 'brand': row.get('brand_name'),
            'description': row.get('description'), 'price': price, 'price_currency': 'EUR',
            'regular_price': base_price if base_price > price else None,
            'unit': unit, 'unit_price': unit_price, 'unit_price_unit': price_unit if unit_price else None,
            'barcode': row.get('ean') or row.get('gtin'), 'url': self.base_url + path,
            'image_url': image_url, 'in_stock': price > 0 and row.get('enabled') is not False,
            'deleted': False,
        }, metadata=metadata)
