import json
import re
import unicodedata

from bs4 import BeautifulSoup

from scraper_base import ScraperBase


class ContinenteScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000001'
    base_url = 'https://www.continente.pt'
    ajax_url = 'https://www.continente.pt/on/demandware.store/Sites-continente-Site/default/Search-UpdateGrid'
    page_size = 36

    def __init__(self, db_manager):
        super().__init__(db_manager)
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
        return self._scrape_sfcc_category(category, '.product-tile')

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
                    impression = self._json(impression_data)
                    impression = impression if isinstance(impression, dict) else None
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
                    price = self._parse_price(impression.get('price'))
                except (TypeError, ValueError):
                    price = 0.0
                impression_category = impression.get('category') or ''
            else:
                impression_category = ''

            if not name:
                name = self._text(tile.select_one('h2, h3, .pwc-tile--description, .product-title, .product-name'))
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
                hierarchy = [part.strip() for part in impression_category.split('/') if part.strip()]
                hierarchy = [part for part in hierarchy if part.lower() not in ('supermercado', 'continente', 'home')]
                category_name = hierarchy[0] if hierarchy else category_name

            if not name:
                continue

            extracted.append(self._enrich_product({
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
                'in_stock': price > 0 and not bool(tile.select_one('.product-unavailable, .out-of-stock')),
                'deleted': False,
                'last_scraped_at': None,
            }, card=tile, unit_price_text=self._text(tile.select_one('.pwc-tile--price-secondary, .price-per-unit')), metadata={
                'source_category_path': impression_category.split('/') if impression_category else [category_name],
            }))

        return extracted
