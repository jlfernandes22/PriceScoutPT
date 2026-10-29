from urllib.parse import urljoin
import re
from bs4 import BeautifulSoup
from scraper_base import ScraperBase


class PingoDoceScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000003'
    base_url = 'https://www.pingodoce.pt'

    ajax_url = 'https://www.pingodoce.pt/on/demandware.store/Sites-pingo-doce-Site/default/Search-UpdateGrid'
    page_size = 36

    FALLBACK_CATEGORIES = [
        {'name': 'Promoções', 'cgid': 'ec_promos_1100000', 'path': '/home/produtos/promocoes'},
        {'name': 'Frutas e Vegetais', 'cgid': 'ec_frutasevegetais_100', 'path': '/home/produtos/frutas-e-vegetais'},
        {'name': 'Talho', 'cgid': 'ec_talho_200', 'path': '/home/produtos/talho'},
        {'name': 'Peixaria', 'cgid': 'ec_peixaria_300', 'path': '/home/produtos/peixaria'},
        {'name': 'Mercearia', 'cgid': 'ec_mercearia_1300', 'path': '/home/produtos/mercearia'},
        {'name': 'Laticínios', 'cgid': 'ec_laticiniosecongelados_500', 'path': '/home/produtos/laticinios-e-congelados'},
        {'name': 'Congelados', 'cgid': 'ec_congelados_1000', 'path': '/home/produtos/congelados'},
        {'name': 'Padaria e Pastelaria', 'cgid': 'ec_padariaepastelaria_400', 'path': '/home/produtos/padaria-e-pastelaria'},
        {'name': 'Bebidas', 'cgid': 'ec_bebidas_1400', 'path': '/home/produtos/bebidas'},
        {'name': 'Charcutaria e Queijos', 'cgid': 'ec_charcutariaequeijos_600', 'path': '/home/produtos/charcutaria-e-queijos'},
        {'name': 'Higiene e Beleza', 'cgid': 'ec_higieneebeleza_1800_400', 'path': '/home/produtos/parafarmacia/higiene-e-beleza'},
        {'name': 'Limpeza e Casa', 'cgid': 'ec_limpezaecasa_1900', 'path': '/home/produtos/limpeza-e-casa'},
    ]

    def __init__(self, db_manager):
        super().__init__(db_manager)
        self.session.headers.update({
            'Accept': '*/*',
            'X-Requested-With': 'XMLHttpRequest',
        })

    def discover_categories(self) -> list[dict]:
        # O fallback estático curado é a fonte primária (rápido e estável).
        return [
            {
                'name': f['name'],
                'cgid': f['cgid'],
                'url': urljoin(self.base_url, f['path']),
            }
            for f in self.FALLBACK_CATEGORIES
        ]

    def scrape_category(self, category):
        return self._scrape_sfcc_category(category, '.product-tile-pd, .product-tile, article.product-card, div.product-card, div.product[data-pid]')

    def _extract_products(self, html_text, category):
        soup = BeautifulSoup(html_text, 'html.parser')
        cards = soup.select('.product-tile-pd, .product-tile, article.product-card, div.product-card, div.product[data-pid]')
        products = {}
        for card in cards:
            product = self._extract_card(card, category)
            if product:
                products[product['external_id']] = product
        return list(products.values())

    def _extract_card(self, card, category):
        """Extrai um produto de um card, com data-gtm-info JSON como fonte primária."""
        external_id = card.get('data-product-id') or card.get('data-article-code') or card.get('data-pid')
        if not external_id:
            wrapper = card.find(attrs={'data-pid': True})
            if wrapper:
                external_id = wrapper.get('data-pid')
        # The identifier may only be present in the analytics payload.
        external_id = str(external_id).strip() if external_id else None

        gtm = None
        gtm_el = card if card.get('data-gtm-info') else card.select_one('[data-gtm-info]')
        if gtm_el:
            try:
                gtm = self._json(gtm_el.get('data-gtm-info'))
                gtm = gtm if isinstance(gtm, dict) else {}
                items = gtm.get('items') or []
                gtm = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else gtm
            except Exception:
                gtm = None

        name = None
        brand = None
        price = 0.0
        category_name = category.get('name')

        if gtm:
            name = gtm.get('item_name') or name
            brand = gtm.get('item_brand') or brand
            try:
                price = self._parse_price(gtm.get('price'))
            except (TypeError, ValueError):
                price = 0.0
            # Categoria hierárquica: usar o nível principal (category2)
            if gtm.get('item_category2'):
                category_name = gtm['item_category2']
            elif gtm.get('item_category'):
                category_name = gtm['item_category']

        if not external_id and gtm:
            external_id = str(gtm.get('item_id') or gtm.get('id') or '').strip()
        if not external_id:
            return None

        if not name:
            name = self._text(card.select_one('.product-name-link, h2, h3, .product-name, .card-title'))
        if not brand:
            brand = self._text(card.select_one('.product-brand-name, .product-brand, .brand, .brand-name'))
        if price == 0.0:
            # .sales é o elemento correto (div.product-price inclui texto extra)
            price_el = card.select_one('.sales .value, .sales, .price__value')
            if price_el is None:
                price_el = card.select_one('.product-price .value')
            if price_el and price_el.get('content'):
                try:
                    price = float(price_el.get('content'))
                except (TypeError, ValueError):
                    price = 0.0
            if price == 0.0:
                price = self._parse_price(self._text(price_el))

        unit = self._text(card.select_one('.product-unit, .product-quantity, .quantity'))
        unit_price_text = unit
        if unit:
            # O campo devolve por vezes "1 Kg | 0,59 €/Kg" — ficamos apenas com o
            # tamanho/embalagem, removendo o preço por unidade que vem a seguir.
            unit = unit.split('|', 1)[0].strip()

        if not name:
            return None

        return self._enrich_product({
            'category_id': None,
            'category_name': category_name,
            'external_id': external_id,
            'name': name,
            'brand': brand,
            'description': None,
            'price': price,
            'price_currency': 'EUR',
            'unit': unit,
            'url': self._extract_url(card),
            'image_url': self._extract_image(card),
            'in_stock': price > 0 and not bool(card.select_one('.product-unavailable, .out-of-stock')),
            'deleted': False,
            'last_scraped_at': None,
        }, card=card, unit_price_text=unit_price_text, metadata={
            'source_category_path': [gtm[k] for k in ('item_category2', 'item_category', 'item_category3', 'item_category4') if gtm.get(k)] if gtm else [category_name],
        })
