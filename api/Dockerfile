# Imagem combinada: API Node.js + runtime Python do scraper
# Permite disparar recolhas frescas via POST /api/scrape no mesmo contentor
# (ideal para Azure App Service / Container Apps no plano gratuito).
FROM python:3.12-slim AS python-base

WORKDIR /usr/src/app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Runtime Node.js 20 (versão LTS)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl gnupg ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Dependências do scraper
COPY scraper/requirements.txt /tmp/scraper-requirements.txt
RUN pip install --no-cache-dir -r /tmp/scraper-requirements.txt

# Dependências da API Node.js (npm ci com lockfile → builds reproduzíveis)
COPY api/package.json ./
COPY api/package-lock.json ./
RUN npm ci --omit=dev

# Código
COPY api ./
COPY scraper ./scraper

ENV SCRAPER_DIR=/usr/src/app/scraper
ENV SCRAPER_PYTHON=python
ENV NODE_ENV=production

# Executar como utilizador não privilegiado (segurança: o processo não tem
# permissões de escrita no filesystem, limitando o impacto de uma vulnerabilidade).
RUN useradd --create-home --uid 10001 appuser && \
    chown -R appuser:appuser /usr/src/app
USER appuser

# Healthcheck usado pelo Azure Container Apps (substitui o TCP-only default).
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

EXPOSE 3000
CMD ["npm", "start"]
