'use strict';

/**
 * End-to-end API test. Boots the real Express app in-process against a
 * throwaway SQLite file and exercises every endpoint.
 *
 *   DB_PATH=./db/test.db PORT=3111 node test/api-test.js
 */

process.env.PORT = process.env.PORT || '3111';

const http = require('http');
const PORT = Number(process.env.PORT);

let cookie = '';
const results = [];
let failures = 0;

/** Minimal HTTP client on Node's built-in http (avoids undici/WASM). */
function raw(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { ...extraHeaders };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, data, text });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function req(method, path, body) {
  const res = await raw(method, path, body, cookie ? { Cookie: cookie } : {});
  const setCookies = res.headers['set-cookie'] || [];
  for (const c of setCookies) {
    const pair = c.split(';')[0];
    if (pair.startsWith('nb_sid=')) cookie = pair;
  }
  return { status: res.status, data: res.data };
}

function check(name, cond, extra = '') {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  → ' + extra}`);
  if (!cond) failures++;
}

(async () => {
  require('../server');
  await new Promise((r) => setTimeout(r, 300));

  /* ---------------------------- catalogue ---------------------------- */
  let r = await req('GET', '/api/health');
  check('health', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

  r = await req('GET', '/api/categories');
  check('categories = 5', r.status === 200 && r.data.categories.length === 5, r.data && r.data.categories.length);

  r = await req('GET', '/api/products');
  check('products = 12', r.data.products.length === 12, r.data.count);
  check('product has image url', /^\/images\/.+\.jpg$/.test(r.data.products[0].image), r.data.products[0].image);

  r = await req('GET', '/api/products?category=kitchen');
  check('filter by category', r.data.products.length === 3 && r.data.products.every(p => p.categorySlug === 'kitchen'), r.data.count);

  r = await req('GET', '/api/products?q=wallet');
  check('search by text', r.data.products.length === 1 && /wallet/i.test(r.data.products[0].name), r.data.count);

  r = await req('GET', '/api/products?badge=Sale');
  check('filter by badge', r.data.products.length === 4, r.data.count);

  r = await req('GET', '/api/products?sort=price-asc');
  const prices = r.data.products.map(p => p.price);
  check('sort price asc', prices.every((v, i) => i === 0 || prices[i - 1] <= v), prices.join(','));

  r = await req('GET', '/api/products/1');
  check('single product', r.status === 200 && r.data.product.id === 1);
  r = await req('GET', '/api/products/9999');
  check('missing product -> 404', r.status === 404);

  /* ------------------------------- cart ------------------------------ */
  r = await req('GET', '/api/cart');
  check('guest cart starts empty', r.data.count === 0);
  check('guest gets a session cookie', cookie.startsWith('nb_sid='));

  r = await req('POST', '/api/cart', { productId: 1, qty: 2 });
  check('add to cart', r.status === 201 && r.data.count === 2, JSON.stringify(r.data).slice(0, 80));

  r = await req('POST', '/api/cart', { productId: 1, qty: 1 });
  check('re-add increments', r.data.count === 3 && r.data.items.length === 1);

  r = await req('POST', '/api/cart', { productId: 2 });
  check('second line', r.data.count === 4 && r.data.items.length === 2);

  r = await req('PATCH', '/api/cart/2', { qty: 3 });
  check('patch quantity', r.data.items.find(i => i.productId === 2).qty === 3);

  r = await req('PATCH', '/api/cart/2', { qty: 0 });
  check('patch to zero removes', r.data.items.length === 1);

  r = await req('POST', '/api/cart', { productId: 9999 });
  check('bad product -> 404', r.status === 404);

  // 2450 x 3 = 7350 → free shipping
  r = await req('GET', '/api/cart');
  check('cart totals (subtotal/ship)', r.data.totals.subtotal === 7350 && r.data.totals.shipping === 0, JSON.stringify(r.data.totals));

  /* ----------------------------- checkout ---------------------------- */
  const delivery = {
    name: 'Sahil Agarwal', email: 'sahil@example.com', phone: '9876543210',
    line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pin: '560001',
    deliverySpeed: 'standard', paymentMethod: 'upi', upiId: 'sahil@okhdfcbank',
    promo: 'NEXT10',
  };

  r = await req('POST', '/api/orders', { ...delivery, email: 'not-an-email' });
  check('checkout rejects bad email', r.status === 400, JSON.stringify(r.data));

  r = await req('POST', '/api/orders', { ...delivery, paymentMethod: 'upi', upiId: 'nope' });
  check('checkout rejects bad UPI', r.status === 400, JSON.stringify(r.data));

  r = await req('POST', '/api/orders', { ...delivery, paymentMethod: 'card', cardNumber: '123' });
  check('checkout rejects bad card', r.status === 400, JSON.stringify(r.data));

  r = await req('POST', '/api/orders', delivery);
  check('order placed', r.status === 201 && /^NB-\d{4}-\d{6}$/.test(r.data.order.orderNo), JSON.stringify(r.data).slice(0, 120));
  const order = r.data.order;
  check('promo discount applied (10%)', order.discount === 735, order.discount);
  check('order total correct', order.total === 7350 - 735, order.total);
  check('order has line items', order.items.length === 1 && order.items[0].qty === 3);
  check('order snapshots the price', order.items[0].price === 2450);

  r = await req('GET', '/api/cart');
  check('cart cleared after order', r.data.count === 0);

  r = await req('GET', '/api/orders');
  check('guest order history -> 401', r.status === 401);

  /* ------------------------------- auth ------------------------------ */
  r = await req('POST', '/api/auth/register', { name: 'Sahil', email: 'sahil@example.com', password: 'short' });
  check('register rejects short password', r.status === 400);

  r = await req('POST', '/api/auth/register', { name: 'Sahil', email: 'sahil@example.com', password: 'supersecret' });
  check('register succeeds', r.status === 201 && r.data.user.email === 'sahil@example.com', JSON.stringify(r.data));

  r = await req('POST', '/api/auth/register', { name: 'Sahil', email: 'sahil@example.com', password: 'supersecret' });
  check('duplicate email -> 409', r.status === 409);

  r = await req('GET', '/api/auth/me');
  check('me returns user', r.data.user && r.data.user.email === 'sahil@example.com');
  check('me hides password hash', r.data.user && r.data.user.password_hash === undefined);

  // logged-in order, saving the address
  await req('POST', '/api/cart', { productId: 10, qty: 1 });          // 3990 earbuds
  r = await req('POST', '/api/orders', { ...delivery, promo: null, paymentMethod: 'cod', saveAddress: true });
  check('logged-in order placed', r.status === 201);
  check('COD fee added', r.data.order.codFee === 40, r.data.order.codFee);
  check('order linked to user', r.data.order.customer && r.data.order.customer.email === 'sahil@example.com');

  r = await req('GET', '/api/orders');
  check('customer order history', r.status === 200 && r.data.orders.length === 1, r.data.orders && r.data.orders.length);

  r = await req('GET', `/api/orders/${order.orderNo}`);
  check('cannot read someone else\'s order', r.status === 403, r.status);

  r = await req('GET', '/api/addresses');
  check('address saved at checkout', r.data.addresses.length === 1 && r.data.addresses[0].pin === '560001');

  r = await req('POST', '/api/addresses', { label: 'Work', name: 'Sahil A', phone: '9000000000', line1: '5th Floor, Prestige', city: 'Bengaluru', state: 'Karnataka', pin: '560095' });
  check('add address', r.status === 201);
  r = await req('DELETE', `/api/addresses/${r.data.address.id}`);
  check('delete address', r.status === 200);

  r = await req('POST', '/api/auth/logout');
  check('logout', r.status === 200);
  r = await req('GET', '/api/auth/me');
  check('me is null after logout', r.data.user === null);

  /* ------------------------------ admin ------------------------------ */
  r = await req('POST', '/api/auth/login', { email: 'demo@nextbuy.in', password: 'demo1234' });
  check('demo login', r.status === 200 && r.data.user.isAdmin === false);
  r = await req('GET', '/api/admin/stats');
  check('non-admin blocked from admin', r.status === 403, r.status);

  r = await req('POST', '/api/auth/login', { email: 'admin@nextbuy.in', password: 'wrongpass' });
  check('wrong password -> 401', r.status === 401);

  r = await req('POST', '/api/auth/login', { email: 'admin@nextbuy.in', password: 'admin1234' });
  check('admin login', r.status === 200 && r.data.user.isAdmin === true);

  r = await req('GET', '/api/admin/stats');
  check('admin stats', r.status === 200 && r.data.stats.products === 12 && r.data.stats.orders === 2, JSON.stringify(r.data.stats));

  r = await req('GET', '/api/admin/products');
  check('admin product list', r.data.products.length === 12);

  r = await req('POST', '/api/admin/products', { name: 'Test Lamp', category: 'home', price: 1500, compareAt: 1900, badge: 'New', image: 'mug.jpg', description: 'A lamp', stock: 5, rating: 4.5, reviews: 3 });
  check('admin create product', r.status === 201 && r.data.product.name === 'Test Lamp', JSON.stringify(r.data).slice(0, 100));
  const newId = r.data.product.id;

  r = await req('PUT', `/api/admin/products/${newId}`, { price: 1350, stock: 12 });
  check('admin update product', r.data.product.price === 1350 && r.data.product.stock === 12);

  r = await req('POST', '/api/admin/products', { name: 'Bad', category: 'nope', price: 100, image: 'mug.jpg' });
  check('admin rejects bad category', r.status === 400);

  r = await req('DELETE', `/api/admin/products/${newId}`);
  check('admin delete product', r.status === 200);
  r = await req('GET', '/api/products');
  check('deleted product gone from catalogue', r.data.products.length === 12);

  r = await req('GET', '/api/admin/orders');
  check('admin sees all orders', r.data.orders.length === 2);
  const firstOrderId = r.data.orders[0].id;

  r = await req('PATCH', `/api/admin/orders/${firstOrderId}`, { status: 'shipped' });
  check('admin updates order status', r.data.order.status === 'shipped');

  r = await req('PATCH', `/api/admin/orders/${firstOrderId}`, { status: 'teleported' });
  check('admin rejects bad status', r.status === 400);

  /* ----------------------------- security ---------------------------- */
  r = await req('POST', '/api/cart', { productId: 1, qty: -5 });
  check('negative quantity rejected', r.status === 400);

  const sneaky = await raw('POST', '/api/orders', { ...delivery, total: 1, subtotal: 1 }, { Cookie: cookie });
  check('client-supplied total is ignored', sneaky.status === 400, 'empty cart should block');

  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('TEST RUNNER CRASHED:', e);
  process.exit(1);
});
