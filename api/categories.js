const express = require('express');
const router = express.Router();
const db = require('./db');

// GET /api/categories — categorias canónicas com contagem de produtos ativos
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.slug, c.sort_order, COUNT(p.id) AS product_count
       FROM canonical_categories c
       LEFT JOIN products p ON p.category_id = c.id
        AND p.deleted = false AND p.in_stock = true
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Categories error:', error);
    res.status(500).json({ error: 'Unable to fetch categories.' });
  }
});

module.exports = router;
