# Operação do backend no Azure

Atualizado em **29/10/2026**. Configuração prevista: Azure Container Apps em Consumption, 0,5 CPU / 1 GiB, `min-replicas 0`, `max-replicas 1`, e PostgreSQL Flexible Server B1ms. As contagens de produtos e as datas de recolha devem ser consultadas em `GET /api/stats`; uma cópia offline no telemóvel não prova que o servidor está disponível.

## Recolha diária e manual

O workflow `.github/workflows/daily-scrape.yml` executa os seis coletores HTTP **diretamente no runner do GitHub Actions** e grava no PostgreSQL usando o secret `PRICESCOUTPT_DATABASE_URL`. Não faz pedidos ao endpoint de scraping da API. Corre às **12:00 UTC**: 12:00 em Portugal continental no inverno, 13:00 no verão.

A recolha diária consulta até 100 páginas públicas de detalhe por coletor. Em *Run workflow* podes escolher todos os seis, um coletor individual ou `Froiz,Aldi`, e ajustar o limite de detalhes. O Intermarché continua opcional fora deste workflow, porque exige browser e a fonte tem restrições documentadas em [retailer-sources.md](retailer-sources.md).

As execuções manuais e agendadas usam o mesmo grupo de concorrência e não cancelam uma execução em curso. O limite de duração é 180 minutos. Uma recolha parcial pode guardar observações válidas, mas não retira os produtos ausentes. O workflow não recebe credenciais de webhooks nem envia mensagens para Slack/Discord.

O acesso à firewall usa OIDC em `azure/login@v2`, com a identidade `pricescoutpt-github` autorizada apenas para a branch `main` de `jlfernandes22/PriceScoutPT`. A identidade tem leitura do servidor e leitura/criação/remoção de regras de firewall, com atribuição limitada ao servidor PostgreSQL deste projeto; não tem permissões de escrita no servidor nem acesso aos dados por RBAC. A ligação SQL continua no secret `PRICESCOUTPT_DATABASE_URL`.

As variáveis não secretas `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` e `AZURE_POSTGRES_SERVER` configuram esse acesso. Executa os disparos manuais na branch `main`. O runner descobre e valida o seu IPv4 público, cria a regra `gh-<run_id>-<run_attempt>` com início e fim nesse único endereço e aguarda a propagação antes de recolher. Um passo com `always()` remove a regra no fim, mesmo se a recolha falhar, com três tentativas. Uma interrupção abrupta do runner pode impedir a limpeza; nesse caso remove apenas a regra da execução terminada, depois de confirmar o estado no GitHub. Não é necessária uma regra que permita toda a Internet para os runners.

`POST /api/scrape` permite disparos manuais ocasionais no contentor. O bloqueio em memória desse endpoint impede jobs concorrentes no mesmo processo da API; é independente da concorrência do GitHub Actions. Não o uses enquanto o workflow estiver a recolher. Recolhas longas devem correr no runner, pois um contentor com escala-a-zero pode ser interrompido.

`GET /api/scrape/status` mostra jobs do processo atual e a data persistida `MAX(last_scraped_at)`. Os jobs em memória desaparecem num reinício; a data persistida não comprova que todos os coletores terminaram sem erros. Para o resultado completo, consulta o job do workflow.

## API e sincronização

A app não dispara recolhas nem faz polling contínuo. Ao abrir o painel, consulta o estado da última recolha; ao sincronizar, recebe produtos em lotes de 5.000. As alterações e remoções também são paginadas.

| Rota | Limite por minuto e IP |
| --- | --- |
| `/api/sync` | 600 |
| `/api/products`, `/api/categories` | 300 |
| `/api/scrape/status` | 300 |
| `/api/scrape` | 20 |
| Restantes rotas | 600 |

O pool da API permite até 10 ligações, com timeout de ligação de 10 segundos. O scraper usa ligações separadas. Verifica `SHOW max_connections` no servidor escolhido antes de aumentar réplicas ou executar recolhas concorrentes.

Para uma atualização existente, aplica as migrações com uma cópia de segurança e sem recolhas/sincronizações em curso, seguindo [data-collection.md](data-collection.md). Guarda a imagem/revisão anterior para poder reverter a API. As migrações 003/004 acrescentam campos e funções; reverter a imagem não exige apagar esses campos.

Depois do deploy, verifica `GET /api/health` e confirma **`db: "up"`** no JSON; o endpoint pode devolver HTTP 200 mesmo com `db: "down"`. Confirma também pesquisa, cobertura (`/api/supermarkets`), detalhes e sincronização paginada, e volta a testar sincronização/histórico no telemóvel.

## Custos e configuração mínima

O [plano Consumption](https://learn.microsoft.com/en-us/azure/container-apps/billing) inclui mensalmente, por subscrição, 180.000 vCPU-segundos, 360.000 GiB-segundos e 2 milhões de pedidos. Estes limites são partilhados com outros recursos elegíveis da subscrição; consumos acima dos limites podem ser cobrados. `min-replicas 0` reduz consumo sem tráfego. Manter uma réplica permanente pode ultrapassar essas franquias.

A oferta [Azure for Students](https://azure.microsoft.com/en-us/free/students/) anuncia, durante 12 meses, 750 horas de PostgreSQL B1ms, 32 GB de armazenamento e 32 GB de backups. Confirma a elegibilidade e o período restante na subscrição antes de assumir custo zero. Outras configurações, excesso de utilização e serviços adicionais podem consumir crédito ou gerar custos.

Para uma instalação pequena, evita alta disponibilidade, perfis Dedicated e recursos acessórios sem necessidade. Um ambiente criado com `--logs-destination none` não cria um workspace Log Analytics para os logs da aplicação; os logs persistentes ficam indisponíveis nessa configuração. A disponibilidade de regiões/SKUs deve ser verificada na subscrição no momento da criação.

Os scrapers correm em GitHub Actions; o respetivo consumo de minutos depende da duração real e do plano/visibilidade do repositório. Não é apenas um pedido HTTP por dia.

## Segredos

Guarda a ligação do PostgreSQL como secret do Container App e do GitHub Actions; nunca a escrevas em logs ou commits. Configura `SCRAPE_SECRET` para proteger o endpoint manual: sem essa variável, a proteção desse endpoint é opcional no código atual. A app não precisa desse segredo para consultar ou sincronizar.

Os endpoints de leitura são públicos. `mobile/app.config.local.json` continua ignorado pelo Git e permite configurar a URL do backend durante a compilação; o servidor também pode ser alterado nas definições da app.
