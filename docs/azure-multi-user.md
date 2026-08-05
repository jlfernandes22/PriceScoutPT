# ☁️ Auditoria de produção — uso multi-utilizador no Azure (free tier)

**Data:** 2026-08-05 · **Stack:** Azure Container Apps (0.5 CPU / 1.0 GiB, `min-replicas 0`, `max-replicas 1`) + PostgreSQL Flexible Server **B1ms** (free) · **Dados:** ~56.587 produtos / 61.461 histórico / 19 categorias / 4 supermercados.

> **Atualização 2026-08-05:** a recolha passou a ser **diária e automática** (GitHub Actions às ~13:00 → `POST /api/scrape`). A app **não dispara recolhas** nem faz polling contínuo — apenas sincroniza e lê a hora da última recolha uma vez ao abrir o painel. Isto eliminou o consumo de pedidos do polling e a folga apertada do rate limit do `/api/scrape`.

---

## 1. Escala-a-zero (Container Apps)

- `--min-replicas 0 --max-replicas 1` → o contentor **dorme** quando não há pedidos e acorda a pedido.
- **Custo efetivo ≈ 0 €** em idle; o consumo só conta quando há tráfego real.
- **Cold start:** o primeiro pedido após idle sofre ~5-15 s de arranque (Node + pool PostgreSQL). Irrelevante para o uso por botão *Atualizar Agora*; notório se se quiser usar a app como API de consulta em tempo real.
- Se a latência de arranque incomodar, `--min-replicas 1` garante warm start — ainda dentro do orçamento gratuito para uso ligeiro (180k vCPU-s / mês ≈ 250 h de 0.5 CPU).

## 2. Rate limiting por IP (express custom, `api/server.js`)

| Rota | Limite/min | Notas |
|---|---|---|
| `/api/sync` | 600 | Sincronização completa = ~12 pedidos (56.587 / 5.000 por lote) → **1% do limite**. |
| `/api/products` | 300 | Pesquisa/browse. |
| `/api/categories` | 300 | 1 pedido por arranque. |
| `/api/scrape*` | **20** | Recolha diária = 1 POST (+ raros disparos manuais). Folga enorme. |
| default | 600 | `/health`, `/stats`, etc. |

A app só toca em `/api/scrape*` **uma vez por abertura do painel** (GET `/status` para mostrar a hora da última recolha). Sem polling contínuo, os 20/min nunca são sequer aproximados, mesmo com vários dispositivos no mesmo IP.

## 3. Orçamento de pedidos do free plan (2M HTTP requests/mês)

Sem polling contínuo, o consumo da app é mínimo:

| Atividade | Pedidos |
|---|---|
| Sincronização (descarregar a recolha do dia) | ~12 (56.587 / 5.000 por lote) |
| Abrir painel de controlo (última recolha) | 1 |
| Pesquisas/favoritos/cabaz | 1-2/uso |
| Recolha diária (GitHub Actions) | 1 POST/dia |

- ~1.000 sincronizações completas/mês = ~12k pedidos → **2% do orçamento**.
- O free plan aguenta **dezenas a centenas de utilizadores ativos** com margem; o polling contínuo (removido) era o único risco real.

## 4. Ligações PostgreSQL (B1ms)

- Pool da API: `max: 10` (`api/db.js`), `connectionTimeoutMillis: 10000`.
- Limite documentado do B1ms (1 vCore): **~35 conexões**.
- Headroom: pool (10) + scraper (conexões transientes, 1-3) + `psql`/ferramentas → **bem abaixo das 35**.
- O `connectionTimeoutMillis: 10000` evita que pedidos fiquem presos a esperar por uma ligação livre em picos.
- **Sem risco** para o perfil multi-utilizador previsto.

## 5. Recolha single-flight (agora só a diária)

- A recolha é disparada pelo **GitHub Actions** todos os dias (`POST /api/scrape`) — só **um job de cada vez** no servidor (409 se já houver um em curso).
- A app já não dispara recolhas; o `POST /api/scrape` fica para o scheduler e para disparos manuais via curl.
- Os jobs em memória perdem-se num reinício do contentor, mas a hora da última recolha aparece persistida: `GET /api/scrape/status` devolve `last_scrape_at` = `MAX(last_scraped_at)` dos produtos (sobrevive ao idle/cold-start).

## 6. Segurança

- `POST /api/scrape` exige header **`x-scrape-secret`** → 401 sem ele. Rotacionável via `az containerapp update --set-env-vars SCRAPE_SECRET=...`.
- Endpoints de leitura (`/sync`, `/products`, `/categories`, `/scrape/status`) são públicos por design (catálogo é dado público dos sites); o único mutador (scrape) está protegido.
- Sem segredos em git (`app.config.local.json` ignorado; `app.json` com placeholders).

## 7. Resumo executivo

| Área | Veredicto |
|---|---|
| Custo | 0 € com escala-a-zero + free tiers |
| Cold start | Aceitável (5-15 s); `min-replicas 1` se necessário |
| Rate limits | Folga ampla (a app já não faz polling; 20/min no `/api/scrape` só para o job diário) |
| Pedidos/mês | Sem polling: ~2% do orçamento para 1.000 sincronizações → dezenas a centenas de utilizadores |
| DB conexões | Folga confortável (10 de ~35) |
| Concorrência de scrape | Só o job diário; single-flight + 409 corretos |
| Segurança | Scrape protegido por segredo (só o GitHub Actions o usa); nada de segredos no repo |
