from abc import ABC, abstractmethod
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import html
import json
import math
import re
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup


class ScraperBase(ABC):
    # A public listing seldom proves that the entire supermarket assortment was
    # observed. Opt in only when discovery and pagination cover a full catalogue.
    allow_mark_missing = False
    source_type = 'online_catalog'
    max_pages = 400
    request_delay = 0.5

    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.scrape_errors = []
        self.detail_errors = []
        self.session = requests.Session()
        self.user_agent = (
            'Mozilla/5.0 (X11; Linux x86_64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/126.0.0.0 Safari/537.36'
        )
        self.session.headers.update({'User-Agent': self.user_agent})

    def get_with_retry(self, url, params=None, timeout=30, attempts=3, backoff=2.0, allow_redirects=True):
        """Retry transient connection/HTTP failures, respecting Retry-After.

        Authentication, access restrictions and invalid URLs are not transient:
        report those immediately instead of repeatedly hitting a blocked source.
        """
        if attempts < 1:
            raise ValueError('attempts must be at least one')
        for attempt in range(attempts):
            try:
                response = self.session.get(url, params=params, timeout=timeout, allow_redirects=allow_redirects)
                response.raise_for_status()
                return response
            except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as exc:
                response = getattr(exc, 'response', None)
                if isinstance(exc, requests.HTTPError) and response is not None:
                    if response.status_code not in (408, 425, 429, 500, 502, 503, 504):
                        raise
                if attempt == attempts - 1:
                    raise
                delay = backoff * (2 ** attempt)
                retry_after = response.headers.get('Retry-After') if response is not None else None
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        try:
                            retry_at = parsedate_to_datetime(retry_after)
                            delay = max(delay, (retry_at - datetime.now(timezone.utc)).total_seconds())
                        except (TypeError, ValueError, OverflowError):
                            pass
                time.sleep(min(max(delay, 0), 60))

    @property
    @abstractmethod
    def supermarket_id(self):
        raise NotImplementedError()

    @abstractmethod
    def scrape_category(self, category):
        raise NotImplementedError()

    @abstractmethod
    def discover_categories(self):
        raise NotImplementedError()

    def sync_to_db(self, products):
        # Cross-category duplicates may be observed minutes apart. Retain the
        # newest price/provenance together and fill missing descriptive fields.
        deduped = {}
        for product in products:
            external_id = str(product.get('external_id') or '').strip()
            if not external_id or not product.get('name'):
                continue
            product = {**product, 'external_id': external_id}
            previous = deduped.get(external_id)
            if previous is None:
                deduped[external_id] = product
                continue
            def observed_key(item):
                value = item.get('observed_at') or item.get('last_scraped_at')
                normalised = self._normalise_validity(value)
                stamp = datetime.fromisoformat(normalised).timestamp() if normalised else float('-inf')
                # Older cards without an observation date remain supported; at
                # identical times a published price beats an unpriced tile.
                return stamp, bool(item.get('price'))
            preferred, fallback = (product, previous) if observed_key(product) > observed_key(previous) else (previous, product)
            merged = dict(preferred)
            for key in ('name', 'brand', 'description', 'unit', 'image_url', 'barcode', 'url', 'category_name', 'category_id'):
                if merged.get(key) in (None, '') and fallback.get(key) not in (None, ''):
                    merged[key] = fallback[key]
            metadata = dict(merged.get('metadata') or {})
            for key in ('ingredients', 'ingredient', 'nutrition', 'nutritionInformation', 'allergen', 'allergens', 'countryOfOrigin', 'image_urls', 'additional_properties'):
                if metadata.get(key) in (None, '', []) and (fallback.get('metadata') or {}).get(key) not in (None, '', []):
                    metadata[key] = fallback['metadata'][key]
            if metadata:
                merged['metadata'] = metadata
            deduped[external_id] = merged

        unique_products = list(deduped.values())
        names = {p.get('category_name') for p in unique_products if p.get('category_name')}
        category_mapping = self.db_manager.resolve_category_ids(self.supermarket_id, list(names))
        for product in unique_products:
            product['category_id'] = category_mapping.get(product.get('category_name'))
        written = self.db_manager.bulk_upsert_products(self.supermarket_id, unique_products)
        return written if written is not None else len(unique_products)

    def mark_missing(self, scraped_external_ids):
        self.db_manager.mark_missing_products(self.supermarket_id, scraped_external_ids, source_type=self.source_type)

    @staticmethod
    def _slugify(text):
        import unicodedata
        text = unicodedata.normalize('NFKD', (text or '').lower()).encode('ascii', 'ignore').decode('utf-8')
        return re.sub(r'[\s]+', '-', re.sub(r'[^a-z0-9\s-]', '', text)).strip('-')

    @staticmethod
    def _text(element):
        return ' '.join(element.stripped_strings) if element else None

    @staticmethod
    def _parse_price(value):
        """Parse Portuguese and JSON prices, including 1.234,56 and split cents."""
        if value is None or isinstance(value, bool):
            return 0.0
        if isinstance(value, (int, float)):
            return float(value) if math.isfinite(value) and value >= 0 else 0.0
        text = html.unescape(str(value)).replace('\u00a0', ' ').replace('\u202f', ' ')
        text = re.sub(r'(?<=\d)\s+(?=[,.]\s*\d)', '', text)
        text = re.sub(r'([,.])\s+(?=\d)', r'\1', text)
        match = re.search(r'-?\d+(?:[ .]\d{3})*(?:[,.]\d+)?', text)
        if not match:
            return 0.0
        number = match.group().replace(' ', '')
        if ',' in number:
            number = number.replace('.', '').replace(',', '.')
        elif number.count('.') > 1:
            number = number.replace('.', '')
        try:
            parsed = float(number)
            return parsed if math.isfinite(parsed) and parsed >= 0 else 0.0
        except ValueError:
            return 0.0

    @staticmethod
    def _json(value):
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(html.unescape(value or ''))
        except (ValueError, TypeError):
            return None

    def _absolute_url(self, value):
        if not isinstance(value, str) or not value.strip():
            return None
        absolute = urljoin(self.base_url, html.unescape(value.strip()))
        return absolute if urlsplit(absolute).scheme in ('http', 'https') else None

    def _extract_url(self, card):
        urls = self._json(card.get('data-urls')) or {}
        if isinstance(urls, dict):
            for field in ('absoluteProductUrl', 'productUrl'):
                if urls.get(field):
                    return self._absolute_url(urls[field])
        links = card.select('a.product-name-link[href], .pdp-link a[href], a.product-tile-image-link[href], a[href]')
        for link in links:
            href = link.get('href', '')
            if not href.startswith(('#', 'javascript:', 'mailto:')):
                absolute = self._absolute_url(href)
                if absolute:
                    return absolute
        return None

    def _extract_image(self, card):
        images = card.select('img.ct-tile-image, .product-tile-image img, picture img, img')
        for image in images:
            for field in ('data-src', 'data-original', 'src', 'data-srcset', 'srcset'):
                candidate = (image.get(field) or '').strip()
                if field.endswith('srcset'):
                    candidate = candidate.split(',')[0].strip().split(' ')[0]
                if not candidate or any(s in candidate.lower() for s in ('badges', 'wishlist', 'placeholder', '.svg', 'data:')):
                    continue
                url = self._absolute_url(candidate)
                if url:
                    return url
        return None

    def _price_from_element(self, element):
        if element is None:
            return 0.0
        return self._parse_price(element.get('content') or element.get('data-price') or self._text(element))

    def _parse_unit_price(self, text):
        """Return a comparable price per kg, l or unit from published unit text."""
        if not text:
            return None, None
        text = html.unescape(str(text)).lower()
        number = r'\d+(?:[.,]\s*\d+)?'
        # Both conventions are used: "2,99 €/kg" and "1 kg = 2,99".
        match = re.search(rf'({number})\s*€?\s*/\s*(?:(\d+(?:[.,]\d+)?)\s*)?(kg|gr|g|ml|cl|l|unidades?|un\.?)\b', text)
        if match:
            price, quantity, unit = self._parse_price(match[1]), self._parse_price(match[2]) if match[2] else 1, match[3]
        else:
            match = re.search(rf'(?:(\d+(?:[.,]\d+)?)\s*)?(kg|gr|g|ml|cl|l|unidades?|un\.?)\s*=\s*({number})', text)
            if not match:
                return None, None
            quantity, unit, price = self._parse_price(match[1]) if match[1] else 1, match[2], self._parse_price(match[3])
        factors = {'g': ('kg', .001), 'gr': ('kg', .001), 'kg': ('kg', 1), 'ml': ('l', .001), 'cl': ('l', .01), 'l': ('l', 1)}
        unit, factor = factors.get(unit, ('un', 1))
        return (round(price / (quantity * factor), 6), unit) if price > 0 and quantity > 0 else (None, None)

    def _extract_barcode(self, card):
        for attr in ('data-ean', 'data-gtin', 'data-barcode'):
            if card.get(attr):
                return str(card[attr]).strip()
        element = card.select_one('[itemprop^="gtin"]')
        return (element.get('content') or self._text(element)) if element else None

    @staticmethod
    def _normalise_validity(value, end_of_day=False):
        """Normalise source dates/epochs to timezone-aware ISO timestamps."""
        if value in (None, '') or isinstance(value, bool):
            return None
        from zoneinfo import ZoneInfo
        try:
            if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
                epoch = float(value)
                if epoch > 100_000_000_000:  # APIs can publish milliseconds.
                    epoch /= 1000
                return datetime.fromtimestamp(epoch, timezone.utc).isoformat()
            raw = str(value).strip()
            parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            if len(raw) == 10 and end_of_day:
                parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=ZoneInfo('Europe/Lisbon'))
            return parsed.astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, OSError, OverflowError):
            return None

    def _enrich_product(self, product, card=None, unit_price_text=None, metadata=None):
        product['source_type'] = self.source_type
        product['source_url'] = product.get('url') or self.base_url
        product['observed_at'] = datetime.now(timezone.utc).isoformat()
        product['metadata'] = {**(metadata or {}), **(product.get('metadata') or {})}
        for key in ('valid_from', 'valid_to'):
            if key in product['metadata']:
                product['metadata'][key] = self._normalise_validity(product['metadata'][key], end_of_day=key == 'valid_to')
        product['metadata'].setdefault('coverage', 'public_catalogue_subset')
        product['metadata'].setdefault('availability_scope', 'online_listing')
        if card is not None:
            product['barcode'] = product.get('barcode') or self._extract_barcode(card)
            regular = card.select_one('.list .value, .list, .price-standard, .pwc-tile--price-dashed, .pwc-tile--price-previous, .pwc-tile--price-recommended, .auc-price__strikethrough, del, s')
            regular_price = self._price_from_element(regular)
            if regular_price > product.get('price', 0):
                product['regular_price'] = regular_price
                reference_label = card.select_one('.pvpr-info')
                if reference_label:
                    product['metadata']['reference_price_label'] = self._text(reference_label)
            unavailable = {'auc-product-unavailable', 'product-unavailable', 'out-of-stock', 'unavailable'}
            if unavailable.intersection(card.get('class') or []) or card.get('data-available') == 'false' or card.get('data-in-stock') == 'false':
                product['in_stock'] = False
        unit_price, unit = self._parse_unit_price(unit_price_text)
        if unit_price is not None:
            product['unit_price'] = unit_price
            product['unit_price_unit'] = unit
        if not product.get('price'):
            product['in_stock'] = False
        return product

    def _record_error(self, category, message):
        self.scrape_errors.append(f"{self.__class__.__name__} ({category.get('name', '?')}): {message}")

    def _scrape_sfcc_category(self, category, card_selector):
        """SFCC pagination shared by the three public online catalogues.

        Step by the cards actually returned: servers can clamp a requested page
        size. Detect a repeated page, invalid payload and truncation as partial
        failures so callers never mistake them for a completed catalogue.
        """
        cgid = category.get('cgid') or category.get('path', '').strip('/')
        if not cgid:
            self._record_error(category, 'missing category identifier')
            return []
        products, seen_ids = [], set()
        start = 0
        for page in range(1, self.max_pages + 1):
            try:
                response = self.get_with_retry(self.ajax_url, params={'cgid': cgid, 'start': start, 'sz': self.page_size}, timeout=30)
                soup = BeautifulSoup(response.text, 'html.parser')
                cards = soup.select(card_selector)
                page_products = self._extract_products(response.text, category)
            except Exception as exc:
                self._record_error(category, f'page {page}: {exc}')
                break
            footer = soup.select_one('[data-total-count]')
            try:
                total = int(footer['data-total-count']) if footer else None
            except (ValueError, TypeError):
                total = None
            if not cards:
                empty_grid = soup.select_one('.grid-footer, .auc-product, .search-no-results, .no-results')
                if not products or (total is not None and start < total) or (response.text.strip() and not empty_grid):
                    self._record_error(category, f'page {page}: empty or unrecognised product listing')
                break
            page_ids = {p['external_id'] for p in page_products}
            # Nested layouts must not count the wrapper and its tile twice.
            raw_ids = {str(c.get('data-pid') or c.get('data-product-id') or c.get('data-article-code') or '') for c in cards}
            raw_ids.discard('')
            expected = len(raw_ids) or len(cards)
            if len(page_ids) < expected:
                self._record_error(category, f'page {page}: could parse {len(page_ids)} of {expected} product cards')
            new_products = list({p['external_id']: p for p in page_products if p['external_id'] not in seen_ids}.values())
            if not new_products:
                self._record_error(category, f'page {page}: repeated or unparseable product page at offset {start}')
                break
            products.extend(new_products)
            seen_ids.update(p['external_id'] for p in new_products)
            # Progress uses distinct source cards, including unavailable products.
            start += expected
            print(f"    {category.get('name')}, page {page}: {len(new_products)} new products (offset {start}).")
            if total is not None and start >= total:
                break
            if page == self.max_pages:
                self._record_error(category, f'page limit {self.max_pages} reached before completion')
                break
            time.sleep(self.request_delay)
        return products

    def _public_detail_url(self, value):
        """Only the retailer's public product host is eligible for detail reads."""
        if not isinstance(value, str):
            return None
        try:
            parsed = urlsplit(value)
            base_host = urlsplit(self.base_url).hostname.lower().removeprefix('www.')
            host = (parsed.hostname or '').lower().removeprefix('www.')
            if (parsed.scheme not in ('http', 'https') or host != base_host
                    or parsed.username or parsed.password or parsed.port not in (None, 80, 443)):
                return None
            return urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path or '/', parsed.query, ''))
        except (ValueError, AttributeError):
            return None

    def _fetch_public_detail(self, url):
        # Handle redirects explicitly so an unexpected Location is never fetched.
        for _ in range(4):
            response = self.get_with_retry(url, timeout=30, allow_redirects=False)
            status = getattr(response, 'status_code', 200)
            if status in (301, 302, 303, 307, 308):
                target = self._public_detail_url(urljoin(url, response.headers.get('Location', '')))
                if not target or target == url:
                    raise ValueError('product detail redirect left the public retailer host')
                url = target
                time.sleep(self.request_delay)
                continue
            if status != 200:
                raise ValueError(f'product detail returned HTTP {status}')
            return response.text, url
        raise ValueError('too many product detail redirects')

    @staticmethod
    def _structured_text(value):
        if isinstance(value, dict):
            value = value.get('@value') or value.get('name') or value.get('value')
        if not isinstance(value, str):
            return None
        text = BeautifulSoup(html.unescape(value), 'html.parser').get_text(' ', strip=True)
        return re.sub(r'\s+([.,;:!?])', r'\1', text) or None

    def _extract_product_details(self, html_text, product, page_url):
        """Read published Product JSON-LD. Offers deliberately never affect price."""
        soup = BeautifulSoup(html_text, 'html.parser')
        nodes = []
        for script in soup.select('script[type="application/ld+json"]'):
            data = self._json(script.string or script.get_text())
            stack = [data]
            while stack:
                node = stack.pop()
                if isinstance(node, dict):
                    nodes.append(node)
                    stack.extend(value for value in node.values() if isinstance(value, (dict, list)))
                elif isinstance(node, list):
                    stack.extend(node)
        by_id = {}
        for node in nodes:
            if isinstance(node.get('@id'), str) and len(node) > len(by_id.get(node['@id'], {})):
                by_id[node['@id']] = node
        candidates = []
        expected_id = str(product.get('external_id') or '')
        expected_barcode = str(product.get('barcode') or '')
        expected_name = self._slugify(product.get('name'))
        for node in nodes:
            types = node.get('@type', [])
            if isinstance(types, str):
                types = [types]
            if not isinstance(types, list):
                continue
            if not any(str(t).rstrip('/').rsplit('/', 1)[-1] in ('Product', 'IndividualProduct', 'ProductGroup') for t in types):
                continue
            score = 0
            identifiers = [str(node.get(k) or '') for k in ('sku', 'productID', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14')]
            if expected_id and expected_id in identifiers:
                score += 10
            if expected_barcode and expected_barcode in identifiers:
                score += 10
            candidate_url = node.get('url') or (node.get('@id') if '#' not in str(node.get('@id') or '') else None)
            if isinstance(candidate_url, dict):
                candidate_url = candidate_url.get('@id')
            if isinstance(candidate_url, str):
                canonical = self._public_detail_url(urljoin(page_url, candidate_url))
                if canonical and canonical.split('?', 1)[0] == page_url.split('?', 1)[0]:
                    score += 8
            name = self._slugify(self._structured_text(node.get('name')))
            if name and expected_name:
                if name == expected_name:
                    score += 5
                elif name in expected_name or expected_name in name:
                    score += 3
                else:
                    source_words, expected_words = set(name.split('-')), set(expected_name.split('-'))
                    if len(source_words & expected_words) / max(len(source_words | expected_words), 1) >= .6:
                        score += 2
            if score:
                candidates.append((score, node))
        if not candidates:
            return {}
        highest_score = max(score for score, _ in candidates)
        best = [node for score, node in candidates if score == highest_score]
        if len(best) > 1:
            identities = {tuple(str(candidate.get(key) or '') for key in
                          ('sku', 'productID', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'name'))
                          for candidate in best}
            if len(identities) > 1:
                return {}  # Shared URLs can describe several different variants.
        node = best[0]
        details = {}
        for field in ('name', 'description'):
            value = self._structured_text(node.get(field))
            if value:
                details[field] = value
        brand = node.get('brand') or node.get('manufacturer')
        if isinstance(brand, list):
            brand = brand[0] if brand else None
        if isinstance(brand, dict) and brand.get('@id') in by_id:
            brand = by_id[brand['@id']]
        brand = self._structured_text(brand)
        if brand:
            details['brand'] = brand
        for key in ('gtin14', 'gtin13', 'gtin12', 'gtin8', 'gtin'):
            barcode = str(node.get(key) or '').strip()
            if re.fullmatch(r'(?:\d{8}|\d{12,14})', barcode):
                details['barcode'] = barcode
                break
        images = node.get('image') or []
        if not isinstance(images, list):
            images = [images]
        urls = []
        for item in images:
            if isinstance(item, dict) and item.get('@id') in by_id:
                item = by_id[item['@id']]
            value = item.get('contentUrl') or item.get('url') if isinstance(item, dict) else item
            if isinstance(value, str):
                value = self._absolute_url(urljoin(page_url, value))
                if value and value not in urls:
                    urls.append(value)
        metadata = {'detail_source_url': page_url, 'detail_extraction_method': 'product_jsonld'}
        if urls:
            details['image_url'] = urls[0]
            metadata['image_urls'] = urls
        for field in ('ingredients', 'ingredient', 'nutrition', 'nutritionInformation', 'allergen', 'allergens', 'countryOfOrigin'):
            if node.get(field) not in (None, '', []):
                metadata[field] = node[field]
        properties = node.get('additionalProperty') or []
        if not isinstance(properties, list):
            properties = [properties]
        published_properties = []
        for prop in properties:
            if not isinstance(prop, dict):
                continue
            label = self._structured_text(prop.get('name') or prop.get('propertyID'))
            value = prop.get('value')
            if label and value not in (None, ''):
                published_properties.append({'name': label, 'value': value, **({'unit': prop['unitText']} if prop.get('unitText') else {})})
                key = self._slugify(label)
                if key in ('ingredientes', 'ingredients'):
                    metadata.setdefault('ingredients', value)
                elif key in ('alergenios', 'alergenos', 'allergens'):
                    metadata.setdefault('allergens', value)
                elif key in ('informacao-nutricional', 'nutrition'):
                    metadata.setdefault('nutrition', value)
        if published_properties:
            metadata['additional_properties'] = published_properties
        details['metadata'] = metadata
        return details

    def enrich_product_details(self, products, limit=0):
        """Optionally enrich up to N unique product URLs, preserving listing prices.

        Duplicate category cards share a single read. Detail failures are reported
        separately and leave every valid listing observation available for sync.
        """
        if not isinstance(limit, int) or limit < 0:
            raise ValueError('detail limit must be a non-negative integer')
        self.detail_errors = []
        if not limit:
            return products
        cache = {}
        attempted = 0
        for product in products:
            if product.get('source_type', self.source_type) == 'leaflet':
                continue
            url = self._public_detail_url(product.get('url'))
            if not url:
                continue
            if url not in cache:
                if attempted >= limit:
                    continue
                if attempted:
                    time.sleep(self.request_delay)
                attempted += 1
                try:
                    body, final_url = self._fetch_public_detail(url)
                    cache[url] = self._extract_product_details(body, product, final_url)
                    cache.setdefault(final_url, cache[url])
                except Exception as exc:
                    self.detail_errors.append(f'{self.__class__.__name__} detail {product.get("external_id", "?")}: {exc}')
                    cache[url] = {}
            details = cache[url]
            for field in ('name', 'brand', 'description', 'barcode', 'image_url'):
                if not product.get(field) and details.get(field):
                    product[field] = details[field]
            if details.get('metadata'):
                product['metadata'] = {**(product.get('metadata') or {}), **details['metadata']}
        return products

    def close(self):
        self.session.close()
