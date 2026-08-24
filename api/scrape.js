const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const router = express.Router();

// Estado simples em memória dos jobs de scraping
// Limpeza automática: jobs terminados com mais de 1 hora são removidos
const jobs = new Map();
const JOB_MAX_AGE_MS = 60 * 60 * 1000; // 1 hora

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    // NUNCA remover um job 'running': o processo Python detached continua a
    // correr, e apagar o job quebraria o single-flight (isAnyRunning deixaria
    // de o ver, permitindo lançar um segundo scraper concorrente) e faria
    // /status/:id começar a devolver 404. O job sai daqui quando termina.
    if (job.status === 'running') continue;
    const started = new Date(job.started_at).getTime();
    if (now - started > JOB_MAX_AGE_MS) {
      jobs.delete(id);
    }
  }
}

function isAnyRunning() {
  return Array.from(jobs.values()).some((j) => j.status === 'running');
}

// Limpar a cada 10 minutos
setInterval(cleanupOldJobs, 10 * 60 * 1000);

const SCRAPE_SECRET = process.env.SCRAPE_SECRET;

const SCRAPER_DIR = process.env.SCRAPER_DIR || path.resolve(__dirname, '../scraper');
const SCRAPER_PYTHON = process.env.SCRAPER_PYTHON || 'python3';
const VALID_SCRAPERS = ['Continente', 'Lidl', 'PingoDoce', 'Aldi', 'Auchan'];

// POST /api/scrape — dispara uma nova recolha de dados (fresca) em background
// Protegido por SCRAPE_SECRET (opcional) para evitar abuso
router.post('/', (req, res, next) => {
  if (SCRAPE_SECRET) {
    const authHeader = req.headers['x-scrape-secret'];
    if (authHeader !== SCRAPE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized. Provide X-Scrape-Secret header.' });
    }
  }
  next();
}, async (req, res) => {
  // Single-flight: impede pedidos concorrentes de lançarem múltiplos processos
  // Python no contentor (0.5–1Gi no free tier) — evita OOM e killing mútuo.
  if (isAnyRunning()) {
    const current = Array.from(jobs.values()).find((j) => j.status === 'running');
    return res.status(409).json({
      error: 'Já existe uma recolha em curso.',
      running_job_id: current ? current.id : null,
    });
  }

  const { scrapers = [], mode = 'all' } = req.body || {};

  let selected = scrapers;
  if (!Array.isArray(selected) || selected.length === 0) {
    selected = mode === 'all' ? [] : scrapers;
  }
  if (!Array.isArray(selected)) {
    return res.status(400).json({ error: 'Scrapers deve ser uma lista.' });
  }
  const valid = selected.filter((s) => VALID_SCRAPERS.includes(s));
  if (selected.length > 0 && valid.length === 0) {
    return res.status(400).json({
      error: `Scrapers inválidos. Disponíveis: ${VALID_SCRAPERS.join(', ')}`,
    });
  }

  const args = [];
  if (valid.length > 0) {
    args.push('--scraper', valid.join(','));
  }

  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    id: jobId,
    status: 'running',
    scrapers: valid.length > 0 ? valid : VALID_SCRAPERS,
    started_at: new Date().toISOString(),
    finished_at: null,
    log_tail: [],
  });

  const child = spawn(SCRAPER_PYTHON, ['main.py', ...args], {
    cwd: SCRAPER_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: true,
  });
  child.unref();

  let logBuffer = '';
  const pushLog = (chunk) => {
    logBuffer += chunk.toString();
    const lines = logBuffer.split('\n');
    logBuffer = lines.pop() || '';
    const job = jobs.get(jobId);
    if (job) {
      job.log_tail.push(...lines.filter((l) => l.trim()));
      if (job.log_tail.length > 200) {
        job.log_tail = job.log_tail.slice(-200);
      }
    }
  };
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);

  child.on('error', (err) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.finished_at = new Date().toISOString();
      job.error = err.message;
    }
  });

  child.on('close', (code) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = code === 0 ? 'completed' : 'failed';
      job.finished_at = new Date().toISOString();
      job.exit_code = code;
    }
  });

  res.status(202).json({ job_id: jobId, status: 'running', scrapers: valid.length > 0 ? valid : VALID_SCRAPERS });
});

// GET /api/scrape/status/:id — consulta o progresso de um job
router.get('/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado.' });
  }
  res.json(job);
});

// GET /api/scrape/status — estado global + hora persistida da última recolha
router.get('/status', async (req, res) => {
  const summary = Array.from(jobs.values())
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    .slice(0, 10);
  // Os jobs em memória perdem-se num reinício/cold-start do contentor; a hora
  // "real" da última recolha persistida lê-se dos produtos (sobrevive ao idle).
  let last_scrape_at = null;
  try {
    const r = await db.query('SELECT MAX(last_scraped_at) AS v FROM products WHERE deleted = false');
    if (r.rows[0] && r.rows[0].v) last_scrape_at = r.rows[0].v;
  } catch (e) {
    // Sem db disponível — devolve só os jobs em memória.
  }
  res.json({ jobs: summary, last_scrape_at });
});

module.exports = router;
