# 🛒 PriceScoutPT

Comparador de preços de supermercados em **Portugal** (Continente, Lidl, Pingo Doce e Aldi) com catálogo **offline-first** no telemóvel e recolha de dados **sob demanda**.

Faz o teu cabaz, compara o preço em cada supermercado e descobre **onde fica mais barato** — mesmo sem internet.

---

## 🏗️ Arquitetura

```
┌─────────────────┐    scrape (sob demanda)    ┌──────────────────────┐
│  Sites públicos │ ◄───────────────────────── │  Scraper (Python)    │
│  dos supermerc. │                            │  scrapers/           │
└─────────────────┘                            └──────────┬───────────┘
                                                          │ bulk upsert
                                                          ▼
┌──────────────────┐    /api/sync (chunks)    ┌──────────────────────┐
│  App Mobile      │ ◄─────────────────────── │  API (Node/Express)  │
│  React Native    │                          │  api/                │
│  WatermelonDB    │                          └──────────┬───────────┘
│  (SQLite local)  │                                     │
└──────────────────┘                          ┌──────────▼───────────┐
                                              │ PostgreSQL 15        │
                                              │  database/init.sql   │
                                              └──────────────────────┘
```

| Componente | Tecnologia | Papel |
|---|---|---|
| **Scrapers** | Python + requests + BeautifulSoup | Extraem produtos (nome, preço, imagem, categoria, unidade) dos 4 supermercados |
| **API** | Node.js + Express | Sincronização incremental (chunks de 5.000), pesquisa/compare, categorias, disparo de recolha fresca |
| **Base de dados** | PostgreSQL 15 | Catálogo + histórico de preços (30 dias) + pesquisa full-text em português |
| **App mobile** | React Native (Expo) + WatermelonDB | Catálogo offline no SQLite, cabaz, favoritos, gráficos de preço, comparador de cabaz |

---

## 🔍 Como funciona cada scraper (análise dos sites)

Cada scraper foi analisado individualmente e usa a **fonte de dados mais fiável** de cada site:

### 🟥 Continente (Demandware/SFCC)
- **API interna**: `Search-UpdateGrid` (mesma chamada AJAX que o site usa) com paginação `start/sz`.
- **Fonte de dados**: atributo JSON `data-product-tile-impression` — contém `id`, `name`, `price`, `brand` e `category` limpos.
- **Imagem**: `img.ct-tile-image` (data-src), ignorando badges promocionais (`pvpr.png`).
- **Unidade**: `pwc-tile--quantity` (ex: `emb. 120 gr`).
- Raspar as 16 categorias principais em paralelo (ThreadPool, 5 workers).

### 🔵 Lidl (JSON API interna)
- **API interna**: `GET /q/api/search?category.id=XXX` — é o endpoint que o próprio site usa para a grelha de produtos. Devolve JSON puro (sem browser!).
- **Fonte de dados**: `gridbox.data` → `title`, `itemId`, `image`, `lidlPlus[0].price.price`, `packaging.text` (unidade), `keyfacts.wonCategoryPrimary` (categoria).
- Paginação até `numFound` com `fetchsize=100`.
- *Nota*: o Lidl só expõe no site a oferta semanal (~30-50 produtos/categoria). É a realidade do catálogo online deles.

### 🟢 Pingo Doce (Demandware/SFCC)
- **API interna**: `Search-UpdateGrid` com paginação.
- **Fonte de dados**: atributo JSON `data-gtm-info` — `item_name`, `item_brand`, `price`, `item_category2` (categoria principal).
- **Imagem**: `img.product-tile-component-image`.
- **Unidade**: `product-unit` (ex: `1 Kg | 0,59 €/Kg`).
- 12 categorias principais curadas (evita centenas de subcategorias).

### 🔷 Aldi (folheto iPaper)
- **Fluxo**: página `__NEXT_DATA__` → URL do visualizador iPaper → `window.staticSettings` → `pageTexts` (texto de cada página do folheto).
- **Extraído**: expressões regulares de preço (`1. 19` → 1,19 €) com filtros anti-ruído agressivos (datas, rodapés de promoções, `*PVP`, textos de cuidados de plantas, etc.).
- **external_id determinístico** (marca+nome normalizados) para atualizar preços semana a semana.
- O Aldi vende **apenas a oferta da semana** no folheto (~20-30 produtos reais).

