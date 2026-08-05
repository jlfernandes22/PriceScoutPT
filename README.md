# 🛒 PriceScoutPT

> **Comparador de preços de supermercados portugueses — offline-first no telemóvel, recolha diária automática no servidor.**

**Continente · Lidl · Pingo Doce · Aldi** — monta o teu cabaz, compara o preço em cada loja e descobre **onde fica mais barato**, mesmo sem internet.

![React Native](https://img.shields.io/badge/React%20Native-Expo-blue)
![Node.js](https://img.shields.io/badge/API-Node.js%20%2F%20Express-brightgreen)
![Python](https://img.shields.io/badge/Scrapers-Python%203-yellow)
![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL%2015-blueviolet)
![Azure](https://img.shields.io/badge/Deploy-Azure%20Container%20Apps%20(free)-0078D4)
![Offline](https://img.shields.io/badge/offline--first-WatermelonDB-green)

---

## ✨ O que é

Um **comparador de preços** que junta os catálogos online dos 4 principais supermercados portugueses num só lugar:

- 🔍 **Pesquisa instantânea** sobre o catálogo (full-text em português no servidor, filtros offline no telemóvel)
- 🛒 **Cabaz de compras** — comparador fuzzy por produto mostra o **total em cada loja** e coroa o mais barato 🏆
- 📈 **Histórico de preços** (30 dias) com gráfico de linha (mín / atual / máx)
- 📴 **100% offline** — depois da primeira sincronização, o catálogo inteiro vive no SQLite do telemóvel
- ☁️ **Recolha diária automática** — o servidor recolhe os preços dos 4 supermercados todos os dias às ~13:00; um botão *Sincronizar* descarrega a última recolha e mostra a sua hora
- 🔄 **Sincronização incremental** por chunks (5.000/lote) — sem estoirar memória no dispositivo

---

## 🏗️ Arquitetura

```
┌─────────────────┐  recolha diária (cron)  ┌──────────────────────┐
│  Sites públicos │ ◄───────────────────── │  Scraper (Python)    │
│  dos supermerc. │                         │  scraper/            │
└─────────────────┘                         └──────────┬───────────┘
                                                      │ bulk upsert
                                                      ▼
┌──────────────────┐   /api/sync (chunks)   ┌──────────────────────┐
│  App Mobile      │ ◄───────────────────── │  API (Node/Express)  │
│  React Native    │                        │  api/                │
│  WatermelonDB    │                        └──────────┬───────────┘
│  (SQLite local)  │                                   │
└──────────────────┘                        ┌──────────▼───────────┐
                                            │ PostgreSQL 15        │
                                            │  database/init.sql   │
                                            └──────────────────────┘
```

| Componente | Tecnologia | Papel |
|---|---|---|
| **Scrapers** | Python · requests · BeautifulSoup | Extraem produtos (nome, preço, imagem, categoria, unidade) dos 4 supermercados |
| **API** | Node.js · Express | Sincronização incremental, pesquisa/compare, categorias, disparo e estado de recolhas |
| **Base de dados** | PostgreSQL 15 | Catálogo + histórico de preços (30 dias) + full-text `pt-PT` |
| **App mobile** | React Native (Expo) · WatermelonDB | Catálogo offline, cabaz, favoritos, gráficos, comparador |

**Estado atual da base (Azure):** 56.587 produtos · 61.461 entradas de histórico · 19 categorias · 4 supermercados.

---

## 🚀 Quick Start (local)

### Pré-requisitos
- Docker + Docker Compose
- Node.js 20+
- Python 3.12+ (opcional — scrapers fora do Docker)
- Telefone Android com USB debugging

### 1. Base de dados + API

```bash
docker compose up -d db api
```

- PostgreSQL em `localhost:5433` (schema aplicado automaticamente via `database/init.sql`)
- API em `http://localhost:3000` → verifica com `curl localhost:3000/api/health`

### 2. Popular o catálogo (primeira vez)

```bash
docker compose run --rm scraper python main.py            # os 4 supermercados
docker compose run --rm scraper python main.py --scraper Lidl
docker compose run --rm scraper python main.py --scraper Continente,PingoDoce
```

### 3. Correr a app mobile

```bash
cd mobile
npm install
npx expo start    # QR code no Expo Go
```

**APK nativo** para o telemóvel (USB):

```bash
cd mobile/android
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

> ⚠️ **Endereço da API no telemóvel.** Não edites `mobile/app.json` (é commitado com placeholders). Cria/edita o ficheiro **`mobile/app.config.local.json`** (ignorado pelo git):
> ```json
> { "expo": { "extra": { "apiBaseUrl": "http://192.168.1.50:3000" } } }
> ```
> Emulador: `http://10.0.2.2:3000` · PC na Wi-Fi: `http://<IP-do-PC>:3000` · Produção: URL público do Azure.
> Depois de mudar config, regera o projeto nativo e reconstrói: `cd mobile && npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleRelease`.

---

## ☁️ Deploy no Azure (100% gratuito)

| Serviço | Plano | Custo |
|---|---|---|
| **Azure Container Apps** (API + scraper num contentor) | Free plan — 180k vCPU-s, 360k GiB-s, 2M requests/mês | 0 € |
| **Azure Database for PostgreSQL Flexible Server** | Free tier — B1ms, 32 GB, 750 h/mês | 0 € |
| **Docker Hub** (imagem) | Plano gratuito | 0 € |
| **GitHub Actions** (recolha diária — 1 job curl/dia) | 2.000 min/mês (repos privados) | 0 € |

> 📌 **Nota:** o `westeurope` rejeita clientes novos para PostgreSQL Flexible Server e Log Analytics — usar **`northeurope`**.

### Deploy automático

```bash
az login
./deploy/azure/deploy.sh pricescoutpt-rg northeurope <user>/pricescoutpt-api:v1
```

O script faz tudo: cria o grupo, instala a extensão `containerapp`, cria o ambiente, o PostgreSQL, aplica o schema, constrói/publica a imagem (Node + Python num contentor) e cria o Container App **com escala-a-zero** (`--min-replicas 0 --max-replicas 1`).

Duas modalidades:
- **BYO DB** — passa `DATABASE_URL` como env ao script e ele salta a criação do PostgreSQL (útil para o free tier criado no portal).
- **Autónomo** — sem `DATABASE_URL`, o script cria tudo do zero.

### Recolha diária automática

`.github/workflows/daily-scrape.yml` dispara a recolha dos 4 supermercados **todos os dias às 12:00 UTC (~13:00 em Portugal)** — um `POST /api/scrape` que acorda o contentor e recolhe dentro do Azure (sem mudanças na firewall da DB). Adiciona dois segredos no GitHub (*Settings → Secrets → Actions*):

- `PRICESCOUTPT_API_URL` — URL público da API (ex: `https://...azurecontainerapps.io`)
- `PRICESCOUTPT_SCRAPE_SECRET` — o mesmo segredo do `SCRAPE_SECRET` do container

Podes também disparar manualmente pelo *Actions → Recolha Diária de Preços → Run workflow*.

---

## 🔐 Segurança & segredos

Nada de segredos reais vive no repositório.

- `mobile/app.json` → commitado com **placeholder** (`apiBaseUrl: ""`).
- `mobile/app.config.local.json` → **ignorado pelo git**; guarda a URL real de cada dev.
- `mobile/app.config.js` → funde o base com o local em build-time.
- A recolha (`POST /api/scrape`) exige o header **`x-scrape-secret`** (401 sem ele); é usada apenas pelo job diário do GitHub Actions e por disparos manuais — a app **não** dispara recolhas.
- `.gitignore` cobre `.env`, `app.config.local.json`, `*.keystore/*.jks`, builds e `repomix-output.xml`.

---

## 🧪 Como testar

### Scrapers individuais (sem Docker)

```bash
cd scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/pricescoutpt

python main.py --scraper Aldi        # ~30s (folheto semanal)
python main.py --scraper Lidl        # ~2min (API JSON)
python main.py --scraper Continente  # ~30min (16 categorias)
```

Contagens por supermercado:

```bash
docker exec pricescoutpt_db psql -U postgres -d pricescoutpt -c \
  "SELECT s.name, count(*) FROM products p JOIN supermarkets s ON p.supermarket_id = s.id GROUP BY s.name;"
```

### API

```bash
curl localhost:3000/api/health
curl localhost:3000/api/stats
curl "localhost:3000/api/products/compare?name=atum"
curl "localhost:3000/api/categories"
curl "localhost:3000/api/products?category=mercearia&supermarket=pingo-doce"

# Recolha diária (normalmente automática às 13:00; dispara também à mão)
curl -X POST localhost:3000/api/scrape -H "Content-Type: application/json" \
  -d '{"scrapers":["Lidl","Aldi"]}'
# → { job_id: "..." }
curl localhost:3000/api/scrape/status   # → { jobs, last_scrape_at }
curl localhost:3000/api/scrape/status/<job_id>
```

### Sincronização mobile (chunks + cursor)

```bash
curl "localhost:3000/api/sync?last_pulled_at=1970-01-01T00:00:00.000Z&limit=5000"
```

---

## 🕵️ Análise dos scrapers

Cada scraper usa a **fonte mais fiável** de cada site — as APIs internas que o próprio site serve à UI.

### 🟥 Continente (Demandware/SFCC)
`Search-UpdateGrid` com paginação `start/sz`; dados limpos do atributo JSON `data-product-tile-impression` (id, name, price, brand, category); imagem `img.ct-tile-image` (ignora badges `pvpr.png`); unidade `pwc-tile--quantity`. 16 categorias em paralelo (ThreadPool, 5 workers).

### 🔵 Lidl (JSON API interna)
`GET /q/api/search?category.id=XXX` devolve JSON puro (sem browser): `gridbox.data` → título, `itemId`, `lidlPlus[0].price.price`, `packaging.text`, `keyfacts.wonCategoryPrimary`. Paginação até `numFound` com `fetchsize=100`. *O site só expõe a oferta semanal (~30-50 produtos/categoria).*

### 🟢 Pingo Doce (Demandware/SFCC)
`Search-UpdateGrid`; dados do atributo JSON `data-gtm-info` (`item_name`, `item_brand`, `price`, `item_category2`); unidade `product-unit`; 12 categorias principais curadas.

### 🔷 Aldi (folheto iPaper)
`__NEXT_DATA__` → visualizador iPaper → `window.staticSettings` → `pageTexts`; regex de preços com filtros anti-ruído agressivos; `external_id` determinístico para atualização semanal. *Vende apenas a oferta da semana no folheto.*

> 🛡️ Todos respeitam pausas (sleep 0.3-0.5s) e usam apenas endpoints públicos — sem sobrecarga.

---

## 📂 Estrutura do projeto

```
├── api/                    # API Node.js/Express
│   ├── server.js           # Routers, headers, rate limiting por IP, /health, /stats
│   ├── sync.js             # Sincronização incremental por cursor (chunks de 5.000)
│   ├── products.js         # /compare (full-text pt-PT) + /browse por categoria
│   ├── categories.js       # /api/categories
│   ├── scrape.js           # POST /api/scrape + /status (single-flight, last_scrape_at persistido)
│   └── Dockerfile          # Imagem combinada Node + Python (Azure-ready)
├── scraper/                # Scrapers Python
│   ├── main.py             # Orquestrador + relatório
│   ├── scraper_base.py     # Base + categorias + marcação de esgotados
│   ├── db_manager.py       # Bulk upsert, price history, prune
│   └── scrapers/           # continente.py, lidl.py, pingodoce.py, aldi.py
├── database/init.sql       # Schema PostgreSQL (FTS pt-PT, triggers, seeds)
├── mobile/                 # App React Native (Expo + WatermelonDB)
│   ├── App.js              # Tabs + tema + ScrapeProvider (estado global de recolha)
│   ├── app.json            # Placeholders commitados
│   ├── app.config.js       # Funde app.config.local.json em build-time
│   └── src/
│       ├── screens/        # Search, Basket, Favorites, Compare, Onboarding
│       ├── components/     # ProductCard, History, SettingsModal (painel de controlo)
│       ├── services/       # sync.js (sincronização por lotes)
│       └── model/          # Schema WatermelonDB v4
├── deploy/azure/deploy.sh  # Deploy free-tier automático (BYO DB ou autónomo)
└── .github/workflows/      # daily-scrape.yml (recolha diária às 13:00)
```

---

## ❓ FAQ

**Os preços estão sempre atualizados?**
A app usa o catálogo em cache (offline). O servidor recolhe os preços automaticamente todos os dias às ~13:00; usa o botão *Sincronizar* no painel de definições (ou o ícone de sincronização no topo) para descarregar a última recolha — o painel mostra a hora da recolha mais recente.

**Quanto pesa o catálogo no telemóvel?**
~56 mil produtos ≈ 20-30 MB no SQLite local. A sincronização é feita em lotes de 5.000 para nunca estoirar a memória.

**Um produto sumiu?**
O scraper marca como *esgotado* (`in_stock=false`) os produtos que deixaram de aparecer nas categorias quando a recolha correu por completo. Continuam no histórico.

**Quanto custa isto em produção?**
0 € — escala-a-zero nos Container Apps (dorme quando não há pedidos), free tier do PostgreSQL e GitHub Actions gratuito.

---

*Feito em Portugal 🇵🇹 — compara, poupa.*
