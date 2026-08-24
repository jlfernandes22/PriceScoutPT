const express = require('express');
const compression = require('compression');
const cors = require('cors');
const syncRouter = require('./sync');
const productsRouter = require('./products');
const categoriesRouter = require('./categories');
const scrapeRouter = require('./scrape');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '256kb' }));
// Gzip: o /api/sync devolve lotes de ~5000 produtos por resposta — comprimir
// reduz a egress no free tier e o tempo de sync no telemóvel (JSON comprime
// muito bem, tipicamente ~10x). O OkHttp do Android descomprime transparentemente.
app.use(compression());

// Log estruturado de pedidos para observabilidade (método, caminho, status,
// duração). Em produção o stdout é capturado pelos logs do container da Azure.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
});

// A API corre atrás do proxy de ingress do Azure Container Apps. Sem isto, o
// req.ip devolve sempre o IP do proxy (não o do cliente), o que faria com que o
// rate-limit e a política de segurança tratassem TODOS os utilizadores como um
// só — tornando a proteção por IP inócua e agregando todos num único balde.
// 'trust proxy' = 1 confia apenas no primeiro hop (o proxy da Azure), sem abrir
// portas a spoofing de headers de clientes remotos.
app.set('trust proxy', 1);

// Cabeçalhos de segurança (sem dependência extra de helmet)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // HSTS apenas em HTTPS (não no http de dev local para não corromper o setup)
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }
  next();
});

// Limitador de taxa simples por IP (janela fixa) para proteger o free tier de
// loops/bots/aplicações com bugs. Generoso para não afetar utilizadores reais
// (uma sincronização completa faz ~12 pedidos em sequência rápida).
// A correspondência é por PREFIXO e ordenada do mais específico para o menos
// específico, para que /api/products/:id e /api/scrape/status/:id recebam o
// limite pretendido (o req.path exato nunca coincide nesses casos).
const RATE_LIMITS = [
  { prefix: '/api/scrape/status', windowMs: 60000, max: 300 },
  { prefix: '/api/scrape', windowMs: 60000, max: 20 },
  { prefix: '/api/sync', windowMs: 60000, max: 600 },
  { prefix: '/api/products', windowMs: 60000, max: 300 },
  { prefix: '/api/categories', windowMs: 60000, max: 300 },
];
const DEFAULT_RATE_LIMIT = { prefix: 'default', windowMs: 60000, max: 600 };
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();

app.use((req, res, next) => {
  const now = Date.now();
  // Balde por IP+rota: sem a rota na chave, a contagem acumula entre endpoints
  // e um limite baixo (ex: POST /api/scrape, max 20) disparava 429 só porque o
  // mesmo IP já tinha feito pedidos a outras rotas.
  const cfg =
    RATE_LIMITS.find((r) => req.path.startsWith(r.prefix)) || DEFAULT_RATE_LIMIT;
  const key = `${req.ip || 'unknown'}:${cfg.prefix}`;
  const bucket = hits.get(key) || { start: now, count: 0 };
  if (now - bucket.start > cfg.windowMs) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  hits.set(key, bucket);
  if (bucket.count > cfg.max) {
    res.setHeader('Retry-After', Math.ceil(cfg.windowMs / 1000));
    return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
  }
  res.setHeader('X-RateLimit-Limit', cfg.max);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, cfg.max - bucket.count));
  next();
});

app.use('/api/sync', syncRouter);
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/scrape', scrapeRouter);

app.get('/api/health', async (req, res) => {
  // Health check real: além de provar que o processo está vivo, reporta o estado
  // da ligação à BD (usado pelos probes/liveness do Azure Container Apps).
  let db = 'unknown';
  try {
    const dbmod = require('./db');
    await dbmod.query('SELECT 1');
    db = 'up';
  } catch (e) {
    db = 'down';
    console.error('Health check db error:', e.message);
  }
  res.json({ status: 'ok', db, timestamp: new Date().toISOString() });
});

app.get('/api/stats', async (req, res) => {
  try {
    const db = require('./db');
    const counts = await db.query(
      `SELECT s.name, s.slug,
              COUNT(p.id) FILTER (WHERE p.deleted = false AND p.in_stock = true) AS active_products,
              MAX(p.last_scraped_at) AS last_scraped_at
       FROM supermarkets s
       LEFT JOIN products p ON p.supermarket_id = s.id
       GROUP BY s.id
       ORDER BY s.name`
    );
    const categories = await db.query(
      `SELECT COUNT(*) AS total FROM canonical_categories`
    );
    res.json({
      supermarkets: counts.rows,
      total_categories: categories.rows[0].total,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Unable to fetch stats.' });
  }
});

const port = process.env.PORT || 3000;

// 404 JSON + handler de erros central (evita respostas HTML cruas a pedidos de
// rotas desconhecidas e garante que erros não intencionais devolvem 500 JSON).
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  // Erros com status próprio (ex: JSON malformado do express.json → 400) não
  // devem ser mascarados como 500.
  const status = err.status || err.statusCode || 500;
  const message =
    status < 500 ? 'Invalid request.' : 'Internal server error.';
  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`PriceScoutPT API listening on port ${port}`);
});
