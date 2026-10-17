'use strict';

const crypto = require('crypto');
const db = require('./db');

const COOKIE_NAME = 'nb_sid';
const SESSION_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Password hashing — scrypt from Node's built-in crypto, so there is
 * no native dependency to compile. Format: scrypt$<salt>$<hash>
 * ------------------------------------------------------------------ */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */
function createSession(userId = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/* ------------------------------------------------------------------ *
 * Cookies (parsed by hand to avoid an extra dependency)
 * ------------------------------------------------------------------ */
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  // Send Secure only when explicitly asked (i.e. you are behind HTTPS).
  if (process.env.COOKIE_SECURE === 'true') attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ------------------------------------------------------------------ *
 * Middleware — guarantees req.session exists (creating a guest session
 * on first visit) and attaches req.user when the session is logged in.
 * ------------------------------------------------------------------ */
function attachSession(req, res, next) {
  let token = parseCookies(req)[COOKIE_NAME];
  let session = getSession(token);

  if (!session) {
    token = createSession(null);
    session = getSession(token);
    setSessionCookie(res, token);
  }

  req.sessionToken = token;
  req.session = session;
  req.user = session.user_id
    ? db.prepare('SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?').get(session.user_id) || null
    : null;

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  attachSession,
  requireAuth,
  requireAdmin,
};
