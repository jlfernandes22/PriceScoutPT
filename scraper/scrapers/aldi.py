import re
import json
from bs4 import BeautifulSoup
from scraper_base import ScraperBase

class AldiScraper(ScraperBase):
    supermarket_id = '00000000-0000-0000-0000-000000000004'
    base_url = 'https://www.aldi.pt'

    def __init__(self, db_manager):
        super().__init__(db_manager)
        self.session.headers.update({
            'Accept-Language': 'pt-PT,pt;q=0.9',
        })

    def discover_categories(self):
        # O Aldi funciona exclusivamente com folhetos semanais de oportunidades.
        return [
            {
                'name': 'Oportunidades da Semana',
                'path': '/folheto/esta-semana.html'
            }
        ]

    def scrape_category(self, category):
        print(f"  A obter folheto do Aldi: {category['name']}")
        
        # 1. Obter a URL do folheto interativo de forma dinâmica
        target_path = category['path']
        full_url = f"{self.base_url}{target_path}"
        
        try:
            r = self.get_with_retry(full_url, timeout=30)
        except Exception as e:
            err = f"Aldi (folheto estático): {e}"
            print(f"    [Fallback] Erro na URL estática do folheto: {e}. A tentar descobrir pelo index principal...")
            self.scrape_errors.append(err)
            try:
                # Fallback: tentar descobrir a URL do folheto no index principal
                r_index = self.session.get(self.base_url, timeout=30)
                soup_index = BeautifulSoup(r_index.text, 'html.parser')
                script_next = soup_index.find('script', id='__NEXT_DATA__')
                if script_next:
                    data_next = json.loads(script_next.string)
                    # Procurar por links de folheto
                    links = []
                    def find_links_in_dict(d):
                        if isinstance(d, dict):
                            for k, v in d.items():
                                if k in ['link', 'url', 'reference', 'href', 'path'] and isinstance(v, str):
                                    if 'folheto' in v.lower() and 'esta-semana' in v.lower():
                                        links.append(v)
                                else:
                                    find_links_in_dict(v)
                        elif isinstance(d, list):
                            for item in d:
                                find_links_in_dict(item)
                    find_links_in_dict(data_next)
                    if links:
                        full_url = links[0] if links[0].startswith('http') else f"{self.base_url}{links[0]}"
                        print(f"    [Fallback] Encontrada URL dinâmica: {full_url}")
                        r = self.session.get(full_url, timeout=30)
            except Exception as e_fallback:
                err = f"Aldi (folheto dinâmico): {e_fallback}"
                print(f"    [Fallback] Falha ao descobrir folheto dinamicamente: {e_fallback}")
                self.scrape_errors.append(err)
                return []

        # 2. Extrair Next.js props de __NEXT_DATA__ para obter a URL iPaper
        try:
            soup = BeautifulSoup(r.text, 'html.parser')
            script = soup.find('script', id='__NEXT_DATA__')
            if not script:
                raise Exception("Script __NEXT_DATA__ não encontrado na página principal do folheto.")
            
            next_data = json.loads(script.string)
            leaflet_url = next_data.get("props", {}).get("pageProps", {}).get("page", {}).get("link")
            if not leaflet_url:
                raise Exception("Propriedade link do folheto não encontrada no __NEXT_DATA__.")
            
            print(f"    URL do Visualizador iPaper: {leaflet_url}")
        except Exception as e:
            err = f"Aldi (parse __NEXT_DATA__): {e}"
            print(f"    Erro ao analisar __NEXT_DATA__: {e}")
            self.scrape_errors.append(err)
            return []

        # 3. Obter a página do visualizador iPaper e ler o window.staticSettings
        try:
            r_viewer = self.get_with_retry(leaflet_url, timeout=30)
            if r_viewer.status_code != 200:
                raise Exception(f"Falha ao aceder ao visualizador iPaper (Status: {r_viewer.status_code})")
            
            match = re.search(r'window\.staticSettings\s*=\s*(\{.*?\});', r_viewer.text)
            if not match:
                raise Exception("window.staticSettings não encontrado no HTML do visualizador.")
            
            settings = json.loads(match.group(1))
            page_texts = settings.get("pageTexts", [])
            if not page_texts:
                raise Exception("pageTexts vazios ou não encontrados nas definições do iPaper.")
            
            print(f"    Folheto carregado: {len(page_texts)} páginas encontradas.")
        except Exception as e:
            err = f"Aldi (dados iPaper): {e}"
            print(f"    Erro ao extrair dados do iPaper: {e}")
            self.scrape_errors.append(err)
            return []

        # 4. Processar o texto de cada página e extrair os produtos de forma resiliente
        products = []
        
        def clean_text_field(text):
            # Remove leading symbols/markers
            text = re.sub(r'^\d+\s*C\s*°\s*', '', text)
            text = re.sub(r'^C\s*°\s*', '', text)
            text = re.sub(r'^\d+\s+', '', text)
            text = re.sub(r'^[^\w\s]+', '', text)
            return text.strip()

        # Textos genéricos / ruído de folheto que nunca são produtos
        NOISE_PATTERNS = [
            r'\bseg\b', r'\bdom\b', r'\besta semana\b', r'\bcomprar bem\b',
            r'\bpoupa\b', r'\bcusta pouco\b', r'\bpreços válidos\b',
            r'\bválido\b', r'\bvalidade\b', r'\bmais produtos\b',
            r'\boferta limitada\b', r'\bpor tempo limitado\b', r'\bno folheto\b',
            r'\bfolheto\b', r'\bveja o folheto\b', r'\bdepósito\b',
            r'\bacresce valor de depósito\b', r'\bembalagem\b', r'\bpreço por\b',
            r'\bpvp unitário\b', r'\bna compra de\b', r'\bpor cada\b',
            r'\bpara comprar\b', r'\bunidades do mesmo\b', r'\bdo mesmo sabor\b',
            r'\boferta de lançamento\b', r'\btroféu de confiança\b',
            r'\bqualidade ao melhor preço\b', r'\bpreço de lançamento\b',
            r'\bsubstituição\b', r'\bdireito de reversão\b', r'\bdevolução\b',
            r'\bcada cápsula\b', r'\bpor cápsula\b', r'\bcada unidade\b',
            r'\bpreço da unidade\b', r'\bunidade\b', r'\bpreço por unidade\b',
            r'\bkg\b$', r'\bl\b$', r'\bx semana\b', r'\bsemana exterior\b',
            r'\bsemana interior\b', r'\bsemissombra\b',
        ]
        NOISE_EXACT = {
            'seg', 'dom', 'sex', 'sáb', 'ter', 'qua', 'qui',
            'esta semana', 'comprar bem', 'poupa', 'custa pouco',
            'acresce valor de depósito', 'por tempo limitado', 'veja o folheto',
        }

        def is_noise(text):
            lowered = text.lower()
            if lowered.strip() in NOISE_EXACT:
                return True
            # Datas isoladas ou "Seg. 3.8." style headers já removidas pelo regex de datas
            for pat in NOISE_PATTERNS:
                if re.search(pat, lowered):
                    return True
            # Texto sem qualquer letra (só números/símbolos)
            if not re.search(r'[a-záàâãéêíóôõúç]+', lowered):
                return True
            return False

        def extract_brand_and_name(desc):
            brand = None
            name = desc
            
            if '®' in desc:
                parts = desc.split('®', 1)
                brand = parts[0].strip()
                name = parts[1].strip()
            else:
                words = desc.split()
                upper_words = []
                for w in words[:3]:
                    w_clean = re.sub(r'[^\w]', '', w)
                    if w_clean.isupper() and len(w_clean) >= 2:
                        upper_words.append(w)
                    else:
                        break
                if upper_words:
                    brand = " ".join(upper_words)
                    name = desc[len(brand):].strip()
            
            name = re.sub(r'^[\s,;\-\:]+', '', name).strip()
            return brand, name

        for page_num, raw_text in enumerate(page_texts):
            # Limpar padrões de datas (ex: 25.5.26 ou 25/5/26) para evitar falsos positivos de preços
            text = re.sub(r'\b\d{1,2}[\./\-]\d{1,2}[\./\-]\d{2,4}\b', ' ', raw_text)
            
            # Padrão de preço em folhetos iPaper (ex: "2. 39", "12. 99", "0. 89")
            price_pattern = r'\b(\d+)\s*\.\s*(\d{2})\b'
            price_matches = list(re.finditer(price_pattern, text))
            
            last_idx = 0
            for idx, pm in enumerate(price_matches):
                price_val = float(f"{pm.group(1)}.{pm.group(2)}")
                price_start, price_end = pm.span()
                
                pre_segment = text[last_idx:price_start].strip()
                
                # Ignorar unit prices / taxas de conversão intermédias (ex: "kg =", "l =", "kg  =")
                if re.search(r'\b(?:kg|l)\s*=\s*$', pre_segment.lower()) or pre_segment.endswith('%'):
                    last_idx = price_end
                    continue
                
                # Extrair âncoras de promoção (se existirem no segmento)
                promo_pattern = r'\b(APROVEITA|MELHOR PREÇO|EXPERIMENTA|APENAS|-\d+%)\b'
                promo_match = re.search(promo_pattern, pre_segment)
                promo_label = promo_match.group(1) if promo_match else None
                
                clean_desc = pre_segment
                if promo_label:
                    clean_desc = clean_desc.replace(promo_label, '').strip()
                
                clean_desc = clean_text_field(clean_desc)
                # Remover numeração de página no fim do segmento
                clean_desc = re.sub(r'\s+\d+$', '', clean_desc)

                # Filtros de validação estritos para evitar ruído / textos genéricos
                if len(clean_desc) < 10:
                    last_idx = price_end
                    continue
                if any(w in clean_desc.lower() for w in ['pvpr', '1.ª un', '2.ª un', 'un. =', 'unidade =', 'custa pouco', 'compra ao', 'desconto', 'poupa', 'esta semana', 'folheto', 'preços válidos', 'limitado ao', 'pv unitário', 'na compra de', 'do mesmo sabor', 'unidades do mesmo']):
                    last_idx = price_end
                    continue
                if is_noise(clean_desc):
                    last_idx = price_end
                    continue
                # Textos com asterisco (*PVP...) são notas de rodapé, não produtos
                if '*' in clean_desc or clean_desc.startswith('PVP'):
                    last_idx = price_end
                    continue
                
                brand, name = extract_brand_and_name(clean_desc)
                if not name:
                    last_idx = price_end
                    continue
                
                # Tentar inferir a unidade (peso/volume)
                unit = None
                unit_match = re.search(r'\b(\d+(?:[\.,]\d+)?\s*(?:g|ml|l|kg|unidades?))\b', name.lower())
                if unit_match:
                    unit = unit_match.group(1).strip()
                
                # Gerar external_id determinístico de forma a atualizar preços em futuras edições
                slug_brand = re.sub(r'[^a-z0-9]', '', (brand or 'generico').lower())
                slug_name = re.sub(r'[^a-z0-9]', '', name.lower())
                external_id = f"aldi-{slug_brand}-{slug_name}"[:100]
                
                products.append({
                    'category_id': None,
                    'category_name': category.get('name'),
                    'external_id': external_id,
                    'name': name,
                    'brand': brand,
                    'price': price_val,
                    'unit': unit,
                    'url': leaflet_url,
                    'in_stock': True,
                    'deleted': False
                })
                
                last_idx = price_end

        print(f"    Total de produtos extraídos do Aldi: {len(products)}")
        return products
