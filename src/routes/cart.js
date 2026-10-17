'use strict';

const express = require('express');
const db = require('../db');
const { serializeCartItem, computeTotals, int, httpError } = require('../util');

const router = express.Router();

/** Load the current session's cart and return it in a consistent shape. */
function cartPayload(sessionToken) {
  const rows = db.prepare(`
    SELECT ci.id, ci.product_id, ci.qty, p.name, p.price, p.image, p.stock
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE ci.session_id = ?
    ORDER BY ci.added_at, ci.id
  `).all(sessionToken);

  return {
    items: rows.map(serializeCartItem),
    totals: computeTotals({ items: rows.map((r) => ({ price: r.price, qty: r.qty })) }),
    count: rows.reduce((sum, r) => sum + r.qty, 0),
  };
}

// GET /api/cart
router.get('/cart', (req, res) => {
  res.json(cartPayload(req.sessionToken));
});

// POST /api/cart  { productId, qty? }  — adds to the existing quantity
router.post('/cart', (req, res) => {
  const productId = int(req.body.productId, { field: 'Product' });
  const qty = req.body.qty === undefined ? 1 : int(req.body.qty, { min: 1, max: 99, field: 'Quantity' });

  const product = db.prepare('SELECT id, stock, active FROM products WHERE id = ?').get(productId);
  if (!product || !product.active) throw httpError(404, 'That product is not available.');

  const existing = db.prepare('SELECT * FROM cart_items WHERE session_id = ? AND product_id = ?')
    .get(req.sessionToken, productId);
  const nextQty = Math.min(99, (existing ? existing.qty : 0) + qty);

  if (nextQty > product.stock) throw httpError(409, `Only ${product.stock} left in stock.`);

  if (existing) {
    db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(nextQty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (session_id, product_id, qty) VALUES (?, ?, ?)')
      .run(req.sessionToken, productId, nextQty);
  }

  res.status(201).json(cartPayload(req.sessionToken));
});

// PATCH /api/cart/:productId  { qty }  — sets an absolute quantity (0 removes)
router.patch('/cart/:productId', (req, res) => {
  const productId = Number(req.params.productId);
  const qty = int(req.body.qty, { min: 0, max: 99, field: 'Quantity' });

  const line = db.prepare('SELECT * FROM cart_items WHERE session_id = ? AND product_id = ?')
    .get(req.sessionToken, productId);
  if (!line) throw httpError(404, 'That item is not in your cart.');

  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(line.id);
  } else {
    const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(productId);
    if (product && qty > product.stock) throw httpError(409, `Only ${product.stock} left in stock.`);
    db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(qty, line.id);
  }

  res.json(cartPayload(req.sessionToken));
});

// DELETE /api/cart/:productId
router.delete('/cart/:productId', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE session_id = ? AND product_id = ?')
    .run(req.sessionToken, Number(req.params.productId));
  res.json(cartPayload(req.sessionToken));
});

// DELETE /api/cart
router.delete('/cart', (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE session_id = ?').run(req.sessionToken);
  res.json(cartPayload(req.sessionToken));
});

module.exports = router;
module.exports.cartPayload = cartPayload;
