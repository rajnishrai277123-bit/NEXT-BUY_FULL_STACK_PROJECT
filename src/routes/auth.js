'use strict';

const express = require('express');
const db = require('../db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  setSessionCookie, clearSessionCookie, requireAuth,
} = require('../auth');
const { str, email, phone, pin, int, httpError } = require('../util');

const router = express.Router();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, isAdmin: !!u.is_admin });

/* ------------------------------- auth ------------------------------- */

// POST /api/auth/register
router.post('/auth/register', (req, res) => {
  const name = str(req.body.name, { min: 2, max: 120, field: 'Name' });
  const mail = email(req.body.email);
  const password = str(req.body.password, { min: 8, max: 200, field: 'Password' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    throw httpError(409, 'An account with that email already exists.');
  }

  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, mail, hashPassword(password));

  // Promote the current guest session so any cart contents carry over.
  db.prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(info.lastInsertRowid, req.sessionToken);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
  const mail = email(req.body.email);
  const password = str(req.body.password, { min: 1, max: 200, field: 'Password' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw httpError(401, 'Incorrect email or password.');
  }

  db.prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(user.id, req.sessionToken);
  res.json({ user: publicUser(user) });
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  const fresh = createSession(null);
  setSessionCookie(res, fresh);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/auth/me', (req, res) => {
  res.json({ user: req.user ? publicUser({ ...req.user, is_admin: req.user.is_admin }) : null });
});

/* ----------------------------- addresses ---------------------------- */

// GET /api/addresses
router.get('/addresses', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
  res.json({ addresses: rows });
});

// POST /api/addresses
router.post('/addresses', requireAuth, (req, res) => {
  const data = readAddress(req.body);
  const info = db.prepare(`
    INSERT INTO addresses (user_id, label, name, phone, line1, city, state, pin, is_default)
    VALUES (@user_id, @label, @name, @phone, @line1, @city, @state, @pin, @is_default)
  `).run({ ...data, user_id: req.user.id });
  res.status(201).json({ address: db.prepare('SELECT * FROM addresses WHERE id = ?').get(info.lastInsertRowid) });
});

// DELETE /api/addresses/:id
router.delete('/addresses/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!info.changes) throw httpError(404, 'Address not found.');
  res.json({ ok: true });
});

function readAddress(body) {
  return {
    label: body.label ? str(body.label, { min: 1, max: 40, field: 'Label' }) : null,
    name: str(body.name, { min: 2, max: 120, field: 'Name' }),
    phone: phone(body.phone),
    line1: str(body.line1, { min: 4, max: 200, field: 'Address' }),
    city: str(body.city, { min: 2, max: 80, field: 'City' }),
    state: str(body.state, { min: 2, max: 80, field: 'State' }),
    pin: pin(body.pin),
    is_default: body.isDefault ? 1 : 0,
  };
}

module.exports = router;
