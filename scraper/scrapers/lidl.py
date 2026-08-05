import time
from urllib.parse import urljoin
from scraper_base import ScraperBase


class LidlScraper(ScraperBase):
    """Lidl PT via o endpoint JSON /q/api/search.

    O website carrega os produtos através de uma API interna que devolve
    JSON estruturado com título, preço, imagem e categoria — muito mais
    rápido e fiável do que navegar o DOM com um browser.
    """
    supermarket_id = '00000000-0000-0000-0000-000000000002'
    base_url = 'https://www.lidl.pt'
    api_url = 'https://www.lidl.pt/q/api/search'
    page_size = 100

    def __init__(self, db_manager) -> None:
        super().__init__(db_manager)
        self.session.headers.update({
            'Accept': '*/*',
            'Accept-Language': 'pt-PT,pt;q=0.9',
            'Referer': self.base_url,
        })

    def discover_categories(self) -> list[dict]:
        # IDs estáveis das categorias top-level que expõem grelha de produtos
        return [
            {'name': 'Mercearia e Frescos', 'path': '/c/mercearia-e-frescos/s10068374', 'api_id': '10068374'},
            {'name': 'Cozinha e Cuidado do Lar', 'path': '/c/cozinha-e-cuidado-do-lar/s10068166', 'api_id': '10068166'},
            {'name': 'Ferramentas e Jardim', 'path': '/c/ferramentas-e-jardim/s10068222', 'api_id': '10068222'},
            {'name': 'Desporto e Tempos Livres', 'path': '/c/desporto-e-tempos-livres/s10068226', 'api_id': '10068226'},
            {'name': 'Casa e Decoração', 'path': '/c/casa-e-decoracao/s10068371', 'api_id': '10068371'},
            {'name': 'Moda e Acessórios', 'path': '/c/moda-e-acessorios/s10068373', 'api_id': '10068373'},
            {'name': 'Bebé, Criança e Brinquedos', 'path': '/c/bebe-crianca-e-brinquedos/s10068225', 'api_id': '10068225'},
        ]

    def scrape_category(self, category: dict) -> list[dict]:
        api_id = category.get('api_id')
        if not api_id:
            # Fallback: extrair o ID numérico do caminho (s10068374 -> 10068374)
            api_id = re_find_id(category.get('path', ''))
        if not api_id:
            print(f"  Pular {category['name']} (Sem api_id)")
            return []

        print(f"  A extrair via API JSON: {category['name']} (id: {api_id})")

        products = []
        seen_ids = set()
        offset = 0

        while True:
            params = {
                'offset': offset,
                'fetchsize': self.page_size,
                'locale': 'pt_PT',
                'assortment': 'PT',
                'version': '2.1.0',
                'category.id': api_id,
            }
            try:
                response = self.get_with_retry(self.api_url, params=params, timeout=30)
                data = response.json()
            except Exception as e:
                err = f"Lidl ({category['name']}, offset {offset}): {e}"
                print(f"    Erro de rede na página (offset {offset}): {e}")
                self.scrape_errors.append(err)
                break

            items = data.get('items') or []
            num_found = data.get('numFound', 0)

            new_products = 0
            for item in items:
                if item.get('resultClass') != 'product' and item.get('type') != 'product':
                    continue
                gridbox = item.get('gridbox', {}) or {}
                gdata = gridbox.get('data', {}) or {}

                external_id = str(gdata.get('itemId') or gdata.get('erpNumber') or '').strip()
                if not external_id or external_id in seen_ids:
                    continue
                seen_ids.add(external_id)

                name = gdata.get('title') or gdata.get('fullTitle') or ''
                image_url = gdata.get('image')
                if image_url and image_url.endswith('.svg'):
                    image_url = None

                # Preço: a informação vive em lidlPlus[0].price
                price = 0.0
                unit = None
                lidl_plus = gdata.get('lidlPlus') or []
                if lidl_plus:
                    price_info = lidl_plus[0].get('price') or {}
                    try:
                        price = float(price_info.get('price', 0.0) or 0.0)
                    except (TypeError, ValueError):
                        price = 0.0
                    packaging = price_info.get('packaging') or {}
                    unit = packaging.get('text')

                keyfacts = gdata.get('keyfacts') or {}
                won_category = keyfacts.get('wonCategoryPrimary') or ''

                products.append({
                    'category_id': None,
                    'category_name': category.get('name'),
                    'external_id': external_id,
                    'name': name or None,
                    'brand': None,
                    'description': won_category or None,
                    'price': price,
                    'price_currency': 'EUR',
                    'unit': unit,
                    'url': urljoin(self.base_url, gdata.get('canonicalUrl', '')),
                    'image_url': image_url,
                    'in_stock': True,
                    'deleted': False,
                    'last_scraped_at': None,
                })
                new_products += 1

            print(f"    Offset {offset}: {len(items)} recebidos ({new_products} novos).")

            if new_products == 0:
                print("    Nenhum produto novo extraído. A interromper.")
                break

            offset += self.page_size
            if offset >= num_found:
                print(f"    Paginação concluída ({num_found} produtos no total).")
                break

            time.sleep(0.3)  # Pausa ligeira para proteger a API

        print(f"    ✓ Total {len(products)} produtos coletados em {category['name']}")
        return products

    def close(self) -> None:
        pass


def re_find_id(path: str) -> str:
    import re
    match = re.search(r's(\d+)', path or '')
    return match.group(1) if match else None
