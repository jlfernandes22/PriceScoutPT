import json
import re
import time
import unicodedata
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from scraper_base import ScraperBase


class ContinenteScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000001'
    base_url = 'https://www.continente.pt'
    ajax_url = 'https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid'
    page_size = 36

    def __init__(self, db_manager):
        super().__init__(db_manager)
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': (
                'Mozilla/5.0 (X11; Linux x86_64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/126.0.0.0 Safari/537.36'
            ),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': self.base_url,
            'X-Requested-With': 'XMLHttpRequest',
        })



    def _slugify(self, text):
        text = text.lower()
        text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8')
        text = re.sub(r'[^a-z0-9\s-]', '', text)
        text = re.sub(r'[\s]+', '-', text)
        return text

    def discover_categories(self):
        category_names = [
            'Novidades', 'Frescos', 'Laticínios e Ovos', 'Congelados',
            'Mercearia', 'Bebidas e Garrafeira', 'Bio e Saudável',
            'Limpeza', 'Bebé', 'Beleza e Higiene', 'Animais',
            'Casa, Bricolage e Jardim', 'Brinquedos e Jogos',
            'Livros', 'Papelaria', 'Desporto e Viagem',
        ]
        
        # Mapeamento fixo para os identificadores internos (cgid) da Demandware 
        # que evitam os limites de 35 produtos infinitos do Continente.
        cgid_mapping = {
            'Novidades': 'campanhas-novidades',
            'Frescos': 'frescos',
            'Laticínios e Ovos': 'laticinios',
            'Congelados': 'congelados',
            'Mercearia': 'mercearias',
            'Bebidas e Garrafeira': 'bebidas',
            'Bio e Saudável': 'biologicos',
            'Limpeza': 'limpeza',
            'Bebé': 'bebe',
            'Beleza e Higiene': 'higiene-beleza',
            'Animais': 'animais',
            'Casa, Bricolage e Jardim': 'casa',
            'Brinquedos e Jogos': 'brinquedos-jogos',
            'Livros': 'livros',
            'Papelaria': 'papelaria-material',
            'Desporto e Viagem': 'desporto-ar-livre'
        }

        return [
            {
                'name': name, 
                'path': f'/{self._slugify(name)}',
                'cgid': cgid_mapping.get(name, self._slugify(name))
            }
            for name in category_names
        ]

    def scrape_category(self, category):
        cgid = category.get('cgid')
        if not cgid:
            cgid = category.get('path', '').strip('/')
            
        if not cgid:
            raise ValueError('Categoria inválida para Continente')

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
                err = f"Continente ({category['name']}, pág {page_num}): {e}"
                print(f"    Erro de rede na página {page_num}: {e}")
                self.scrape_errors.append(err)
                break

            html = response.text
            page_products = self._extract_products(html, category)
            
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
            time.sleep(0.5)  # Pausa ligeira para proteger a API
            
        print(f"    ✓ Total {len(products)} produtos coletados em {category['name']}")
        return products

    def _extract_products(self, html, category):
        soup = BeautifulSoup(html, 'html.parser')
        tiles = soup.select('.product-tile')
        extracted = []

        for tile in tiles:
            product_wrapper = tile.find_parent(class_='product') or tile
            external_id = (
                product_wrapper.get('data-pid') or
                tile.get('data-pid') or
                tile.get('data-product-id') or
                tile.get('data-product-code')
            )

            # Fonte primária: JSON estruturado com id/name/price/brand/category
            impression = None
            impression_data = tile.get('data-product-tile-impression') or product_wrapper.get('data-product-tile-impression')
            if impression_data:
                try:
                    impression = json.loads(impression_data)
                except Exception:
                    impression = None

            if not external_id and impression:
                external_id = impression.get('id')

            if not external_id:
                classes = tile.get('class', [])
                for cls in classes:
                    match = re.match(r'pid-(\d+)', cls)
                    if match:
                        external_id = match.group(1)
                        break

            if not external_id:
                continue

            name = None
            brand = None
            price = 0.0
            if impression:
                name = impression.get('name') or name
                brand = impression.get('brand') or brand
                try:
                    price = float(impression.get('price', 0.0) or 0.0)
                except (TypeError, ValueError):
                    price = 0.0
                impression_category = impression.get('category') or ''
            else:
                impression_category = ''

            if not name:
                name = self._text(tile.select_one('h2, h3, .product-title, .product-name'))
            if not brand:
                brand = self._text(tile.select_one('.product-brand, .brand-name, .pwc-tile--brand'))
            if price == 0.0:
                price_text = self._text(tile.select_one('.pwc-tile--price-primary, .price, .product-price'))
                price = self._parse_price(price_text)

            url = self._extract_url(tile)
            image_url = self._extract_image(tile)

            # Unidade (ex: "emb. 120 gr (peso escorrido 78 gr)")
            unit = None
            unit_el = tile.select_one('.pwc-tile--quantity, .product-quantity, .quantity')
            if unit_el:
                unit_text = unit_el.get_text(strip=True)
                if unit_text and not unit_text.lower().startswith('preço'):
                    unit = unit_text

            # Categoria: hierarquia "Mercearia/Conservas/Atum" -> nível principal
            category_name = category.get('name')
            if impression_category:
                category_name = impression_category.split('/')[0].strip()

            extracted.append({
                'category_id': None,
                'category_name': category_name,
                'external_id': str(external_id),
                'name': name,
                'brand': brand,
                'description': None,
                'price': price,
                'price_currency': 'EUR',
                'unit': unit,
                'url': url,
                'image_url': image_url,
                'in_stock': True,
                'deleted': False,
                'last_scraped_at': None,
            })

        return extracted




    def _extract_image(self, card):
        # A primeira imagem do tile pode ser um badge promocional (pvpr.png).
        # A imagem real do produto vive em .ct-tile-image / .product-tile-image.
        image = (
            card.select_one('img.ct-tile-image') or
            card.select_one('picture img') or
            card.select_one('.product-tile-image img') or
            card.select_one('img')
        )
        if not image:
            return None
        url = image.get('src') or image.get('data-src')
        if not url or 'badges' in url:
            # Fallback: procurar a primeira imagem que não seja um badge
            for img in card.find_all('img'):
                candidate = img.get('src') or img.get('data-src')
                if candidate and 'badges' not in candidate:
                    url = candidate
                    break
        return url
