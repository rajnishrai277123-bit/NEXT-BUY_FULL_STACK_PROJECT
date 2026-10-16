# NextBuy — full-stack ecommerce app

A complete storefront with a real backend: product catalogue, server-side cart,
customer accounts, order history, saved addresses, and an admin panel for managing
products and orders. Built with **Node.js + Express + SQLite** and plain
HTML/CSS/JavaScript on the front end — no framework, no build step.

---

## Quick start

```bash
npm install          # install dependencies
npm run seed         # create the database and add demo data
npm start            # http://localhost:3000
```

Then open **http://localhost:3000**.

### Demo accounts

| Role     | Email               | Password   |
|----------|---------------------|------------|
| Admin    | `admin@nextbuy.in`  | `admin1234`|
| Customer | `demo@nextbuy.in`   | `demo1234` |

> Change these before deploying anywhere public — set `ADMIN_PASSWORD` / `DEMO_PASSWORD`
> in `.env` and run `npm run reset`.

### Pages

| URL            | What it is |
|----------------|------------|
| `/`            | Storefront — catalogue, filters, search, cart, checkout |
| `/account.html`| Sign in / register, order history, saved addresses |
| `/admin.html`  | Admin dashboard — stats, product CRUD, order management |

---

## Requirements

- **Node.js 18 or newer** (uses the built-in `crypto.scrypt`; developed on Node 20)
- No database server to install — SQLite is a single file created on first run

---

## Configuration

Copy `.env.example` to `.env` to override any of these:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./db/nextbuy.db` | Where the SQLite file lives |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@nextbuy.in` / `admin1234` | Seeded admin account |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `demo@nextbuy.in` / `demo1234` | Seeded customer account |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS |

---

## Project structure

```
nextbuy/
├── server.js                 Express app — middleware, static files, route mounting
├── package.json
├── .env.example
├── db/
│   ├── schema.sql            Table definitions (all IF NOT EXISTS)
│   ├── seed.js               Categories, products, demo accounts
│   └── nextbuy.db            created at runtime
├── src/
│   ├── db.js                 SQLite connection + migration on boot
│   ├── auth.js               scrypt hashing, sessions, cookies, guards
│   ├── util.js               validation, order maths, serializers
│   ├── env.js                tiny .env loader
│   └── routes/
│       ├── catalog.js        categories + products
│       ├── auth.js           register / login / logout / me + addresses
│       ├── cart.js           server-side cart
│       ├── orders.js         checkout + order history
│       └── admin.js          admin CRUD + stats (admin-only)
├── public/                   static front end
│   ├── index.html            storefront
│   ├── account.html          account page
│   ├── admin.html            admin panel
│   ├── css/styles.css
│   ├── js/api.js             fetch wrapper, formatting, header
│   ├── js/store.js           storefront behaviour
│   ├── js/account.js         account page behaviour
│   ├── js/admin.js           admin panel behaviour
│   └── images/               product photography
└── test/
    ├── api-test.js           API suite (no browser needed)
    ├── browser-test.js       full-stack browser suite (Puppeteer)
    └── run-all.js            `npm test`
```

---

## API reference

All responses are JSON. Errors look like `{ "error": "message" }` with a matching
HTTP status. Authentication uses an **HttpOnly session cookie** (`nb_sid`).

### Catalogue

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/categories` | Categories with active product counts |
| `GET` | `/api/products` | Query: `category`, `q`, `badge`, `sort` (`featured`\|`price-asc`\|`price-desc`\|`rating`\|`newest`) |
| `GET` | `/api/products/:id` | Single product |

### Cart (works for guests too)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/cart` | Items + server-computed totals |
| `POST` | `/api/cart` | `{ productId, qty }` — adds/increments |
| `PATCH` | `/api/cart/:productId` | `{ qty }` — absolute quantity, `0` removes |
| `DELETE` | `/api/cart/:productId` | Remove a line |
| `DELETE` | `/api/cart` | Empty the cart |

### Accounts

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register` | `{ name, email, password }` |
| `POST` | `/api/auth/login` | `{ email, password }` |
| `POST` | `/api/auth/logout` | Destroys the session |
| `GET` | `/api/auth/me` | Current user or `null` |
| `GET`/`POST` | `/api/addresses` | List / create (signed in) |
| `DELETE` | `/api/addresses/:id` | Remove one of your addresses |

### Orders

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/orders` | Checkout. Body: delivery details, `paymentMethod`, `deliverySpeed`, `promo` |
| `GET` | `/api/orders` | Your order history (signed in) |
| `GET` | `/api/orders/:orderNo` | One order (owner or admin) |

