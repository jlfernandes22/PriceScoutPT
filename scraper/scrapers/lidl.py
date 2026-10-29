import time
from scraper_base import ScraperBase


class LidlScraper(ScraperBase):
    """Lidl PT via o endpoint JSON /q/api/search.

    O website carrega os produtos através de uma API interna que devolve
    JSON estruturado com título, preço, imagem e categoria — muito mais
    rápido e fiável do que navegar o DOM com um browser.
    """
    supermarket_id = '00000000-0000-0000-0000-000000000002'
    base_url = 'https://www.lidl.pt'
    source_type = 'public_listing'
    api_url = 'https://www.lidl.pt/q/api/search'
    page_size = 100

    def __init__(self, db_manager) -> None:
        super().__init__(db_manager)
        self.session.headers.update({
            'Accept': '*/*',
            'Accept-Language': 'pt-PT,pt;q=0.9',
            'Referer': self.base_url,
        })

    def discover_categories(self) -> list[dict]:
        # IDs estáveis das categorias top-level que expõem grelha de produtos
        return [
            {'name': 'Mercearia e Frescos', 'path': '/c/mercearia-e-frescos/s10068374', 'api_id': '10068374'},
            {'name': 'Cozinha e Cuidado do Lar', 'path': '/c/cozinha-e-cuidado-do-lar/s10068166', 'api_id': '10068166'},
            {'name': 'Ferramentas e Jardim', 'path': '/c/ferramentas-e-jardim/s10068222', 'api_id': '10068222'},
            {'name': 'Desporto e Tempos Livres', 'path': '/c/desporto-e-tempos-livres/s10068226', 'api_id': '10068226'},
            {'name': 'Casa e Decoração', 'path': '/c/casa-e-decoracao/s10068371', 'api_id': '10068371'},
            {'name': 'Moda e Acessórios', 'path': '/c/moda-e-acessorios/s10068373', 'api_id': '10068373'},
            {'name': 'Bebé, Criança e Brinquedos', 'path': '/c/bebe-crianca-e-brinquedos/s10068225', 'api_id': '10068225'},
        ]

    def scrape_category(self, category: dict) -> list[dict]:
        api_id = category.get('api_id') or re_find_id(category.get('path', ''))
        if not api_id:
            self._record_error(category, 'missing category identifier')
            return []
        products, seen_ids, seen_pages = [], set(), set()
        offset = 0
        for page in range(1, self.max_pages + 1):
            params = {
                'offset': offset, 'fetchsize': self.page_size, 'locale': 'pt_PT',
                'assortment': 'PT', 'version': '2.1.0', 'category.id': api_id,
            }
            try:
                response = self.get_with_retry(self.api_url, params=params, timeout=30)
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get('items'), list):
                    raise ValueError('unrecognised search response (items must be an array)')
                items = data['items']
                total = int(data['numFound']) if data.get('numFound') is not None else None
                returned_offset = int(data['offset']) if data.get('offset') is not None else offset
                if returned_offset != offset:
                    raise ValueError(f'requested offset {offset}, received {returned_offset}')
            except Exception as exc:
                self._record_error(category, f'offset {offset}: {exc}')
                break
            if not items:
                if not products or (total is not None and offset < total):
                    self._record_error(category, f'empty search page at offset {offset}')
                break
            fingerprint = repr(items)
            if fingerprint in seen_pages:
                self._record_error(category, f'repeated search page at offset {offset}')
                break
            seen_pages.add(fingerprint)
            count = 0
            source_product_count = 0
            for item in items:
                if not isinstance(item, dict):
                    self._record_error(category, f'malformed search item at offset {offset}')
                    continue
                if item.get('resultClass') != 'product' and item.get('type') != 'product':
                    continue
                source_product_count += 1
                try:
                    product = self._extract_item(item, category)
                except (TypeError, ValueError, AttributeError) as exc:
                    self._record_error(category, f'invalid product at offset {offset}: {exc}')
                    continue
                if not product:
                    self._record_error(category, f'product without identifier or name at offset {offset}')
                    continue
                if product['external_id'] in seen_ids:
                    continue
                seen_ids.add(product['external_id'])
                products.append(product)
                count += 1
            if source_product_count and not count:
                self._record_error(category, f'no new valid products at offset {offset}')
                break
            # Some API deployments cap fetchsize. Advance by returned results,
            # including banners, rather than skipping products with page_size.
            offset += len(items)
            if total is not None and offset >= total:
                break
            if page == self.max_pages:
                self._record_error(category, f'page limit {self.max_pages} reached')
                break
            time.sleep(self.request_delay)
        return products

    def _extract_item(self, item, category):
        gridbox = item.get('gridbox') or {}
        data = gridbox.get('data') or {}
        meta = gridbox.get('meta') or {}
        external_id = str(data.get('itemId') or data.get('erpNumber') or item.get('code') or '').strip()
        name = data.get('title') or data.get('fullTitle')
        if not external_id or not name:
            return None
        brand = data.get('brand') or {}
        brand = brand.get('name') if isinstance(brand, dict) else str(brand)
        # The normal selling price is in data.price, NOT lidlPlus[0].price.
        # Current region prices also contain validity dates absent from price.
        price_info = data.get('price') or {}
        region_prices = data.get('regionsPrices') or {}
        regions = data.get('regionsV2') or {}
        default_region = next((r for r in regions.values() if isinstance(r, dict) and r.get('isDefault')), {})
        region_id = str(default_region.get('regionPriceId') or '1')
        regional = region_prices.get(region_id) or {}
        current_region = regional.get('currentPrice') or {}
        region_loyalty = regional.get('currentLidlPlusPrice') or {}
        price = self._parse_price(price_info.get('price'))
        if not price:
            price_info = current_region
            price = self._parse_price(price_info.get('price'))
        loyalty_offers = []
        current_loyalty = []
        for offer in ([region_loyalty] if region_loyalty else (data.get('lidlPlus') or [])):
            loyalty_price = self._parse_price((offer.get('price') or {}).get('price'))
            if loyalty_price:
                loyalty_offers.append({'price': loyalty_price, 'label': offer.get('lidlPlusText') or 'Com Lidl Plus'})
                current_loyalty.append(offer)
        requires_loyalty = False
        if not price and loyalty_offers:
            # Preserve a publicly advertised card-only offer with its condition.
            price_info = (current_loyalty[0].get('price') or {})
            price = loyalty_offers[0]['price']
            requires_loyalty = True
        unit_price_text = (price_info.get('basePrice') or {}).get('text')
        unit = (price_info.get('packaging') or {}).get('text')
        keyfacts = data.get('keyfacts') or {}
        category_path = keyfacts.get('wonCategoryPrimary') or ''
        old_price = price_info.get('oldPrice') or price_info.get('regularPrice') or (current_region.get('oldPrice') if not requires_loyalty else None)
        if isinstance(old_price, dict):
            old_price = old_price.get('price')
        image_url = self._absolute_url(data.get('image'))
        if image_url and image_url.endswith('.svg'):
            image_url = None
        metadata = {
            'coverage': 'public_catalogue_subset',
            'availability_scope': 'advertised_in_store' if data.get('store') else 'online_listing',
            'store_stock_confirmed': False,
            'requires_loyalty_card': requires_loyalty,
            'loyalty_offers': loyalty_offers,
            'source_category_path': category_path.split('/') if category_path else [category.get('name')],
            'valid_from': price_info.get('startDate') or current_region.get('startDate'),
            'valid_to': price_info.get('endDate') or current_region.get('endDate'),
            'store_start_date': data.get('storeStartDate'),
            'store_end_date': data.get('storeEndDate'),
        }
        return self._enrich_product({
            'category_id': None, 'category_name': category.get('name'),
            'external_id': external_id, 'name': name, 'brand': brand,
            'description': None, 'price': price, 'price_currency': 'EUR',
            'unit': unit, 'url': self._absolute_url(data.get('canonicalUrl') or data.get('canonicalPath')),
            'image_url': image_url, 'barcode': meta.get('ean') or data.get('gtin'),
            'regular_price': self._parse_price(old_price) or None,
            'in_stock': price > 0 and not bool(data.get('preventSelling')),
            'deleted': False, 'last_scraped_at': None,
        }, unit_price_text=unit_price_text, metadata=metadata)


def re_find_id(path: str) -> str:
    import re
    match = re.search(r's(\d+)', path or '')
    return match.group(1) if match else None
