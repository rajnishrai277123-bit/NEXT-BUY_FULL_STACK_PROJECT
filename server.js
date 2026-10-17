'use strict';

// Load .env before anything reads process.env
require('./src/env');

const path = require('path');
const express = require('express');
const { attachSession } = require('./src/auth');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Static assets first, so image/CSS requests don't spin up sessions.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Every API request gets a session (guest sessions are created on demand).
app.use('/api', attachSession);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n });
});

app.use('/api', require('./src/routes/catalog'));
app.use('/api', require('./src/routes/auth'));
app.use('/api', require('./src/routes/cart'));
app.use('/api', require('./src/routes/orders'));
app.use('/api/admin', require('./src/routes/admin'));

// Unknown API route
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler — turns thrown httpErrors into JSON responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our end.' : err.message });
});

app.listen(PORT, () => {
  console.log(`\n  NextBuy is running  →  http://localhost:${PORT}`);
  console.log(`  Admin panel        →  http://localhost:${PORT}/admin\n`);
});

module.exports = app;
