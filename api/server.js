const express = require('express');
const cors = require('cors');
const syncRouter = require('./sync');
const productsRouter = require('./products');
const categoriesRouter = require('./categories');
const scrapeRouter = require('./scrape');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

// Cabeçalhos de segurança básicos (sem dependência extra de helmet)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Limitador de taxa simples por IP (janela fixa) para proteger o free tier de
// loops/bots/aplicações com bugs. Generoso para não afetar utilizadores reais
// (uma sincronização completa faz ~12 pedidos em sequência rápida).
const RATE_LIMITS = {
  '/api/sync': { windowMs: 60000, max: 600 },
  '/api/products': { windowMs: 60000, max: 300 },
  '/api/categories': { windowMs: 60000, max: 300 },
  '/api/scrape': { windowMs: 60000, max: 20 },
  DEFAULT: { windowMs: 60000, max: 600 },
};
const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();

app.use((req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const cfg = RATE_LIMITS[req.path] || RATE_LIMITS.DEFAULT;
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.listen(port, () => {
  console.log(`PriceScoutPT API listening on port ${port}`);
});