### Admin (requires an admin session)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/stats` | Counts, revenue, low stock, recent orders |
| `GET` | `/api/admin/products` | Includes archived rows |
| `POST` | `/api/admin/products` | Create |
| `PUT` | `/api/admin/products/:id` | Partial update |
| `DELETE` | `/api/admin/products/:id` | Delete |
| `GET` | `/api/admin/orders` | All orders, optionally `?status=` |
| `PATCH` | `/api/admin/orders/:id` | `{ status }` — `confirmed`\|`packed`\|`shipped`\|`delivered`\|`cancelled` |

### Order maths (server-side, single source of truth)

```
subtotal  = Σ price × qty            (prices read from the database)
shipping  = free over ₹999, else ₹79, plus ₹99 for express
discount  = 10% with promo code NEXT10
codFee    = ₹40 for cash on delivery
total     = subtotal − discount + shipping + codFee
```

The browser sends only product ids and quantities — **prices and totals are always
recomputed on the server**, so a tampered request cannot change what is charged.

---

## How the pieces work

**Authentication.** Passwords are hashed with `crypto.scrypt` (salted, 64-byte digest,
compared with `timingSafeEqual`). A login creates a row in `sessions` and sets an
HttpOnly, SameSite=Lax cookie. Session rows with a `NULL` user_id are *guest* sessions —
that is how a cart can exist before someone signs in, and it survives logging in because
the same session row is simply linked to the user.

**Cart.** Stored in the `cart_items` table keyed by session, so it persists across page
reloads and devices sharing the session.

**Orders.** Checkout snapshots each line item's name, price and image into `order_items`,
so editing or deleting a product later never rewrites past order history.

**Validation.** Every write endpoint validates its input server-side (emails, Indian
10-digit phone numbers, 6-digit PINs, UPI ids, card numbers, quantities). Client-side
checks are for feedback only.

---

## Tests

```bash
npm test                       # API suite (60 assertions)
CHROME=/path/to/chrome npm test  # + full-stack browser suite (36 assertions)
```

The API suite covers the catalogue, cart, checkout maths, promo codes, auth, ownership
rules (you can't read someone else's order), admin permissions, and input validation.
The browser suite drives the real UI end to end: filters, search, add-to-cart surviving
a reload, a guest checkout, a signed-in checkout, order history, saved addresses, the
admin dashboard, product create/edit/delete, and order status changes.

---

## Deploying

This is a real server, so it runs anywhere Node runs (a VM, Render, Railway, Fly.io, a
VPS). Things to do before it faces the public:

1. **Change the seeded passwords** — `ADMIN_PASSWORD` / `DEMO_PASSWORD` in `.env`, then `npm run reset`.
2. **Serve over HTTPS** and set `COOKIE_SECURE=true`, so the session cookie is only sent over TLS.
3. **Set `NODE_ENV=production`** and put a reverse proxy (nginx, Caddy) in front.
4. **Back up the SQLite file.** WAL mode is on; back up `nextbuy.db` along with its `-wal`/`-shm` siblings, or use `sqlite3 nextbuy.db ".backup backup.db"`.
5. **Consider PostgreSQL** if you outgrow a single file. All queries go through `src/db.js`, so swapping the driver is a contained change.

---

## Limitations

- **Payments are simulated.** The checkout validates the payment details and creates a
  real order in the database, but no money moves and no card data is stored or sent
  anywhere — the card fields are validated then discarded. To take real payments, add a
  gateway (Razorpay or Stripe for India) and call it from `src/routes/orders.js` before
  creating the order.
- **No email.** Order confirmations are shown on screen only; nothing is sent.
- **Product images** are free-to-use stock photography from
  [Pexels](https://www.pexels.com/license/) and illustrate each product *type* — swap in
  your own shots before going live.
- **Prices are stored as whole rupees** (INTEGER). Fine for ₹-only pricing; switch to
  paise (or `DECIMAL`) if you need fractions.
- Product names, ratings and policies are sample data.
