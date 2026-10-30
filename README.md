<div align="center">

# 🛒 PriceScoutPT

**Comparador de preços de supermercados portugueses — offline-first no telemóvel, recolha diária automática no servidor.**

**Continente · Lidl · Pingo Doce · Aldi · Auchan · Froiz** — monta o teu cabaz, compara o preço em cada loja e descobre **onde fica mais barato**, mesmo sem internet.

![React Native](https://img.shields.io/badge/React%20Native%20(Expo%2054)-1.0-blue?logo=react)
![Node.js](https://img.shields.io/badge/API-Node.js%20%2F%20Express-339933?logo=nodedotjs)
![Python](https://img.shields.io/badge/Scrapers-Python%203-3776AB?logo=python)
![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL%2018-4169E1?logo=postgresql)
![Render](https://img.shields.io/badge/API-Render%20Free-46E3B7?logo=render)
![Neon](https://img.shields.io/badge/DB-Neon%20Free-00E599)
![Offline](https://img.shields.io/badge/offline--first-WatermelonDB-00C7B7)
![License](https://img.shields.io/badge/license-GPL--3.0-brightgreen)

</div>

Produção: [API Render](https://pricescoutpt-api.onrender.com/api/health) + Neon Free, em Frankfurt. Consulta o [guia de alojamento gratuito](deploy/free/README.md). Não é necessária uma subscrição Azure para esta configuração.

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
- [Deploy no Azure](#deploy-no-azure)
- [Recolha diária automática](#recolha-diária-automática)
- [Segurança & segredos](#segurança--segredos)
- [Checklist de Produção & Play Store](#checklist-de-produção--play-store)
- [Contribuir](#contribuir)
- [Licença](#licença)
- [FAQ](#faq)

---

## ✨ Sobre

O PriceScoutPT junta preços de seis supermercados portugueses, com um coletor de campanhas Intermarché opcional e importação de observações para outras cadeias. A cobertura distingue catálogos online, ofertas públicas e folhetos. Os preços são recolhidos automaticamente, todos os dias, a partir das fontes públicas usadas pelos próprios sites — e ficam guardados **no telemóvel** para consulta 100% offline.

## 🚀 Funcionalidades

- 🔍 **Pesquisa instantânea** — pesquisa por palavras, marca, código de barras e acentos; tolerância a erros de escrita offline, filtros e ordenação antes da paginação.
- 🛒 **Cabaz de compras** — comparador *fuzzy* por produto mostra o total em cada loja e coroa o mais barato 🏆.
- 📈 **Histórico de preços** — 30 dias, com gráfico de linha (mínimo / atual / máximo).
- 📴 **100% offline** — depois da primeira sincronização, o catálogo inteiro vive no SQLite do telemóvel.
- ☁️ **Recolha diária automática** — scrapers no GitHub Actions → PostgreSQL, às 12:00 UTC (12:00 em Portugal no inverno, 13:00 no verão).
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
| **Scrapers** | Python · `requests` · BeautifulSoup | Extraem nome, preço, marca, descrição, imagem, categoria, embalagem, preço/unidade e condições publicadas |
| **API** | Node.js · Express | Sincronização incremental, pesquisa/compare, categorias, disparo e estado de recolhas |
| **Base de dados** | PostgreSQL 15 | Catálogo + histórico de preços (30 dias) + full-text `pt-PT` |
| **App mobile** | React Native (Expo) · WatermelonDB | Catálogo offline, cabaz, favoritos, gráficos, comparador |

## 📊 Estado atual

**Cobertura:** seis coletores HTTP; Intermarché opcional via browser; 13 cadeias registadas para preços/importações. Consulta `GET /api/supermarkets` para preços efetivamente disponíveis e `GET /api/stats` para as contagens atuais. O registo de uma cadeia não significa catálogo recolhido.

Configuração de fontes, migrações e importação: [guia de recolha](docs/data-collection.md). Verificação por cadeia: [fontes dos supermercados](docs/retailer-sources.md).

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
docker compose run --rm scraper python main.py            # seis coletores HTTP
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
| `GET` | `/api/supermarkets` | Cobertura real por cadeia, fontes, última observação e preços utilizáveis |
| `GET` | `/api/stats` | Contagens por supermercado + `last_scraped_at` + total de categorias |
| `GET` | `/api/categories` | Taxonomia canónica de categorias |
| `GET` | `/api/products` | Browse: `?category=mercearia&supermarket=pingo-doce&limit=50&offset=0` |
| `GET` | `/api/products/compare?name=atum` | Pesquisa por palavras/prefixos, marca e código de barras; sem acentos, ordenada por relevância |
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

Cada scraper usa a **fonte mais fiável** de cada site — as APIs internas que o próprio site serve à UI. Os coletores respeitam pausas e retries limitados. Páginas vazias, repetidas ou truncadas são reportadas como recolha parcial. A retirada por ausência exige cobertura completa e uma opção explícita do coletor; folhetos e subconjuntos não apagam o catálogo.

| Supermercado | Fonte | Detalhe |
|---|---|---|
| 🟥 **Continente** | Demandware/SFCC `Search-UpdateGrid` | `start/sz`; JSON `data-product-tile-impression`; 16 categorias em paralelo (ThreadPool, 5 workers) |
| 🔵 **Lidl** | JSON API interna `/q/api/search` | `gridbox.data`; paginação até `numFound`; só expõe a oferta semanal |
| 🟢 **Pingo Doce** | Demandware/SFCC `Search-UpdateGrid` | JSON `data-gtm-info`; 12 categorias curadas |
| 🔷 **Aldi** | Folheto iPaper (`__NEXT_DATA__`) | `pageTexts` + regex de preços; `external_id` determinístico |
| 🟣 **Froiz** | API pública `serviciospt.froiz.com/api` | Descoberta dinâmica de categorias, paginação verificada, preço/unidade e propriedades publicadas |
| 🔴 **Auchan** | Demandware/SFCC `Search-UpdateGrid` | JSON `data-gtm`; 23 categorias curadas, 100 produtos/página |

### Fontes adicionais e limites

O Intermarché tem campanhas públicas visíveis num browser normal, mas os testes HTTP e Chromium headless devolveram 403. O coletor opcional exige campanhas explícitas e não contorna restrições; não faz parte da recolha diária padrão.

Mercadona, El Corte Inglés, Minipreço, E.Leclerc, Amanhecer e SPAR estão registados para importações de preços portugueses observados, recibos transcritos ou exports autorizados. Não se afirma cobertura automática onde não foi verificada uma fonte utilizável. Ver [fontes e limites por cadeia](docs/retailer-sources.md).

---

## 🧪 Testes

### Testes unitários (mobile)

```bash
cd mobile
npm test                      # node --test tests/ (fuzzy matcher + preço por unidade)
```

### Testes unitários (scrapers)

```bash
cd scraper
.venv/bin/python -m unittest discover -s tests   # taxonomia + helpers de extração
```

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
└── .github/workflows/      # daily-scrape.yml (recolha diária às 12:00 UTC)
```

---

## ☁️ Deploy no Azure

Esta é uma alternativa histórica. A produção atual usa [Render + Neon Free](deploy/free/README.md).

| Serviço | Configuração mínima | Custos/limites |
|---|---|---|
| **Azure Container Apps** (API + runtime do scraper) | Consumption, 0,5 CPU / 1 GiB, 0–1 réplicas | Franquias mensais partilhadas por subscrição; excesso pode ser cobrado |
| **Azure Database for PostgreSQL Flexible Server** | B1ms, 32 GB | Benefício de 12 meses sujeito à elegibilidade/período restante |
| **Docker Hub** (imagem) | Plano gratuito elegível | Confirmar limites da conta |
| **GitHub Actions** (scrapers Python no runner) | Uma recolha diária, até 180 minutos por execução | Consumo depende da duração e do plano/visibilidade do repositório |

Consulta os limites oficiais de [Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/billing) e da oferta [Azure for Students](https://azure.microsoft.com/en-us/free/students/). A disponibilidade de regiões e SKUs deve ser verificada na subscrição; não há garantia geral de custo zero. A operação, validação e atualização estão descritas em [docs/azure-multi-user.md](docs/azure-multi-user.md).

### Deploy automático

```bash
az login
./deploy/azure/deploy.sh pricescoutpt-rg northeurope <user>/pricescoutpt-api:v1
```

Este script é um provisionador legado para uma instalação inicial: cria recursos, aplica o schema e publica a imagem. Não é um procedimento de atualização de produção; imprime credenciais e deve ser revisto antes de uso. Para recursos existentes, preserva configurações/segredos e atualiza a imagem depois das migrações descritas em [docs/data-collection.md](docs/data-collection.md).

Duas modalidades:
- **BYO DB** — passa `DATABASE_URL` como env ao script e ele salta a criação do PostgreSQL (útil para o free tier criado no portal).
- **Autónomo** — sem `DATABASE_URL`, o script cria tudo do zero.

> 💡 Em BD já existente, aplicar os índices de leitura uma única vez:
> `psql "$DATABASE_URL" -f database/migrations/001_reading_indexes.sql` (já estão no `init.sql` para BDs novas).

## 📅 Recolha diária automática

O workflow `daily-scrape.yml` corre todos os dias às 12:00 UTC. Aldi, Lidl, Pingo Doce, Auchan e Continente correm no runner público do GitHub; Froiz corre pela API Render, que o workflow acompanha até terminar. Todos guardam observações no Neon com um utilizador de acesso limitado.

Configura os segredos `PRICESCOUTPT_DATABASE_URL` e `PRICESCOUT_API_SCRAPE_SECRET`, e a variável `PRICESCOUT_API_URL`. Não são necessárias credenciais Azure, OIDC ou regras temporárias de firewall. Os nomes e os passos completos estão no [guia de alojamento gratuito](deploy/free/README.md).

Usa *Actions → Recolha Diária de Preços → Run workflow*, na branch `main`, para executar manualmente. Podes escolher coletores e um máximo de 0, 25, 100 ou 250 páginas de detalhe por coletor. O workflow tem um limite de 180 minutos, não envia webhooks e não cancela recolhas em curso. Falhas e cobertura parcial são reportadas; observações já guardadas são preservadas. A recolha verifica o espaço da base de dados antes e depois, com uma proteção aos 800 MiB.

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

O projeto é **open-source** (GPL-3.0). Para contribuir:

1. Cria um *branch* a partir de `main`.
2. Faz *commits* pequenos e descritivos.
3. Abre um *Pull Request* descrevendo a mudança e como a testaste.

Antes de abrir o PR, certifica-te de que:
- Os scrapers continuam a recolher sem erros (`python main.py --scraper <nome>`).
- A API não regressa em erros (`node --check api/*.js`).
- A app compila (`cd mobile/android && ./gradlew assembleRelease`).

## 📄 Licença

**GPL-3.0** — [GNU General Public License v3](LICENSE). Livre para usar, modificar e distribuir; qualquer versão derivada deve manter a mesma licença e disponibilizar o código-fonte.

---

## ❓ FAQ

**Os preços estão sempre atualizados?**
A app usa o catálogo em cache (offline). O workflow recolhe os preços automaticamente todos os dias às 12:00 UTC; usa o botão *Sincronizar* no painel de definições (ou o ícone de sincronização no topo) para descarregar a última recolha — o painel mostra a hora da recolha mais recente.

**Quanto pesa o catálogo no telemóvel?**
~57 mil produtos ≈ 20–30 MB no SQLite local. A sincronização é feita em lotes de 5.000 para nunca estoirar a memória.

**Um produto sumiu?**
O scraper marca como *esgotado* (`in_stock=false`) os produtos que deixaram de aparecer nas categorias quando a recolha correu por completo. Continuam no histórico.

**Porque é que o Auchan ainda não aparece na app?**
O Auchan foi integrado recentemente; basta a próxima recolha diária correr para o catálogo popular (vê `/api/stats` para o `last_scraped_at` de cada supermercado).

**Os preços variam por região?**
Os preços aqui mostrados são de **referência nacional** — os catálogos online dos supermercados (e os folhetos do Lidl/Aldi) têm preços nacionais. Na loja física, os preços podem variar por região: segundo estudos da DECO, o **interior** tende a ser mais caro e os **Açores e a Madeira** são as regiões onde menos se poupa. A app mostra essa nota nos ecrãs de comparação e painel de controlo.

**Quanto custa isto em produção?**
Depende dos benefícios ativos da subscrição, do tráfego e dos minutos do GitHub Actions. A configuração mínima usa escala-a-zero e PostgreSQL B1ms/32 GB; confirma elegibilidade, consumo e crédito no Azure antes de assumir custo zero. Vê [operação no Azure](docs/azure-multi-user.md).

---

<div align="center">
*Feito em Portugal 🇵🇹 — compara, poupa.*
</div>
