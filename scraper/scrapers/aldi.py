import hashlib
import json
import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from scraper_base import ScraperBase


class AldiScraper(ScraperBase):
    """Public weekly leaflets; these cover advertised offers, not a full stock list."""
    supermarket_id = '00000000-0000-0000-0000-000000000004'
    base_url = 'https://www.aldi.pt'
    source_type = 'leaflet'

    def discover_categories(self):
        return [{'name': 'Oportunidades da Semana', 'path': '/folheto/esta-semana.html'}]

    def scrape_category(self, category):
        try:
            page_url = self._absolute_url(category.get('path'))
            try:
                response = self.get_with_retry(page_url, timeout=30)
            except Exception:
                # Recover a changed public leaflet path from the official index.
                index = self.get_with_retry(self.base_url, timeout=30)
                soup = BeautifulSoup(index.text, 'html.parser')
                links = [a['href'] for a in soup.select('a[href]') if 'folheto' in a['href'] and 'esta-semana' in a['href']]
                if not links:
                    raise ValueError('current leaflet link not found in the public index')
                response = self.get_with_retry(self._absolute_url(links[0]), timeout=30)
            soup = BeautifulSoup(response.text, 'html.parser')
            script = soup.find('script', id='__NEXT_DATA__')
            next_data = json.loads(script.string) if script and script.string else {}
            leaflet_url = next_data.get('props', {}).get('pageProps', {}).get('page', {}).get('link')
            if not leaflet_url or urlsplit(leaflet_url).hostname not in ('folhetos.aldi.pt', 'www.aldi.pt', 'aldi.pt'):
                raise ValueError('official public leaflet viewer link not found')
            viewer = self.get_with_retry(leaflet_url, timeout=30)
            settings = self._extract_settings(viewer.text)
            page_texts = settings.get('pageTexts')
            if not isinstance(page_texts, list) or not page_texts or not all(isinstance(t, str) for t in page_texts):
                raise ValueError('leaflet pageTexts missing or malformed')
            products = self._extract_page_texts(page_texts, category, leaflet_url)
            if not products:
                self._record_error(category, 'no reliable product/price pairs found in the leaflet')
            return products
        except Exception as exc:
            self._record_error(category, str(exc))
            return []

    @staticmethod
    def _extract_settings(text):
        marker = re.search(r'window\.staticSettings\s*=\s*', text)
        if not marker:
            raise ValueError('public leaflet settings not found')
        # raw_decode handles multiline JSON and braces inside string values.
        settings, _ = json.JSONDecoder().raw_decode(text[marker.end():])
        if not isinstance(settings, dict):
            raise ValueError('invalid leaflet settings')
        return settings

    @staticmethod
    def _validity(text):
        match = re.search(r'promoções válidas de\s+(\d{1,2}/\d{1,2}/\d{2,4})\s+a\s+(\d{1,2}/\d{1,2}/\d{2,4})', text, re.I)
        if not match:
            return {}
        from datetime import datetime
        values = {}
        try:
            for key, raw in zip(('valid_from', 'valid_to'), match.groups()):
                fmt = '%d/%m/%Y' if len(raw.split('/')[-1]) == 4 else '%d/%m/%y'
                values[key] = datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            return {}
        return values

    def _extract_page_texts(self, page_texts, category, leaflet_url):
        products = {}
        leaflet_validity = self._validity(' '.join(page_texts))
        price_pattern = re.compile(r'(?<![\d.,])(\d{1,4})\s*[.,]\s*(\d{2})(?!\d)')
        unit_pattern = re.compile(r'\b(\d+(?:[.,]\d+)?(?:\s*[-x]\s*\d+(?:[.,]\d+)?)?\s*(?:kg|gr|g|ml|cl|l|unidades?|un))\b', re.I)
        for page_index, raw in enumerate(page_texts, start=1):
            # Dates and unit-price parentheses are not selling prices. Keep the
            # full product segment while passing over unit prices inside it.
            text = raw.replace('\u200b', ' ').replace('\u2009', ' ').replace('\u00a0', ' ')
            text = re.sub(r'\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b', ' ', text)
            text = re.sub(r'(?:Seg|Ter|Qua|Qui|Sex|Sáb|Dom)\.\s*\d{1,2}\.\d{1,2}\.', ' ', text, flags=re.I)
            text = re.sub(r'A partir de\s*', ' ', text, flags=re.I)
            matches = list(price_pattern.finditer(text))
            last_end = 0
            for index, match in enumerate(matches):
                prefix = text[last_end:match.start()]
                raw_prefix = prefix
                # Never let a unit price consume the product name before it.
                if prefix.rfind('(') > prefix.rfind(')') or re.search(r'\b(?:kg|l|un\.?|unidade)\s*=\s*$', prefix, re.I):
                    continue
                price = float(f'{match[1]}.{match[2]}')
                last_end = match.end()
                if price <= 0:
                    continue
                # Broken PDF reading order (e.g. '16 9 . 9') cannot be paired
                # to the following product's correctly printed price.
                if re.search(r'\b\d+\s+\d+\s*[.,]\s*\d+\b|\b[A-Za-z]\s+kg\s+\w', prefix):
                    continue
                # Remove known leaflet chrome. A branded product after a page
                # footnote has an explicit boundary, so retain that later item.
                branded = list(re.finditer(r'\b([A-ZÀ-Ý][A-ZÀ-Ý0-9&\s-]{1,45})\s*®', prefix))
                brand = None
                if branded:
                    anchor = branded[-1]
                    brand = anchor[1].strip()
                    # Marketing calls can precede the brand in an all-caps run.
                    brand = re.split(r'APROVEITA|EXPERIMENTA|NOVO|DESCONTO|UMA VIAGEM DE SABORES À', brand)[-1].strip()
                    prefix = prefix[anchor.end():]
                prefix = re.sub(r'\([^)]*\)', ' ', prefix)
                prefix = re.sub(r'C\s*°|APROVEITA|MELHOR PREÇO|SUPER PREÇO|EXPERIMENTA|APENAS|NOVO|[-–]?\s*\d+\s*%', ' ', prefix, flags=re.I)
                prefix = re.sub(r'CUSTA POUCO COMPRAR BEM|CUSTA POUCO COMPRAR FRESCOS TODOS OS DIAS', ' ', prefix, flags=re.I)
                prefix = re.sub(r'^\s*[-–\d.\s]+', '', prefix)
                description = re.sub(r'\s+', ' ', prefix).strip(' ;:-')
                description = re.sub(r'^(?:kg|unidade|embalagem)\s+', '', description, flags=re.I)
                if not 4 <= len(description) <= 180 or not re.search(r'[a-zà-ÿ]', description, re.I):
                    continue
                # Conditions and page prose cannot safely be paired to a price.
                if re.search(r'\*|\b(?:pvpr|pvp|folheto|preços válidos|limitad[oa]|informamos|descobre mais|comprar bem|na compra|por cada|cada ovo|desconto|poupa|aldi\.pt)\b', description, re.I):
                    continue
                if not brand:
                    words = description.split()
                    uppercase = []
                    for word in words[:3]:
                        if word.isupper() and len(word) > 1:
                            uppercase.append(word)
                        else:
                            break
                    if uppercase and len(uppercase) < len(words):
                        brand = ' '.join(uppercase)
                        description = description[len(brand):].strip()
                unit_match = unit_pattern.search(description)
                unit = unit_match[1] if unit_match else ('kg' if re.search(r'\bkg\b', description) else None)
                name = description
                if unit_match:
                    name = description[:unit_match.start()].strip(' ;:-')
                name = re.sub(r'\s*\b(?:embalagem|unidade|embalado|kg)\s*$', '', name, flags=re.I).strip()
                # A price can also occur inside page prose or a broken pack
                # annotation. Neither is a product name, even with letters.
                if not name or len(name) < 4 or not name[0].isalpha() or '€' in name:
                    continue
                identity = '|'.join((self._slugify(brand), self._slugify(name), self._slugify(unit)))
                external_id = 'aldi-' + hashlib.sha256(identity.encode()).hexdigest()[:24]
                reference_price = None
                if index + 1 < len(matches):
                    following = matches[index + 1]
                    between = text[match.end():following.start()].strip()
                    if not between or between.upper() == 'PVPR':
                        old_price = float(f'{following[1]}.{following[2]}')
                        if old_price > price:
                            reference_price = old_price
                metadata = {
                    'coverage': 'promotions', 'availability_scope': 'advertised_in_store',
                    'store_stock_confirmed': False, 'extraction_method': 'leaflet_text',
                    'extraction_confidence': 'low', 'leaflet_page': page_index,
                    **leaflet_validity, **self._validity(raw),
                }
                # Only an explicit unit-price parenthesis belonging to this
                # candidate is safe; never borrow a value from a previous item.
                unit_price, price_unit = None, None
                unit_source = re.sub(r'\s+', ' ', raw_prefix)
                name_position = unit_source.casefold().rfind(name.casefold())
                # Some leaflets print a previous product's unit price after its
                # selling price. Only read parentheses after this item's name.
                unit_source = unit_source[name_position + len(name):] if name_position >= 0 else ''
                unit_prices = re.findall(r'\(([^)]*\b(?:kg|l|un)\s*=[^)]*)\)', unit_source, re.I)
                if unit_prices and not re.search(r'\d\s*[-/]\s*\d', unit_prices[-1]):
                    unit_price, price_unit = self._parse_unit_price(unit_prices[-1])
                product = self._enrich_product({
                    'category_id': None, 'category_name': category.get('name'),
                    'external_id': external_id, 'name': name, 'brand': brand,
                    'description': description, 'price': price, 'price_currency': 'EUR',
                    'regular_price': reference_price, 'unit': unit, 'url': leaflet_url,
                    'image_url': None, 'in_stock': True, 'deleted': False,
                    'unit_price': unit_price, 'unit_price_unit': price_unit,
                }, metadata=metadata)
                # Repeated cover offers should not duplicate the same product.
                products.setdefault(external_id, product)
        return list(products.values())
