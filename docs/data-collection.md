# Recolha, pesquisa e importação de preços

Os seis coletores HTTP padrão são Continente, Lidl, Pingo Doce, Aldi, Auchan e Froiz. O Intermarché tem um coletor de campanhas opcional via browser, com limitações de acesso documentadas. As restantes cadeias aceitam observações importadas: uma cadeia registada sem dados não aparece como se tivesse preços disponíveis na pesquisa/comparação.

## Atualizar uma instalação existente

Pausa recolhas e pedidos de sincronização, aplica as migrações e arranca a nova API/scrapers antes de atualizar a app. As migrações alteram triggers e índices; executá-las durante uma recolha/sync pode provocar bloqueios de DDL. Numa base nova, `database/init.sql` já contém o schema completo.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/003_product_sources.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/004_product_search.sql
```

A app migra o SQLite para a versão 6 e faz uma atualização completa do catálogo na primeira sincronização para preencher as novas colunas. Favoritos e cabazes são preservados. Os deltas do servidor passam a paginar também atualizações e remoções; uma recolha com mais de 10.000 alterações deixa de obrigar a descarregar tudo novamente. O limite temporal vem do relógio da base e uma barreira transacional impede perder escritas que estavam por confirmar quando começou a sincronização.

## Recolher e enriquecer

```bash
cd scraper
python main.py --scraper Froiz
python main.py --scraper Continente,PingoDoce,Auchan --details-limit 100
```

`--details-limit` consulta até N páginas públicas únicas de produto por coletor para enriquecer descrições, códigos de barras e propriedades estruturadas que o retalhista publique. O padrão é 0, para não multiplicar pedidos sem necessidade. Não altera o preço do card com outro preço de unidade/cupão encontrado nos detalhes. Algumas páginas não têm dados estruturados adicionais.

A recolha diária em `.github/workflows/daily-scrape.yml` usa `--details-limit 100` e executa os seis coletores HTTP diretamente no runner, com a ligação `PRICESCOUTPT_DATABASE_URL` guardada nos secrets do GitHub. As execuções manuais permitem escolher um coletor, `Froiz,Aldi` para uma primeira recolha curta, ou `all`, e um limite de 0, 25, 100 ou 250 detalhes. Um grupo de concorrência partilhado impede sobreposição entre execuções manuais e agendadas deste workflow; uma nova execução não cancela a que está em curso. Não dispara webhooks de comunicação. O endpoint manual da API tem um bloqueio separado em memória: evita usá-lo durante uma recolha do workflow.

O workflow autentica-se no Azure por OIDC, permite temporariamente apenas o IPv4 público do runner na firewall do PostgreSQL e remove essa regra num passo final com `always()`. As cinco variáveis `AZURE_*` e a atribuição de permissões apenas nesse servidor estão descritas em [azure-multi-user.md](azure-multi-user.md). Os disparos manuais devem usar a branch `main`, que é a única autorizada na federação.

As observações incluem marca, embalagem, imagem, categoria, código de barras, preço anterior, preço por kg/l/un, origem, data de observação e condições de promoção quando a fonte os publica. A ausência de um campo não é preenchida com um valor inventado. O preço anunciado não confirma stock numa loja física.

## Intermarché opcional

```bash
cd scraper
pip install -r requirements-browser.txt
python -m playwright install chromium
INTERMARCHE_LISTING_IDS=2119 python main.py --scraper Intermarche
```

Os IDs identificam campanhas `/shop/…`, não lojas físicas. Escolhe IDs que existam no site atual; o exemplo foi observado em 29/10/2026 e pode expirar. `INTERMARCHE_MAX_PAGES` limita o número de páginas (40 por padrão). `INTERMARCHE_HEADLESS=0` permite usar um browser visível num ambiente com interface gráfica. O contentor padrão não instala Chromium.

O parser foi testado com o DOM público observado e deteta paginação repetida/incompleta. A navegação normal no browser da app mostrou produtos sem autenticação; o teste local Chromium headless recebeu 403 e parou. Este coletor é experimental, não uma garantia de recolha automática em servidores. Restrições de acesso são reportadas como erro; não há resolução de CAPTCHA nem reutilização de contas. `INTERMARCHE_STORE_LOCATION` é um rótulo opcional fornecido pelo operador, não uma confirmação de aplicabilidade a uma loja.

## Importar exports ou observações de outras cadeias

```bash
python scraper/import_prices.py --list-supermarkets
python scraper/import_prices.py precos.csv --supermarket mercadona --source receipt --dry-run
python scraper/import_prices.py precos.csv --supermarket mercadona --source receipt
```

Formatos: CSV UTF-8 (vírgulas, ponto e vírgula ou tabulação) ou JSON com uma lista de objetos, ou `{"products": [...]}`. Fontes: `manual`, `receipt`, `authorised_feed`, `leaflet`, `public_listing`. Não há OCR de recibos nesta versão; importa linhas transcritas/verificadas ou exports já estruturados.

Campos obrigatórios: `name`, `price`, `observed_at`. Para `manual`/`receipt`, também `store_location`; para `leaflet`/`public_listing`, também `valid_to`. O preço é por embalagem/unidade de compra, não o total de uma linha de recibo. Usa apenas preços observados em Portugal, em EUR; preços espanhóis da Mercadona não representam preços portugueses.

Campos adicionais: `external_id`, `barcode`, `brand`, `description`, `category_name`, `unit`, `regular_price`, `unit_price`, `unit_price_unit` (`kg`, `l`, `un`), `source_url`, `url`, `image_url`, `requires_loyalty_card`, `valid_from`, `valid_to`, `in_stock`, `metadata` (objeto JSON).

Datas aceitam ISO 8601; sem fuso explícito, usa-se Europe/Lisbon. `valid_to` apenas com data inclui o fim desse dia local. A data da observação é obrigatória e não pode ser futura. Observações manuais/recibos sem outra validade expiram após 14 dias. O importador valida o ficheiro inteiro antes de gravar, não retira produtos ausentes e não deixa uma observação antiga substituir outra mais recente. Importações repetidas da mesma identidade/loja/fonte atualizam a mesma linha. Remove dados pessoais do recibo antes da importação; só são necessários produto, preço, loja e data.

Após importar, sincroniza a app. A pesquisa mostra os novos produtos com origem, data e localização. A comparação mantém um único contexto de loja por cadeia para não somar preços de lojas diferentes no mesmo cabaz. Preços de cartão exigem uma opção explícita na pesquisa; não entram na comparação de preço normal.

## API e validação

`GET /api/supermarkets` distingue registo de cobertura: inclui `usable_prices`, `has_prices`, `last_observed_at`, fontes e método de recolha. `GET /api/products?q=cafe&sort=price_asc&supermarket=froiz` aceita palavras/prefixos sem acentos, marca/código de barras, filtros, ordenação e paginação estáveis. A API usa o índice full-text nativo existente, sem uma segunda cópia indexada dos nomes. A tolerância a pequenos erros de escrita está no índice offline da app.

```bash
scraper/.venv/bin/python -m unittest discover -s scraper/tests
cd api && npm test
cd ../mobile && npm test
```

Para os testes de integração, inicializa bases **isoladas** com `database/init.sql`. `SCRAPER_TEST_DATABASE_URL` ativa persistência Python; `SEARCH_TEST_DATABASE_URL` ativa pesquisa HTTP/PostgreSQL; `SYNC_TEST_DATABASE_URL` ativa paginação e cobertura. Estes testes escrevem dados temporários e não devem apontar para produção. O teste de sync inclui mais de 10.000 alterações e alterações concorrentes durante paginação. A app foi compilada com Metro/Hermes e instalada num dispositivo Android via ADB, onde foram verificados o catálogo, a pesquisa e os detalhes de produto. A sincronização e o histórico em produção precisam de nova verificação após o restauro do servidor; outros dispositivos e testes prolongados de desempenho/memória continuam por validar.
