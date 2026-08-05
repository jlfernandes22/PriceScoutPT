#!/usr/bin/env bash
# =============================================================================
# Deploy PriceScoutPT para o Azure (100% no plano gratuito)
#
# Requisitos:
#   1. Azure CLI instalado e autenticado: az login
#   2. Assinatura ativa com elegibilidade para os planos gratuitos:
#      - Azure Container Apps (Free plan)  -> contentores gratuitos
#      - Azure Database for PostgreSQL Flexible Server (Free tier)
#   3. Docker instalado para construir e publicar a imagem
#
# Uso:
#   ./deploy.sh <resource-group> <region> <image-name>
#
# Exemplo:
#   ./deploy.sh pricescoutpt-rg westeurope pricescoutpt/api:v1
#
# Nota: a imagem é publicada no Docker Hub (login via `docker login`).
# =============================================================================
set -euo pipefail

RG="${1:-pricescoutpt-rg}"
REGION="${2:-westeurope}"
IMAGE="${3:-pricescoutpt/api:v1}"
DB_NAME="${4:-pricescoutpt-db}"
CA_NAME="${5:-pricescoutpt-api}"

DB_ADMIN="pricescoutadmin"
DB_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
SCRAPE_SECRET="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
DB_CONN=""

# O comando 'az containerapp' passa por uma extensão — verifica/instala.
echo "==> [0/5] A garantir a extensão Azure Container Apps"
az extension add --name containerapp --only-show-errors --yes 2>/dev/null \
  || az extension show -n containerapp -o none 2>/dev/null

echo "==> [1/5] A criar grupo de recursos: $RG ($REGION)"
az group create --name "$RG" --location "$REGION" -o none

echo "==> [2/5] A criar PostgreSQL Flexible Server (Free tier) + base de dados"
az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$DB_NAME" \
  --location "$REGION" \
  --admin-user "$DB_ADMIN" \
  --admin-password "$DB_PASSWORD" \
  --tier Burstable \
  --sku-name Standard_B1ms \
  --storage-size 32 \
  --public-access any \
  --version 15 \
  -o none || echo "    (Se o free tier não estiver disponível, crie o servidor manualmente e passe DATABASE_URL)"

DB_HOST="$(az postgres flexible-server show -g "$RG" -n "$DB_NAME" --query fullyQualifiedDomainName -o tsv)"
DB_CONN="postgres://${DB_ADMIN}:${DB_PASSWORD}@${DB_HOST}:5432/postgres"

echo "==> [3/5] A aplicar o schema (database/init.sql)"
az postgres flexible-server execute \
  --name "$DB_NAME" \
  --resource-group "$RG" \
  --admin-user "$DB_ADMIN" \
  --admin-password "$DB_PASSWORD" \
  --file-path "$(dirname "$0")/../../database/init.sql" -o none

echo "==> [4/5] A construir e publicar a imagem no Docker Hub"
cd "$(dirname "$0")/../.."
docker build -f api/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"

echo "==> [5/5] A criar o Container App (plan gratuito / consumption)"
az containerapp create \
  --name "$CA_NAME" \
  --resource-group "$RG" \
  --environment "$RG-env" \
  --image "$IMAGE" \
  --cpu 0.5 \
  --memory 1.0Gi \
  --min-replicas 0 \
  --max-replicas 1 \
  --env-vars \
    "DATABASE_URL=$DB_CONN" \
    "PORT=3000" \
    "SCRAPER_DIR=/usr/src/app/scraper" \
    "SCRAPER_PYTHON=python" \
    "SCRAPE_SECRET=$SCRAPE_SECRET" \
    "NODE_ENV=production" \
  --ingress external \
  --target-port 3000 \
  --transport auto \
  -o none

echo ""
echo "==========================================================================="
echo " Deploy concluído!"
echo "==========================================================================="
echo " Base de dados:      $DB_HOST"
echo " URL da API:         $(az containerapp show -g "$RG" -n "$CA_NAME" --query properties.configuration.ingress.fqdn -o tsv)"
echo " DATABASE_URL:       $DB_CONN"
echo " SCRAPE_SECRET:      $SCRAPE_SECRET"
echo ""
echo " Guarde a password da base de dados! ($DB_PASSWORD)"
echo " Nota: o endpoint POST /api/scrape exige o header 'x-scrape-secret' com"
echo " o SCRAPE_SECRET acima (o botão 'Atualizar Agora' da app envia-o se "
echo " configurado em mobile/app.json -> expo.extra.scrapeSecret). Se não quiser"
echo " proteger o endpoint, remova a variável SCRAPE_SECRET do container."
echo " Dica: no ficheiro mobile/app.json defina expo.extra.apiBaseUrl"
echo " para a URL da API (https://...) antes de gerar o APK."
echo "==========================================================================="
