const express = require('express');
const path = require('path');
const db = require('./db');
const retailers = require(path.join(process.env.SCRAPER_DIR || path.resolve(__dirname, '../scraper'), 'retailers.json'));
const router = express.Router();

// Registration is distinct from data coverage. A chain with no observations
// reports zero usable prices instead of pretending to have a live catalogue.
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.id, s.name, s.slug,
        COUNT(p.id) FILTER (WHERE NOT p.deleted AND p.in_stock AND p.price > 0
          AND NOT p.requires_loyalty_card
          AND (p.valid_from IS NULL OR p.valid_from <= now())
          AND (p.valid_to IS NULL OR p.valid_to >= now()))::int AS usable_prices,
        MAX(p.observed_at) AS last_observed_at,
        array_remove(array_agg(DISTINCT p.source_type), NULL) AS sources
      FROM supermarkets s LEFT JOIN products p ON p.supermarket_id = s.id
      GROUP BY s.id ORDER BY s.name`);
    res.json(result.rows.map(row => {
      const source = retailers.find(retailer => retailer.slug === row.slug);
      return { ...source, ...row, has_prices: row.usable_prices > 0 };
    }));
  } catch (error) {
    console.error('Supermarket coverage error:', error);
    res.status(500).json({ error: 'Unable to fetch supermarket coverage.' });
  }
});

module.exports = router;