---

## 🚀 Quick Start (local)

### Pré-requisitos
- Docker + Docker Compose
- Node.js 20+
- Python 3.12+ (opcional, para correr scrapers fora do Docker)
- Telefone Android com USB debugging (para instalar a app)

### 1. Levantar a base de dados e a API

```bash
docker compose up -d db api
```

- PostgreSQL em `localhost:5433` (schema aplicado automaticamente via `database/init.sql`)
- API em `http://localhost:3000` (`/api/health`)

### 2. Popular o catálogo (primeira vez)

```bash
docker compose run --rm scraper python main.py
```

Ou, para um supermercado específico:

```bash
docker compose run --rm scraper python main.py --scraper Lidl
docker compose run --rm scraper python main.py --scraper Continente,PingoDoce
```

### 3. Correr a app mobile

```bash
cd mobile
npm install
npx expo start        # QR code para abrir no Expo Go
```

Ou instalar **APK nativo** no telemóvel (USB):

```bash
cd mobile/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> ⚠️ **URL da API no telemóvel**: edita `mobile/app.json` → `expo.extra.apiBaseUrl`.
> - Emulador Android: `http://10.0.2.2:3000`
> - Telemóvel físico (dev): o IP do PC na mesma rede Wi-Fi, ex: `http://192.168.1.50:3000`
> - Produção (Azure): a URL pública `https://...`

---

## 🧪 Como testar

### Testar os scrapers individualmente (sem Docker)

```bash
cd scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgres://postgres:postgres@localhost:5433/pricescoutpt
python main.py --scraper Aldi        # rápido (~30s, folheto semanal)
python main.py --scraper Lidl        # rápido (~2min, API JSON)
python main.py --scraper Continente  # completo (~30min, 16 categorias)
```

Verificar o que está na base:

```bash
docker exec pricescoutpt_db psql -U postgres -d pricescoutpt -c \
  "SELECT s.name, count(*) FROM products p JOIN supermarkets s ON p.supermarket_id = s.id GROUP BY s.name;"
```

### Testar a API

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/stats                      # contagens por supermercado
curl "http://localhost:3000/api/products/compare?name=atum"  # compara preços (full-text)
curl "http://localhost:3000/api/categories"               # categorias + contagens
curl "http://localhost:3000/api/products?category=mercearia&supermarket=pingo-doce"

# Disparar recolha fresca de preços (sob demanda)
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"scrapers":["Lidl","Aldi"]}'
# → devolve { job_id: "..." }; segue o progresso:
curl http://localhost:3000/api/scrape/status/<job_id>
```

### Testar a sincronização mobile (chunks)

```bash
# Lote 1 (até 5.000 produtos) + cursor para o lote seguinte
curl "http://localhost:3000/api/sync?last_pulled_at=1970-01-01T00:00:00.000Z&limit=5000"
```

---

## ☁️ Deploy no Azure (100% gratuito)

Stack recomendada no plano gratuito:

| Serviço | Plano | Custo |
|---|---|---|
| **Azure Container Apps** (API + scraper num contentor) | Free plan (180k vCPU-s/mês) | 0 € |
| **Azure Database for PostgreSQL Flexible Server** | Free tier (B1ms, 32 GB) | 0 € (12 meses) |
| **Docker Hub** (hospedar a imagem) | Plano gratuito | 0 € |
| **GitHub Actions** (recolha diária automática) | Gratuito para repos públicos | 0 € |

### Deploy automático (script)

```bash
az login
./deploy/azure/deploy.sh pricescoutpt-rg westeurope pricescoutpt/api:v1
```

O script faz tudo: cria o grupo de recursos, o PostgreSQL (com o schema aplicado), constrói/publica a imagem (API + Python num só contentor) e cria o Container App com as variáveis de ambiente.

### Alternativa manual (Container Apps)

```bash
# 1. Construir e publicar a imagem (Dockerfile já combina Node + Python)
docker build -f api/Dockerfile -t <user>/pricescoutpt-api:v1 .
docker push <user>/pricescoutpt-api:v1

