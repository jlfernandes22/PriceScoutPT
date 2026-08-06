from abc import ABC, abstractmethod
import re
import time
from urllib.parse import urljoin

import requests

class ScraperBase(ABC):
    def __init__(self, db_manager):
        self.db_manager = db_manager
        # Erros de rede/extração acumulados durante a run. Se algum ocorrer, a
        # run é considerada INCOMPLETA e o main.py NÃO marca produtos como
        # esgotados (evita apagar catálogo numa recolha parcial por falha duma categoria).
        self.scrape_errors = []
        self.session = requests.Session()
        self.user_agent = (
            'Mozilla/5.0 (X11; Linux x86_64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/126.0.0.0 Safari/537.36'
        )
        self.session.headers.update({'User-Agent': self.user_agent})

    def get_with_retry(self, url, params=None, timeout=30, attempts=3, backoff=2.0):
        """GET com re-tentativas e backoff exponencial.

        As recolhas diárias correm de madrugada em IPs de datacenter; redes e
        sites de supermercados falham esporadicamente. Em vez de perder a
        página e degradar a categoria, tenta novamente até `attempts` vezes.
        Devolve a resposta ou lança a última exceção após esgotar as tentativas.
        """
        last_exc = None
        for attempt in range(attempts):
            try:
                resp = self.session.get(url, params=params, timeout=timeout)
                resp.raise_for_status()
                return resp
            except Exception as e:  # noqa: BLE001
                last_exc = e
                if attempt < attempts - 1:
                    time.sleep(backoff * (attempt + 1))
        raise last_exc

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
        deduped = {}
        categories = {}
        for product in products:
            external_id = product.get('external_id')
            if not external_id:
                continue
            if external_id not in deduped:
                deduped[external_id] = product
            category_name = product.get('category_name')
            if category_name:
                categories[category_name] = product

        unique_products = list(deduped.values())

        # 1. Resolução das categorias de origem para a taxonomia canónica.
        #    Cada nome mapeia sempre para uma categoria canónica (nunca cria novas).
        category_mapping = self.db_manager.resolve_category_ids(
            self.supermarket_id, list(categories.keys())
        )
        for product in unique_products:
            product['category_id'] = category_mapping.get(product.get('category_name'))

        # 2. Bulk upsert de produtos
        self.db_manager.bulk_upsert_products(self.supermarket_id, unique_products)

    def mark_missing(self, scraped_external_ids):
        """Marca como esgotados/deleted os produtos que deixaram de existir."""
        self.db_manager.mark_missing_products(self.supermarket_id, scraped_external_ids)

    @staticmethod
    def _slugify(text):
        import re
        import unicodedata
        text = (text or '').lower()
        text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8')
        text = re.sub(r'[^a-z0-9\s-]', '', text)
        text = re.sub(r'[\s]+', '-', text)
        return text.strip('-')

    # --- Helpers de extração partilhados por todos os scrapers (DOM) ---

    def _text(self, element):
        return element.get_text(strip=True) if element else None

    def _parse_price(self, price_text):
        """Extrai o primeiro valor numérico de um texto de preço ("2,99 €" -> 2.99)."""
        if not price_text:
            return 0.0
        normalized = price_text.replace('€', '').replace(',', '.').strip()
        match = re.search(r'\d+[\.,]?\d*', normalized)
        return float(match.group(0).replace(',', '.')) if match else 0.0

    def _extract_url(self, card):
        """Primeiro link do card, resolvido contra o base_url do supermercado."""
        link = card.find('a', href=True)
        if link:
            href = link['href']
            if href.startswith('/'):
                return urljoin(self.base_url, href)
            return href
        return None

    def close(self) -> None:
        pass
