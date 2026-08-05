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

# Dependências da API Node.js
COPY api/package.json ./
RUN npm install --production

# Código
COPY api ./
COPY scraper ./scraper

ENV SCRAPER_DIR=/usr/src/app/scraper
ENV SCRAPER_PYTHON=python
ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]
