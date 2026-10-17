'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { serializeProduct, str, int, httpError } = require('../util');
const { loadOrder, loadItems } = require('./orders');

const router = express.Router();

router.use(requireAdmin);

const BASE = `
  SELECT p.*, c.name AS category, c.slug AS category_slug
  FROM products p JOIN categories c ON c.id = p.category_id
`;

/* ------------------------------ products ---------------------------- */

// GET /api/admin/products — includes archived rows
router.get('/products', (req, res) => {
  const rows = db.prepare(`${BASE} ORDER BY p.id ASC`).all();
  res.json({ products: rows.map(serializeProduct) });
});

function readProduct(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (has('name') || !partial) out.name = str(body.name, { min: 2, max: 160, field: 'Name' });
  if (has('description') || !partial) out.description = body.description ? str(body.description, { min: 0, max: 1000, field: 'Description' }) : null;
  if (has('price') || !partial) out.price = int(body.price, { min: 0, max: 10_000_000, field: 'Price' });
  if (has('compareAt')) out.compare_at = body.compareAt === null || body.compareAt === '' ? null : int(body.compareAt, { min: 0, max: 10_000_000, field: 'Compare-at price' });
  else if (!partial) out.compare_at = null;
  if (has('rating') || !partial) out.rating = Math.max(0, Math.min(5, Number(body.rating ?? 0) || 0));
  if (has('reviews') || !partial) out.reviews = Math.max(0, int(body.reviews ?? 0, { min: 0, max: 10_000_000, field: 'Reviews' }));
  if (has('badge')) out.badge = body.badge ? str(body.badge, { min: 1, max: 40, field: 'Badge' }) : null;
  else if (!partial) out.badge = null;
  if (has('image') || !partial) out.image = str(body.image, { min: 3, max: 200, field: 'Image' });
  if (has('stock') || !partial) out.stock = int(body.stock ?? 0, { min: 0, max: 1_000_000, field: 'Stock' });
  if (has('active')) out.active = body.active ? 1 : 0;

  if (has('categoryId') || has('category') || !partial) {
    let categoryId = null;
    if (body.categoryId !== undefined) categoryId = Number(body.categoryId);
    else if (body.category) {
      const c = db.prepare('SELECT id FROM categories WHERE slug = ? OR name = ?').get(String(body.category), String(body.category));
      categoryId = c ? c.id : null;
    }
    if (!categoryId || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) {
      throw httpError(400, 'Choose a valid category.');
    }
    out.category_id = categoryId;
  }
  return out;
}

// POST /api/admin/products
router.post('/products', (req, res) => {
  const data = readProduct(req.body);
  const info = db.prepare(`
    INSERT INTO products (name, category_id, price, compare_at, rating, reviews, badge, image, description, stock, active)
    VALUES (@name, @category_id, @price, @compare_at, @rating, @reviews, @badge, @image, @description, @stock, @active)
  `).run({ active: 1, ...data });
  const row = db.prepare(`${BASE} WHERE p.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ product: serializeProduct(row) });
});

// PUT /api/admin/products/:id
router.put('/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw httpError(404, 'Product not found.');

  const data = readProduct(req.body, { partial: true });
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...data, id });
  }
  res.json({ product: serializeProduct(db.prepare(`${BASE} WHERE p.id = ?`).get(id)) });
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) throw httpError(404, 'Product not found.');
  res.json({ ok: true });
});

/* ------------------------------- orders ----------------------------- */

// GET /api/admin/orders
router.get('/orders', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? db.prepare('SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status = ? ORDER BY o.id DESC').all(status)
    : db.prepare('SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC').all();
  res.json({ orders: rows.map((r) => loadOrder(r.id)) });
});

// PATCH /api/admin/orders/:id  { status }
router.patch('/orders/:id', (req, res) => {
  const allowed = ['confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
  const status = str(req.body.status, { min: 2, max: 20, field: 'Status' }).toLowerCase();
  if (!allowed.includes(status)) throw httpError(400, `Status must be one of: ${allowed.join(', ')}.`);
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!info.changes) throw httpError(404, 'Order not found.');
  res.json({ order: loadOrder(Number(req.params.id)) });
});

/* -------------------------------- stats ----------------------------- */

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const products = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n;
  const orders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const revenue = db.prepare("SELECT IFNULL(SUM(total), 0) AS n FROM orders WHERE status != 'cancelled'").get().n;
  const customers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0').get().n;
  const lowStock = db.prepare('SELECT id, name, stock FROM products WHERE stock <= 20 AND active = 1 ORDER BY stock ASC').all();
  const recent = db.prepare('SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 5').all();
  res.json({
    stats: { products, orders, revenue, customers },
    lowStock,
    recentOrders: recent.map((r) => ({ orderNo: r.order_no, total: r.total, status: r.status, email: r.email, createdAt: r.created_at })),
  });
});

module.exports = router;
