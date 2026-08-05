<div align="center">

# 🛒 PriceScoutPT

**Comparador de preços de supermercados portugueses — offline-first no telemóvel, recolha diária automática no servidor.**

**Continente · Lidl · Pingo Doce · Aldi · Auchan** — monta o teu cabaz, compara o preço em cada loja e descobre **onde fica mais barato**, mesmo sem internet.

![React Native](https://img.shields.io/badge/React%20Native%20(Expo%2054)-1.0-blue?logo=react)
![Node.js](https://img.shields.io/badge/API-Node.js%20%2F%20Express-339933?logo=nodedotjs)
![Python](https://img.shields.io/badge/Scrapers-Python%203-3776AB?logo=python)
![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL%2015-4169E1?logo=postgresql)
![Azure](https://img.shields.io/badge/Deploy-Azure%20Container%20Apps%20(free)-0078D4?logo=microsoftazure)
![Offline](https://img.shields.io/badge/offline--first-WatermelonDB-00C7B7)
![License](https://img.shields.io/badge/license-Private-red)

</div>

---

## 📑 Índice

- [Sobre](#sobre)
- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Estado atual](#estado-atual)
- [Começar a usar (local)](#começar-a-usar-local)
- [Documentação da API](#documentação-da-api)
- [Análise dos scrapers](#análise-dos-scrapers)
- [Testes](#testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Deploy no Azure (100% gratuito)](#deploy-no-azure-100-gratuito)
- [Recolha diária automática](#recolha-diária-automática)
- [Segurança & segredos](#segurança--segredos)
- [Checklist de Produção & Play Store](#checklist-de-produção--play-store)
- [Contribuir](#contribuir)
- [Licença](#licença)
- [FAQ](#faq)

---

## ✨ Sobre

O PriceScoutPT junta os catálogos online dos 5 principais supermercados portugueses num só lugar. Os preços são recolhidos automaticamente, todos os dias, a partir dos endpoints públicos que os próprios sites usam nas suas lojas online — e ficam guardados **no telemóvel** para consulta 100% offline.

## 🚀 Funcionalidades

- 🔍 **Pesquisa instantânea** — full-text em português (`pt-PT`) no servidor + filtros offline no dispositivo.
- 🛒 **Cabaz de compras** — comparador *fuzzy* por produto mostra o total em cada loja e coroa o mais barato 🏆.
- 📈 **Histórico de preços** — 30 dias, com gráfico de linha (mínimo / atual / máximo).
- 📴 **100% offline** — depois da primeira sincronização, o catálogo inteiro vive no SQLite do telemóvel.
- ☁️ **Recolha diária automática** — GitHub Actions → `POST /api/scrape` (cerca das 13:00 em Portugal).
- 🔄 **Sincronização incremental** — em chunks de 5.000 produtos, sem estoirar a memória do dispositivo.
- 🛡️ **Resiliente a recolhas parciais** — se uma categoria falhar, nada é marcado como "esgotado" indevidamente.

## 🏗️ Arquitetura

```
┌─────────────────┐  recolha diária (cron) ┌──────────────────────┐
│  Sites públicos │ ◄───────────────────── │  Scraper (Python)    │
│  dos supermerc. │                        │  scraper/            │
└─────────────────┘                        └──────────┬───────────┘
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
| **Scrapers** | Python · `requests` · BeautifulSoup | Extraem produtos (nome, preço, imagem, categoria, unidade) dos 5 supermercados |
| **API** | Node.js · Express | Sincronização incremental, pesquisa/compare, categorias, disparo e estado de recolhas |
| **Base de dados** | PostgreSQL 15 | Catálogo + histórico de preços (30 dias) + full-text `pt-PT` |
| **App mobile** | React Native (Expo) · WatermelonDB | Catálogo offline, cabaz, favoritos, gráficos, comparador |

## 📊 Estado atual

**Base de dados de produção (Azure):** `93.558` produtos · `19` categorias canónicas · `5` supermercados.

---

## 💻 Começar a usar (local)

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Node.js](https://nodejs.org) 20+
- Python 3.12+ (opcional — só para correr scrapers fora do Docker)
- Telefone Android com *USB debugging* (para instalar a app)

### 1. Base de dados + API

```bash
docker compose up -d db api
```

- PostgreSQL em `localhost:5433` (schema aplicado automaticamente via `database/init.sql`)
- API em `http://localhost:3000` → verifica com `curl localhost:3000/api/health`

### 2. Popular o catálogo (primeira vez)

```bash
docker compose run --rm scraper python main.py            # os 5 supermercados
docker compose run --rm scraper python main.py --scraper Lidl
docker compose run --rm scraper python main.py --scraper Continente,PingoDoce
```

### 3. Correr a app mobile

```bash
cd mobile
npm install
npx expo start    # QR code no Expo Go
```

**APK nativo para o telemóvel (USB):**

```bash
cd mobile/android
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

> ⚠️ **Endereço da API no telemóvel.** Não edites `mobile/app.json` (é commitado com placeholders). Cria/edita **`mobile/app.config.local.json`** (ignorado pelo git):
> ```json
> { "expo": { "extra": { "apiBaseUrl": "https://SEU-API.azurecontainerapps.io" } } }
> ```
> Emulador: `http://10.0.2.2:3000` · PC na Wi-Fi: `http://<IP-do-PC>:3000` · Produção: URL público do Azure.
> Depois de mudar config, regenera o projeto nativo e reconstrói:
> `cd mobile && npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleRelease`.

---

## 🔌 Documentação da API

Base local: `http://localhost:3000` · Produção: URL público do Azure. Todas as respostas são JSON; leituras são públicas, o mutador (`/api/scrape`) exige autenticação.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | Estado da API + ligação à BD (liveness probe) |
| `GET` | `/api/stats` | Contagens por supermercado + `last_scraped_at` + total de categorias |
| `GET` | `/api/categories` | Taxonomia canónica de categorias |
| `GET` | `/api/products` | Browse: `?category=mercearia&supermarket=pingo-doce&limit=50&offset=0` |
| `GET` | `/api/products/compare?name=atum` | Pesquisa full-text `pt-PT`, ordenada por relevância |
| `GET` | `/api/products/:id` | Produto + histórico de preços (30 dias) |
| `GET` | `/api/sync` | Sincronização incremental: `?last_pulled_at=...&limit=5000` |
| `POST` | `/api/scrape` | Dispara recolha **atual** (header `x-scrape-secret`) |
| `GET` | `/api/scrape/status` | Estado da recolha + `last_scrape_at` |
| `GET` | `/api/scrape/status/:job_id` | Estado de uma recolha específica |

**Exemplos:**

```bash
curl localhost:3000/api/health
curl localhost:3000/api/stats
curl "localhost:3000/api/products/compare?name=atum"
curl "localhost:3000/api/products?category=mercearia&supermarket=pingo-doce"

# Recolha manual (normalmente é automática às ~13:00)
curl -X POST localhost:3000/api/scrape -H "Content-Type: application/json" \
  -H "x-scrape-secret: SEU-SECRETO" -d '{"scrapers":["Lidl","Aldi"]}'

# Sincronização mobile (chunks + cursor)
curl "localhost:3000/api/sync?last_pulled_at=1970-01-01T00:00:00.000Z&limit=5000"
```

---

## 🕵️ Análise dos scrapers

Cada scraper usa a **fonte mais fiável** de cada site — as APIs internas que o próprio site serve à UI. Todos respeitam pausas (`sleep 0.3–0.5s`), usam retry com backoff exponencial e marcam "esgotado" **apenas** em recolhas completas.

| Supermercado | Fonte | Detalhe |
|---|---|---|
| 🟥 **Continente** | Demandware/SFCC `Search-UpdateGrid` | `start/sz`; JSON `data-product-tile-impression`; 16 categorias em paralelo (ThreadPool, 5 workers) |
| 🔵 **Lidl** | JSON API interna `/q/api/search` | `gridbox.data`; paginação até `numFound`; só expõe a oferta semanal |
| 🟢 **Pingo Doce** | Demandware/SFCC `Search-UpdateGrid` | JSON `data-gtm-info`; 12 categorias curadas |
| 🔷 **Aldi** | Folheto iPaper (`__NEXT_DATA__`) | `pageTexts` + regex de preços; `external_id` determinístico |
| 🔴 **Auchan** | Demandware/SFCC `Search-UpdateGrid` | JSON `data-gtm`; 23 categorias curadas, 100 produtos/página |

### ⛔ Supermercados não suportados

- **Intermarché** — todo o site (www + api) está protegido pelo anti-bot **DataDome** (challenge JS + captcha); qualquer pedido de um IP de datacenter devolve 403. Exigiria browser real + IP residencial.
- **Mercadona** — **não tem loja online em Portugal** (73 lojas físicas; o online é exclusivo de Espanha em `tienda.mercadona.es`).

---

## 🧪 Testes

### Scrapers individuais (sem Docker)

```bash
cd scraper
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/pricescoutpt

python main.py --scraper Aldi        # ~30s  (folheto semanal)
python main.py --scraper Lidl        # ~2min (API JSON)
python main.py --scraper Continente  # ~30min (16 categorias)
python main.py --scraper Auchan      # ~15min (23 categorias, SFCC grid)
```

Contagens por supermercado:

```bash
docker exec pricescoutpt_db psql -U postgres -d pricescoutpt -c \
  "SELECT s.name, count(*) FROM products p JOIN supermarkets s ON p.supermarket_id = s.id GROUP BY s.name;"
```

---

## 📂 Estrutura do projeto

```
├── api/                    # API Node.js/Express
│   ├── server.js           # Routers, headers, rate limiting por IP, gzip, /health, /stats
│   ├── sync.js             # Sincronização incremental por cursor (chunks de 5.000)
│   ├── products.js         # /compare (full-text pt-PT) + /browse por categoria
│   ├── categories.js       # /api/categories
│   ├── scrape.js           # POST /api/scrape + /status (single-flight, last_scrape_at persistido)
│   └── Dockerfile          # Imagem combinada Node + Python (Azure-ready, non-root, HEALTHCHECK)
├── scraper/                # Scrapers Python
│   ├── main.py             # Orquestrador + relatório + alertas Discord/Slack
│   ├── scraper_base.py     # Base + retry/backoff + marcação de esgotados (só em runs completas)
│   ├── db_manager.py       # Bulk upsert, price history, prune
│   └── scrapers/           # continente.py, lidl.py, pingodoce.py, aldi.py, auchan.py
├── database/
│   ├── init.sql            # Schema PostgreSQL (FTS pt-PT, triggers, seeds)
│   └── migrations/         # Migrações incrementais (aplicar em BD existente)
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
├── docs/                   # Documentação adicional (auditoria de produção)
└── .github/workflows/      # daily-scrape.yml (recolha diária às 13:00)
```

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

> 💡 Em BD já existente, aplicar os índices de leitura uma única vez:
> `psql "$DATABASE_URL" -f database/migrations/001_reading_indexes.sql` (já estão no `init.sql` para BDs novas).

## 📅 Recolha diária automática

`.github/workflows/daily-scrape.yml` corre os scrapers Python **diretamente no runner do GitHub Actions** todos os dias às 12:00 UTC (~13:00 em Portugal) e escreve na base de dados da Azure. O runner é fiável — nunca "dorme", ao contrário do container gratuito que escala para zero e mata recolhas longas (Continente ~30 min). Adiciona o segredo no GitHub (*Settings → Secrets → Actions*):

- `PRICESCOUTPT_DATABASE_URL` — ligação ao PostgreSQL da Azure (ex: `postgres://user:pass@pricescoutpt.postgres.database.azure.com:5432/postgres?sslmode=require`)
- *(opcional)* `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` — alertas no fim da recolha.

Podes também disparar manualmente por *Actions → Recolha Diária de Preços → Run workflow*.

---

## 🔐 Segurança & segredos

Nada de segredos reais vive no repositório.

- `mobile/app.json` → commitado com **placeholder** (`apiBaseUrl: ""`).
- `mobile/app.config.local.json` → **ignorado pelo git**; guarda a URL real de cada dev.
- `mobile/app.config.js` → funde o base com o local em build-time.
- A recolha diária corre no runner do GitHub Actions (via `PRICESCOUTPT_DATABASE_URL`); o endpoint `POST /api/scrape` do container (com header **`x-scrape-secret`**, 401 sem ele) fica apenas para disparos manuais ocasionais — a app **não** dispara recolhas.
- A API corre com `trust proxy`, headers de segurança (`nosniff`, `DENY`, CSP, HSTS), gzip e rate limiting por IP.
- O container corre como **utilizador não privilegiado** e expõe `/api/health` como HEALTHCHECK.
- `.gitignore` cobre `.env`, `app.config.local.json`, `*.keystore/*.jks`, builds e `repomix-output.xml`.

---

## ✅ Checklist de Produção & Play Store

**Servidor / API**
- [x] `trust proxy` ativo — rate-limit e `req.ip` funcionam atrás do proxy do Azure.
- [x] Headers de segurança (`nosniff`, `DENY`, CSP, HSTS) servidos por `api/server.js`.
- [x] `/api/health` reporta também o estado da BD (liveness probe).
- [x] Respostas comprimidas com **gzip** — menos egress no free tier, sync mais rápido.
- [x] Índices de leitura aplicados em produção (`database/migrations/001_reading_indexes.sql`).
- [ ] **Recolha diária:** corre no runner do GitHub Actions (fiável, nunca dorme) — `PRICESCOUTPT_DATABASE_URL` configurado como segredo. As recolhas parciais **não** marcam produtos como esgotados — não há perda de catálogo. O `POST /api/scrape` do container fica só para disparos manuais (pode ser interrompido por scale-to-zero em recolhas longas).
- [ ] Cabeçalho `x-scrape-secret` exigido no `POST /api/scrape` (configurado em `SCRAPE_SECRET`).

**App (Play Store)**
- [ ] `mobile/app.config.local.json` com `apiBaseUrl` (HTTPS) e `scrapeSecret` de produção antes de gerar o AAB (nunca commitado — está no `.gitignore`).
- [ ] **Política de privacidade** obrigatória na Play Console (link externo). Sugere-se mencionar recolha de catálogos públicos de supermercados e que a app só guarda dados localmente.
- [ ] Versão consistente: `mobile/app.json → version` é a fonte; o painel "Sobre" mostra-a dinamicamente.
- [ ] Assinatura do AAB: gerar um **keystore** de release próprio e registá-lo em EAS/CI (nunca commitá-lo).
- [ ] Testar em dispositivo real com **HTTPS** (Android 9+ bloqueia HTTP simples).
- [ ] `eas build -p android --profile production` → `eas submit` para a Play (ou upload do AAB no console).

---

## 🤝 Contribuir

Este é um projeto **privado** de momento. Ainda assim, se tiveres acesso ao repositório:

1. Cria um *branch* a partir de `main`.
2. Faz *commits* pequenos e descritivos.
3. Abre um *Pull Request* descrevendo a mudança e como a testaste.

Antes de abrir o PR, certifica-te de que:
- Os scrapers continuam a recolher sem erros (`python main.py --scraper <nome>`).
- A API não regressa em erros (`node --check api/*.js`).
- A app compila (`cd mobile/android && ./gradlew assembleRelease`).

## 📄 Licença

**Private** — todos os direitos reservados. Não está atualmente publicado sob licença open-source. Contacta o proprietário para utilização.

---

## ❓ FAQ

**Os preços estão sempre atualizados?**
A app usa o catálogo em cache (offline). O servidor recolhe os preços automaticamente todos os dias às ~13:00; usa o botão *Sincronizar* no painel de definições (ou o ícone de sincronização no topo) para descarregar a última recolha — o painel mostra a hora da recolha mais recente.

**Quanto pesa o catálogo no telemóvel?**
~57 mil produtos ≈ 20–30 MB no SQLite local. A sincronização é feita em lotes de 5.000 para nunca estoirar a memória.

**Um produto sumiu?**
O scraper marca como *esgotado* (`in_stock=false`) os produtos que deixaram de aparecer nas categorias quando a recolha correu por completo. Continuam no histórico.

**Porque é que o Auchan ainda não aparece na app?**
O Auchan foi integrado recentemente; basta a próxima recolha diária correr para o catálogo popular (vê `/api/stats` para o `last_scraped_at` de cada supermercado).

**Os preços variam por região?**
Os preços aqui mostrados são de **referência nacional** — os catálogos online dos supermercados (e os folhetos do Lidl/Aldi) têm preços nacionais. Na loja física, os preços podem variar por região: segundo estudos da DECO, o **interior** tende a ser mais caro e os **Açores e a Madeira** são as regiões onde menos se poupa. A app mostra essa nota nos ecrãs de comparação e painel de controlo.

**Quanto custa isto em produção?**
0 € — escala-a-zero nos Container Apps (dorme quando não há pedidos), free tier do PostgreSQL e GitHub Actions gratuito.

---

<div align="center">
*Feito em Portugal 🇵🇹 — compara, poupa.*
</div>
