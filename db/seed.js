'use strict';

/**
 * Seed the database with categories, products and starter accounts.
 *
 *   node db/seed.js            # only seeds if the catalogue is empty
 *   node db/seed.js --reset    # wipes catalogue + orders, then reseeds
 *
 * Admin credentials come from ADMIN_EMAIL / ADMIN_PASSWORD, falling back to
 * the development defaults printed at the end of the run.
 */

const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const RESET = process.argv.includes('--reset');

const CATEGORIES = [
  { name: 'Home', slug: 'home' },
  { name: 'Kitchen', slug: 'kitchen' },
  { name: 'Tech', slug: 'tech' },
  { name: 'Everyday Carry', slug: 'everyday-carry' },
  { name: 'Wellness', slug: 'wellness' },
];

const PRODUCTS = [
  { name: 'Ceramic Pour-Over Set',   cat: 'Kitchen',        price: 2450, compare_at: 2999, rating: 4.9, reviews: 2180, badge: 'Best seller', image: 'pourover.jpg',  stock: 40, description: 'Hand-glazed dripper and carafe for a slower morning.' },
  { name: 'Linen Throw Blanket',     cat: 'Home',           price: 1899, compare_at: null, rating: 4.7, reviews: 860,  badge: 'New',         image: 'throw.jpg',     stock: 65, description: 'Stonewashed linen that softens with every wash.' },
  { name: 'Walnut Desk Organiser',   cat: 'Home',           price: 1650, compare_at: 1990, rating: 4.8, reviews: 1240, badge: 'Sale',        image: 'organiser.jpg', stock: 30, description: 'Solid walnut with compartments for pens and cards.' },
  { name: 'Wireless Charging Pad',   cat: 'Tech',           price: 1290, compare_at: null, rating: 4.6, reviews: 3120, badge: null,          image: 'charger.jpg',   stock: 80, description: '15W fast wireless charging with a non-slip base.' },
  { name: 'Everyday Leather Wallet', cat: 'Everyday Carry', price: 2190, compare_at: 2590, rating: 4.8, reviews: 1540, badge: 'Sale',        image: 'wallet.jpg',    stock: 25, description: 'Full-grain leather that patinas beautifully.' },
  { name: 'Stoneware Mug (Set of 2)',cat: 'Kitchen',        price: 990,  compare_at: null, rating: 4.7, reviews: 2210, badge: null,          image: 'mug.jpg',       stock: 120, description: 'Reactive-glaze stoneware, dishwasher safe.' },
  { name: 'Merino Travel Scarf',     cat: 'Everyday Carry', price: 1750, compare_at: null, rating: 4.9, reviews: 430,  badge: 'New',         image: 'scarf.jpg',     stock: 45, description: 'Fine merino that packs down to nothing.' },
  { name: 'Aroma Diffuser — Ash',    cat: 'Wellness',       price: 2350, compare_at: 2890, rating: 4.6, reviews: 980,  badge: 'Sale',        image: 'diffuser.jpg',  stock: 35, description: 'Ultrasonic diffuser with a 10-hour run time.' },
  { name: 'Bamboo Cutting Board',    cat: 'Kitchen',        price: 1190, compare_at: null, rating: 4.8, reviews: 1670, badge: null,          image: 'board.jpg',     stock: 90, description: 'End-grain bamboo, gentle on knife edges.' },
  { name: 'Noise-Isolating Earbuds', cat: 'Tech',           price: 3990, compare_at: 4990, rating: 4.7, reviews: 5210, badge: 'Sale',        image: 'earbuds.jpg',   stock: 55, description: 'Active noise cancellation with 30-hour case.' },
  { name: 'Cotton Bath Towel Set',   cat: 'Home',           price: 1490, compare_at: null, rating: 4.7, reviews: 1120, badge: null,          image: 'towel.jpg',     stock: 70, description: 'Long-staple cotton, quick-drying and plush.' },
  { name: 'Cork Yoga Mat',           cat: 'Wellness',       price: 2790, compare_at: null, rating: 4.9, reviews: 760,  badge: 'Best seller', image: 'mat.jpg',       stock: 50, description: 'Natural cork surface with a rubber base.' },
];

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nextbuy.in';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@nextbuy.in';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

function run() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;

  if (RESET) {
    db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM cart_items; DELETE FROM addresses; DELETE FROM products; DELETE FROM categories;');
    console.log('· cleared existing catalogue and orders');
  } else if (count > 0) {
    console.log(`· catalogue already has ${count} products — nothing to do (use --reset to rebuild)`);
    return;
  }

  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)');
  const catIds = {};
  for (const c of CATEGORIES) {
    insertCat.run(c.name, c.slug);
    catIds[c.name] = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name).id;
  }

  const insertProduct = db.prepare(`
    INSERT INTO products (name, category_id, price, compare_at, rating, reviews, badge, image, description, stock)
    VALUES (@name, @category_id, @price, @compare_at, @rating, @reviews, @badge, @image, @description, @stock)
  `);
  const seedProducts = db.transaction((rows) => {
    for (const p of rows) {
      insertProduct.run({
        name: p.name,
        category_id: catIds[p.cat],
        price: p.price,
        compare_at: p.compare_at,
        rating: p.rating,
        reviews: p.reviews,
        badge: p.badge,
        image: p.image,
        description: p.description,
        stock: p.stock,
      });
    }
  });
  seedProducts(PRODUCTS);
  console.log(`· seeded ${CATEGORIES.length} categories and ${PRODUCTS.length} products`);

  const upsertUser = (name, email, password, isAdmin) => {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      db.prepare('UPDATE users SET name = ?, password_hash = ?, is_admin = ? WHERE id = ?')
        .run(name, hashPassword(password), isAdmin, existing.id);
      return 'updated';
    }
    db.prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(password), isAdmin);
    return 'created';
  };

  upsertUser('NextBuy Admin', ADMIN_EMAIL, ADMIN_PASSWORD, 1);
  upsertUser('Demo Customer', DEMO_EMAIL, DEMO_PASSWORD, 0);

  console.log('\n  Accounts ready:');
  console.log(`    Admin     ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log(`    Customer  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('\n  ⚠  Using the default admin password. Set ADMIN_PASSWORD in .env before deploying.');
  }
}

run();