# 2. Criar o PostgreSQL Flexible Server (free tier) e aplicar database/init.sql

# 3. Criar o Container App
az containerapp create \
  --name pricescoutpt-api \
  --resource-group <rg> \
  --environment <rg>-env \
  --image <user>/pricescoutpt-api:v1 \
  --cpu 0.25 --memory 0.5Gi \
  --min-replicas 0 --max-replicas 1 \
  --env-vars DATABASE_URL="postgres://..." SCRAPER_DIR="/usr/src/app/scraper" SCRAPER_PYTHON="python" \
  --ingress external --target-port 3000
```

### Recolha diária automática (opcional)

O workflow `.github/workflows/daily-scrape.yml` corre os 4 scrapers todos os dias às 04:00 UTC. Basta adicionar o secret `DATABASE_URL` no GitHub (Settings → Secrets → Actions).

---

## 📱 Funcionalidades da app

- 🔍 **Pesquisa offline** com debounce sobre SQLite local (full-text no servidor via `/compare`)
- 🏷️ **Filtros por supermercado e categoria** (chips)
- 🖼️ **Imagens reais dos produtos** com fallback elegante
- ⭐ **Favoritos** persistentes no dispositivo
- 🛒 **Cabaz de compras** com comparador fuzzy local por supermercado → mostra o total em cada loja e coroa o **mais barato** 🏆
- 📈 **Histórico de preços** (30 dias) com gráfico de linha e estatísticas (mín/atual/máx)
- 📤 **Partilha do cabaz** via share nativo
- 🔄 **Sincronização incremental** por chunks (5.000/lote) com proteção contra OOM
- ☁️ **Recolha fresca sob demanda**: botão no painel de definições que dispara `POST /api/scrape` e sincroniza quando termina
- 📴 **100% offline**: depois da primeira sincronização, tudo funciona sem internet

---

## 📂 Estrutura do projeto

```
├── api/                    # API Node.js/Express
│   ├── server.js           # Routers + /api/health + /api/stats
│   ├── sync.js             # Sincronização incremental por cursor (chunks)
│   ├── products.js         # /compare (full-text) + /browse por categoria
│   ├── categories.js       # /api/categories
│   ├── scrape.js           # POST /api/scrape + /status (recolha sob demanda)
│   └── Dockerfile          # Imagem combinada Node + Python (Azure-ready)
├── scraper/                # Scrapers Python
│   ├── main.py             # Orquestrador + relatório Discord/Slack
│   ├── scraper_base.py     # Base + categorias + marcação de esgotados
│   ├── db_manager.py       # Bulk upsert, categorias, price history, prune
│   └── scrapers/           # continente.py, lidl.py, pingodoce.py, aldi.py
├── database/init.sql       # Schema PostgreSQL (FTS pt-PT, triggers, seeds)
├── mobile/                 # App React Native (Expo + WatermelonDB)
│   ├── App.js              # Tabs + tema
│   └── src/
│       ├── screens/        # Search (filtros+categorias), Basket, Favorites, Onboarding
│       ├── components/     # ProductCard (imagens), History, Settings (re-scrape)
│       ├── services/sync.js# Pull incremental por lotes
│       └── model/          # Schema WatermelonDB v4 (categorias incluídas)
├── deploy/azure/deploy.sh  # Deploy free-tier automático
└── .github/workflows/      # Recolha diária (GitHub Actions)
```

---

## ❓ FAQ

**Os preços estão sempre atualizados?**
A app usa o catálogo em cache (offline). Para preços frescos, usa o botão *Atualizar Agora* no painel de definições (dispara a recolha no servidor) ou espera pela recolha diária automática.

**Quanto pesa o catálogo no telemóvel?**
~40.000 produtos ≈ 20-30 MB no SQLite local. A sincronização é feita em lotes de 5.000 para nunca estoirar a memória.

**Um produto sumiu?**
O scraper marca como *esgotado* (`in_stock=false`) os produtos que deixaram de aparecer nas categorias quando a recolha correu por completo. Continuam no histórico.

**Limites legais / robôs?**
Os scrapers respeitam pausas (`sleep` 0.3-0.5s) e usam apenas endpoints públicos que os próprios sites servem à UI. Recolha diária + sob demanda — sem sobrecarga.
