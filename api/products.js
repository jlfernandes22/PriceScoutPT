const express = require('express');
const router = express.Router();
const db = require('./db');
const { InvalidProductQuery, parseProductQuery, buildProductQuery } = require('./product-search');

// Both endpoints retain the array response consumed by existing clients.
// /compare accepts the original name= parameter; q= works on both endpoints.
function listProducts(requireSearch) {
  return async (req, res) => {
    try {
      const options = parseProductQuery(req.query, requireSearch);
      if (options.hasSearch && !options.text) return res.json([]);
      const query = buildProductQuery(options);
      const result = await db.query(query.text, query.params);
      res.setHeader('X-Result-Limit', options.limit);
      res.setHeader('X-Result-Offset', options.offset);
      return res.json(result.rows);
    } catch (error) {
      if (error instanceof InvalidProductQuery) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Products search error:', error);
      return res.status(500).json({ error: 'Unable to fetch products.' });
    }
  };
}

router.get('/compare', listProducts(true));
router.get('/', listProducts(false));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  // Um id não-UUID (ex: "/api/products/foo") faria o PostgreSQL lançar o erro
  // 22P02 (invalid input syntax for type uuid) — melhor responder 404 direto.
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  try {
    const productResult = await db.query(
      `SELECT id, supermarket_id, category_id, external_id, name, brand, description,
              price, price_currency, unit, url, image_url, in_stock, deleted,
              barcode, regular_price, unit_price, unit_price_unit,
              source_type, source_url, store_location, observed_at, last_scraped_at,
              requires_loyalty_card, valid_from, valid_to, metadata,
              created_at, updated_at
       FROM products
       WHERE id = $1`,
      [id]
    );

    if (!productResult.rows.length) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const historyResult = await db.query(
      `SELECT id, price, price_currency, recorded_at
       FROM price_history
       WHERE product_id = $1
         AND recorded_at >= now() - INTERVAL '30 days'
         AND price > 0
       ORDER BY recorded_at DESC`,
      [id]
    );

    res.json({
      ...productResult.rows[0],
      price_history: historyResult.rows,
    });
  } catch (error) {
    console.error('Product lookup error:', error);
    res.status(500).json({ error: 'Unable to fetch product.' });
  }
});

module.exports = router;
