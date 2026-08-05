import json
import re
import time
import html as html_module
from urllib.parse import urljoin

import requests
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
        cgid = category.get('cgid')
        if not cgid:
            print(f"    Pular {category['name']} (Sem cgid)")
            return []

        print(f"A extrair categoria via API (Requests): {category['name']} (cgid: {cgid})")

        products = []
        start = 0
        seen_ids = set()
        page_num = 1

        while True:
            params = {
                'cgid': cgid,
                'start': start,
                'sz': self.page_size,
            }
            try:
                response = self.get_with_retry(self.ajax_url, params=params, timeout=30)
            except Exception as e:
                err = f"Auchan ({category['name']}, pág {page_num}): {e}"
                print(f"    Erro de rede na página {page_num}: {e}")
                self.scrape_errors.append(err)
                break

            page_products = self._extract_products(response.text, category)

            if not page_products:
                print(f"    Página {page_num} vazia. Fim da categoria.")
                break

            new_products_count = 0
            for p in page_products:
                eid = p.get('external_id')
                if eid and eid not in seen_ids:
                    seen_ids.add(eid)
                    products.append(p)
                    new_products_count += 1

            print(f"    Página {page_num}: recebidos {len(page_products)} produtos ({new_products_count} novos).")

            if new_products_count == 0:
                print("    Nenhum produto novo extraído (ciclo duplicado detetado). A interromper.")
                break

            if page_num >= 400:
                print("    Limite máximo de 400 páginas alcançado.")
                break

            page_num += 1
            start += self.page_size
            time.sleep(0.5)

        print(f"    ✓ Total {len(products)} produtos coletados em {category['name']}")
        return products

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
        if not external_id:
            return None
        external_id = str(external_id).strip()

        gtm = None
        gtm_el = tile.get('data-gtm') or tile.get('data-gtm-new')
        if gtm_el:
            try:
                gtm = json.loads(html_module.unescape(gtm_el))
            except Exception:
                gtm = None

        name = None
        brand = None
        price = 0.0
        category_name = category.get('name')

        if gtm:
            name = gtm.get('name') or gtm.get('item_name') or name
            brand = gtm.get('brand') or gtm.get('item_brand') or brand
            try:
                price = float(gtm.get('price', 0.0) or 0.0)
            except (TypeError, ValueError):
                price = 0.0

        if not name:
            name = self._text(tile.select_one('.auc-product-tile__name, .pdp-link, h2, h3'))

        if price == 0.0:
            price_el = tile.select_one('.price, .auc-product-tile__price, .sales .value')
            if price_el and price_el.get('content'):
                try:
                    price = float(price_el.get('content'))
                except (TypeError, ValueError):
                    price = 0.0
            if price == 0.0:
                price = self._parse_price(self._text(price_el))

        return {
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
            'in_stock': True,
            'deleted': False,
            'last_scraped_at': None,
        }

    def _extract_unit(self, tile):
        unit_el = tile.select_one('.auc-measures--price-per-unit, .pwc-tile--quantity, .product-quantity')
        if unit_el:
            unit_text = unit_el.get_text(strip=True)
            if unit_text and not unit_text.lower().startswith('preço'):
                return unit_text
        return None

    def _text(self, element):
        return element.get_text(strip=True) if element else None

    def _parse_price(self, price_text):
        if not price_text:
            return 0.0
        normalized = price_text.replace('€', '').replace(',', '.').strip()
        match = re.search(r'\d+[\.,]?\d*', normalized)
        return float(match.group(0).replace(',', '.')) if match else 0.0

    def _extract_url(self, tile):
        link = tile.find('a', href=True)
        if link:
            href = link['href']
            if href.startswith('/'):
                return urljoin(self.base_url, href)
            return href
        return None

    def _extract_image(self, tile):
        image = tile.select_one('img[data-src]') or tile.find('img')
        if image:
            url = image.get('data-src') or image.get('src')
            if url and 'wishlist' not in url:
                return url
        return None