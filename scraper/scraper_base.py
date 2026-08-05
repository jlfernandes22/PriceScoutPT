from abc import ABC, abstractmethod
import requests

class ScraperBase(ABC):
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.session = requests.Session()
        self.user_agent = (
            'Mozilla/5.0 (X11; Linux x86_64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/126.0.0.0 Safari/537.36'
        )
        self.session.headers.update({'User-Agent': self.user_agent})

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

    def close(self) -> None:
        pass
