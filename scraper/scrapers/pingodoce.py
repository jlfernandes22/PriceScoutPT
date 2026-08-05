import json
import re
import time
from urllib.parse import urljoin
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
        products = []

        cgid = category.get('cgid')
        if not cgid:
            print(f"    Pular {category['name']} (Sem cgid)")
            return []

        print(f"A extrair categoria via API (Requests): {category['name']} (cgid: {cgid})")

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
                res = self.get_with_retry(self.ajax_url, params=params, timeout=30)
                html = res.text
            except Exception as e:
                err = f"PingoDoce ({category['name']}, pág {page_num}): {e}"
                print(f"    Erro de rede na página {page_num}: {e}")
                self.scrape_errors.append(err)
                break

            soup = BeautifulSoup(html, 'html.parser')
            cards = soup.select('article, div.product-card, div.product, .product-tile')

            if not cards:
                print(f"    Página {page_num} vazia. Fim da categoria.")
                break

            new_products_count = 0

            for card in cards:
                product = self._extract_card(card, category)
                if not product:
                    continue

                external_id = product['external_id']
                if external_id in seen_ids:
                    continue

                seen_ids.add(external_id)
                products.append(product)
                new_products_count += 1

            print(f"    Página {page_num}: recebidos {len(cards)} produtos ({new_products_count} novos).")

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

    def _extract_card(self, card, category):
        """Extrai um produto de um card, com data-gtm-info JSON como fonte primária."""
        external_id = card.get('data-product-id') or card.get('data-article-code') or card.get('data-pid')
        if not external_id:
            wrapper = card.find(attrs={'data-pid': True})
            if wrapper:
                external_id = wrapper.get('data-pid')
        if not external_id:
            return None
        external_id = str(external_id).strip()

        gtm = None
        gtm_el = card.select_one('[data-gtm-info]')
        if gtm_el:
            try:
                gtm = json.loads(gtm_el.get('data-gtm-info'))
                items = gtm.get('items') or []
                gtm = items[0] if items else gtm
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
                price = float(gtm.get('price', 0.0) or 0.0)
            except (TypeError, ValueError):
                price = 0.0
            # Categoria hierárquica: usar o nível principal (category2)
            if gtm.get('item_category2'):
                category_name = gtm['item_category2']
            elif gtm.get('item_category'):
                category_name = gtm['item_category']

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
        if unit:
            # O campo devolve por vezes "1 Kg | 0,59 €/Kg" — ficamos apenas com o
            # tamanho/embalagem, removendo o preço por unidade que vem a seguir.
            unit = re.split(r'\s*[|/]\s*', unit)[0].strip()

        return {
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
            'in_stock': True,
            'deleted': False,
            'last_scraped_at': None,
        }

    def _text(self, element):
        return element.get_text(strip=True) if element else None

    def _parse_price(self, price_text):
        if not price_text:
            return 0.0
        normalized = price_text.replace('€', '').replace(',', '.').strip()
        match = re.search(r'\d+[\.,]?\d*', normalized)
        return float(match.group(0).replace(',', '.')) if match else 0.0

    def _extract_url(self, card):
        link = card.find('a', href=True)
        if link:
            return urljoin(self.base_url, link['href'])
        return None

    def _extract_image(self, card):
        image = card.find('img')
        if image and image.get('src') and 'wishlist' not in (image.get('src') or ''):
            return urljoin(self.base_url, image['src'])
        if image and image.get('data-src'):
            return urljoin(self.base_url, image['data-src'])
        return None
