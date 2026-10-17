'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const {
  str, email, phone, pin, httpError,
  validatePayment, computeTotals, serializeOrder,
  PROMOS, DELIVERY_SPEEDS,
} = require('../util');

const router = express.Router();

function loadItems(orderId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
}

function loadOrder(orderId) {
  const row = db.prepare('SELECT o.*, u.name AS user_name FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(orderId);
  return row ? serializeOrder(row, loadItems(row.id)) : null;
}

function makeOrderNo() {
  const year = new Date().getFullYear();
  let orderNo;
  do {
    orderNo = `NB-${year}-${Math.floor(100000 + Math.random() * 900000)}`;
  } while (db.prepare('SELECT 1 FROM orders WHERE order_no = ?').get(orderNo));
  return orderNo;
}

// POST /api/orders — the checkout. Prices and totals are computed from the
// database, never from the request body.
router.post('/orders', (req, res) => {
  const lines = db.prepare(`
    SELECT ci.product_id, ci.qty, p.name, p.image, p.price, p.stock, p.active
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.session_id = ?
    ORDER BY ci.added_at, ci.id
  `).all(req.sessionToken);

  if (!lines.length) throw httpError(400, 'Your cart is empty.');

  const customerName = str(req.body.name, { min: 2, max: 120, field: 'Name' });
  const customerEmail = email(req.body.email);
  const customerPhone = phone(req.body.phone);
  const line1 = str(req.body.line1, { min: 4, max: 200, field: 'Address' });
  const city = str(req.body.city, { min: 2, max: 80, field: 'City' });
  const state = str(req.body.state, { min: 2, max: 80, field: 'State' });
  const pinCode = pin(req.body.pin);

  const deliverySpeed = DELIVERY_SPEEDS.includes(req.body.deliverySpeed) ? req.body.deliverySpeed : 'standard';
  const paymentMethod = validatePayment(req.body.paymentMethod, req.body);

  const promoRaw = req.body.promo ? String(req.body.promo).trim().toUpperCase() : null;
  const promo = promoRaw && PROMOS[promoRaw] ? promoRaw : null;

  for (const l of lines) {
    if (!l.active) throw httpError(409, `${l.name} is no longer available.`);
    if (l.qty > l.stock) throw httpError(409, `Only ${l.stock} left of ${l.name}.`);
  }

  const totals = computeTotals({
    items: lines.map((l) => ({ price: l.price, qty: l.qty })),
    promo, deliverySpeed, paymentMethod,
  });

  const orderNo = makeOrderNo();

  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO orders (
        order_no, user_id, email, subtotal, discount, shipping, cod_fee, total,
        promo, payment_method, delivery_speed, status,
        ship_name, ship_phone, ship_line1, ship_city, ship_state, ship_pin
      ) VALUES (
        @order_no, @user_id, @email, @subtotal, @discount, @shipping, @cod_fee, @total,
        @promo, @payment_method, @delivery_speed, 'confirmed',
        @ship_name, @ship_phone, @ship_line1, @ship_city, @ship_state, @ship_pin
      )
    `).run({
      order_no: orderNo,
      user_id: req.user ? req.user.id : null,
      email: customerEmail,
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      cod_fee: totals.codFee,
      total: totals.total,
      promo,
      payment_method: paymentMethod,
      delivery_speed: deliverySpeed,
      ship_name: customerName,
      ship_phone: customerPhone,
      ship_line1: line1,
      ship_city: city,
      ship_state: state,
      ship_pin: pinCode,
    });

    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, image, price, qty) VALUES (?, ?, ?, ?, ?, ?)');
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const l of lines) {
      insertItem.run(orderId, l.product_id, l.name, l.image, l.price, l.qty);
      decStock.run(l.qty, l.product_id);
    }
    db.prepare('DELETE FROM cart_items WHERE session_id = ?').run(req.sessionToken);
    return orderId;
  });

  const orderId = create();

  // Optionally remember this address for signed-in shoppers.
  if (req.user && req.body.saveAddress) {
    db.prepare(`
      INSERT INTO addresses (user_id, label, name, phone, line1, city, state, pin, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(req.user.id, 'Delivery', customerName, customerPhone, line1, city, state, pinCode);
  }

  res.status(201).json({ order: loadOrder(orderId) });
});

// GET /api/orders — the signed-in customer's order history
router.get('/orders', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, u.name AS user_name FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.user_id = ? ORDER BY o.id DESC
  `).all(req.user.id);
  res.json({ orders: rows.map((r) => serializeOrder(r, loadItems(r.id))) });
});

// GET /api/orders/:orderNo
router.get('/orders/:orderNo', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(String(req.params.orderNo));
  if (!row) throw httpError(404, 'Order not found.');
  if (row.user_id !== req.user.id && !req.user.is_admin) throw httpError(403, 'You cannot view that order.');
  res.json({ order: serializeOrder(row, loadItems(row.id)) });
});

module.exports = router;
module.exports.loadOrder = loadOrder;
module.exports.loadItems = loadItems;
