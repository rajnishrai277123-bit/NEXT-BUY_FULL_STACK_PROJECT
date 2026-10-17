-- NextBuy database schema (SQLite)
-- All money is stored as whole rupees in INTEGER columns.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sessions back the auth cookie. A row with user_id NULL is a guest session
-- (used so that a cart can exist before the visitor logs in).
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  price        INTEGER NOT NULL,             -- selling price, rupees
  compare_at   INTEGER,                      -- "was" price, rupees (nullable)
  rating       REAL    NOT NULL DEFAULT 0,
  reviews      INTEGER NOT NULL DEFAULT 0,
  badge        TEXT,                         -- 'Sale' | 'New' | 'Best seller' | NULL
  image        TEXT    NOT NULL,             -- filename inside /images
  description  TEXT,
  stock        INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  line1      TEXT    NOT NULL,
  city       TEXT    NOT NULL,
  state      TEXT    NOT NULL,
  pin        TEXT    NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Cart is keyed by session, so guests get a cart too and it survives login.
CREATE TABLE IF NOT EXISTS cart_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1,
  added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT    NOT NULL UNIQUE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email          TEXT    NOT NULL,
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0,
  shipping       INTEGER NOT NULL DEFAULT 0,
  cod_fee        INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL,
  promo          TEXT,
  payment_method TEXT    NOT NULL,
  delivery_speed TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'confirmed',
  ship_name      TEXT    NOT NULL,
  ship_phone     TEXT    NOT NULL,
  ship_line1     TEXT    NOT NULL,
  ship_city      TEXT    NOT NULL,
  ship_state     TEXT    NOT NULL,
  ship_pin       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Line items snapshot name and price so order history stays accurate even if
-- the underlying product is later edited or removed.
CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,
  image      TEXT,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_cart_session      ON cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user    ON addresses(user_id);
