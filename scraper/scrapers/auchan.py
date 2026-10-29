import re

from bs4 import BeautifulSoup

from scraper_base import ScraperBase


class AuchanScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000005'
    base_url = 'https://www.auchan.pt'
    ajax_url = 'https://www.auchan.pt/on/demandware.store/Sites-AuchanPT-Site/pt_PT/Search-UpdateGrid'
    page_size = 100

    # Top-level category cgids (SFCC) valid em www.auchan.pt (mai-2026).
    CATEGORIES = [
        {'name': 'Alimentação', 'cgid': 'alimentacao'},
        {'name': 'Talho', 'cgid': 'talho'},
        {'name': 'Peixaria', 'cgid': 'peixaria'},
        {'name': 'Padaria', 'cgid': 'padaria'},
        {'name': 'Charcutaria', 'cgid': 'charcutaria'},
        {'name': 'Bebidas', 'cgid': 'bebidas'},
        {'name': 'Bebidas e Garrafeira', 'cgid': 'bebidas-e-garrafeira'},
        {'name': 'Mercearia', 'cgid': 'mercearia'},
        {'name': 'Pequeno-Almoço', 'cgid': 'pequeno-almoco'},
        {'name': 'Higiene', 'cgid': 'higiene'},
        {'name': 'Drogaria', 'cgid': 'drogaria'},
        {'name': 'Limpeza e Casa', 'cgid': 'limpeza-casa'},
        {'name': 'Casa', 'cgid': 'casa'},
        {'name': 'Decoração', 'cgid': 'decoracao'},
        {'name': 'Ferramentas', 'cgid': 'ferramentas'},
        {'name': 'Eletrodomésticos', 'cgid': 'eletrodomesticos'},
        {'name': 'Tecnologia', 'cgid': 'tecnologia'},
        {'name': 'Informática', 'cgid': 'informatica'},
        {'name': 'Animais', 'cgid': 'animais'},
        {'name': 'Brinquedos', 'cgid': 'brinquedos'},
        {'name': 'Jogos', 'cgid': 'jogos'},
        {'name': 'Desporto', 'cgid': 'desporto'},
        {'name': 'Papelaria', 'cgid': 'papelaria'},
    ]

    def __init__(self, db_manager):
        super().__init__(db_manager)
        self.session.headers.update({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-PT,pt;q=0.9',
            'Referer': self.base_url,
            'X-Requested-With': 'XMLHttpRequest',
        })

    def discover_categories(self) -> list[dict]:
        return [
            {'name': c['name'], 'cgid': c['cgid']}
            for c in self.CATEGORIES
        ]

    def scrape_category(self, category):
        return self._scrape_sfcc_category(category, '.product-tile')

    def _extract_products(self, html_text, category):
        soup = BeautifulSoup(html_text, 'html.parser')
        tiles = soup.select('.product-tile')
        extracted = []

        for tile in tiles:
            product = self._extract_card(tile, category)
            if product:
                extracted.append(product)

        return extracted

    def _extract_card(self, tile, category):
        external_id = tile.get('data-pid') or tile.get('data-product-id')
        external_id = str(external_id).strip() if external_id else None

        gtm = None
        gtm_el = tile.get('data-gtm') or tile.get('data-gtm-new')
        if gtm_el:
            try:
                gtm = self._json(gtm_el)
                gtm = gtm if isinstance(gtm, dict) else None
            except Exception:
                gtm = None

        name = None
        brand = None
        price = 0.0
        category_name = category.get('name')

        # Produtos indisponíveis no site têm a classe auc-product-unavailable e
        # o data-gtm SEM campo price — nunca devem aparecer com preço 0.00€.
        unavailable = 'auc-product-unavailable' in (tile.get('class') or [])

        if gtm:
            name = gtm.get('name') or gtm.get('item_name') or name
            brand = gtm.get('brand') or gtm.get('item_brand') or brand
            try:
                price = self._parse_price(gtm.get('price'))
            except (TypeError, ValueError):
                price = 0.0

        if not external_id and gtm:
            external_id = str(gtm.get('id') or gtm.get('item_id') or '').strip()
        if not external_id:
            return None
        if not name:
            name = self._text(tile.select_one('.auc-product-tile__name, .pdp-link, h2, h3'))

        if price == 0.0:
            price_el = tile.select_one('.sales .value, .sales, .auc-product-tile__price')
            if price_el and price_el.get('content'):
                try:
                    price = float(price_el.get('content'))
                except (TypeError, ValueError):
                    price = 0.0
            if price == 0.0:
                price = self._parse_price(self._text(price_el))

        # Sem preço no tile = produto não comprável (indisponível/esgotado).
        if price == 0.0:
            unavailable = True

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
            'unit': self._extract_unit(tile),
            'url': self._extract_url(tile),
            'image_url': self._extract_image(tile),
            'in_stock': not unavailable,
            'deleted': False,
            'last_scraped_at': None,
        }, card=tile, unit_price_text=self._text(tile.select_one('.auc-measures--price-per-unit')), metadata={
            'source_category_path': (gtm.get('category') or '').split('/') if gtm else [category_name],
        })

    def _extract_unit(self, tile):
        unit_el = tile.select_one('.pwc-tile--quantity, .product-quantity')
        if unit_el:
            unit_text = unit_el.get_text(strip=True)
            if unit_text and not unit_text.lower().startswith('preço'):
                return unit_text
        # The listing only publishes unit price; infer a package size only when
        # explicitly present in the title, never store €/kg as the package size.
        title = self._text(tile.select_one('.auc-product-tile__name, .pdp-link, h2, h3')) or ''
        match = re.search(r'\b(\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|l))\b', title, re.I)
        return match.group(1) if match else None
