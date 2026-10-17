'use strict';

const express = require('express');
const db = require('../db');
const { serializeProduct, httpError } = require('../util');

const router = express.Router();

const BASE = `
  SELECT p.*, c.name AS category, c.slug AS category_slug
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

const SORTS = {
  featured: 'p.id ASC',
  'price-asc': 'p.price ASC',
  'price-desc': 'p.price DESC',
  rating: 'p.rating DESC',
  newest: 'p.created_at DESC, p.id DESC',
};

// GET /api/categories
router.get('/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.slug, COUNT(p.id) AS count
    FROM categories c
    LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
    GROUP BY c.id ORDER BY c.id
  `).all();
  res.json({ categories: rows });
});

// GET /api/products?category=&q=&badge=&sort=
router.get('/products', (req, res) => {
  const where = ['p.active = 1'];
  const params = {};

  if (req.query.category && req.query.category !== 'all') {
    where.push('c.slug = @category');
    params.category = String(req.query.category);
  }
  if (req.query.badge) {
    where.push('p.badge = @badge');
    params.badge = String(req.query.badge);
  }
  if (req.query.q) {
    where.push('(p.name LIKE @q OR c.name LIKE @q OR IFNULL(p.description, \'\') LIKE @q)');
    params.q = `%${String(req.query.q).replace(/[%_]/g, '')}%`;
  }

  const order = SORTS[req.query.sort] || SORTS.featured;
  const rows = db.prepare(`${BASE} WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(params);
  res.json({ products: rows.map(serializeProduct), count: rows.length });
});

// GET /api/products/:id
router.get('/products/:id', (req, res) => {
  const row = db.prepare(`${BASE} WHERE p.id = ?`).get(Number(req.params.id));
  if (!row || !row.active) throw httpError(404, 'Product not found.');
  res.json({ product: serializeProduct(row) });
});

module.exports = router;
