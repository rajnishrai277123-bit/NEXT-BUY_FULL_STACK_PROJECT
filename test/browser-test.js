'use strict';

/**
 * Full-stack browser test: boots the real server as a child process against a
 * throwaway database, then drives the storefront, account and admin pages with
 * Puppeteer.
 *
 *   DB_PATH=./db/browser.db PORT=3222 node test/browser-test.js
 */

const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.TEST_PORT || 3222); // deliberately not process.env.PORT
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let failures = 0;
const check = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  → ' + extra}`);
  if (!cond) failures++;
};

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (buf) => {
      out += buf.toString();
      if (out.includes('running')) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (buf) => { out += buf.toString(); });
    child.on('error', reject);
    setTimeout(() => reject(new Error('server did not start:\n' + out)), 15000);
  });
}

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  try {
    /* ---------------------------- storefront ---------------------------- */
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#grid .card', { timeout: 10000 });
    const cards = await page.$$eval('#grid .card', (els) => els.length);
    check('storefront renders 12 products from the API', cards === 12, cards);

    const imgOk = await page.$$eval('#grid .card img.art', (els) => els.filter((e) => e.naturalWidth > 0).length);
    check('product images load', imgOk === 12, imgOk);

    const chips = await page.$$eval('#filters .chip', (els) => els.map((e) => e.textContent.trim()));
    check('category chips come from the API', chips.length === 6, chips.join('|'));

    // category filter hits the server
    await page.click('#filters .chip:nth-child(3)');           // Kitchen
    await sleep(500);
    const kitchen = await page.$$eval('#grid .card', (els) => els.length);
    check('category filter queries the server', kitchen === 3, kitchen);
    await page.click('#filters .chip:nth-child(1)');           // All
    await sleep(400);

    // search hits the server
    await page.type('#search', 'wallet');
    await sleep(600);
    const found = await page.$$eval('#grid .card', (els) => els.length);
    check('search queries the server', found === 1, found);
    await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(600);

    /* -------------------------------- cart ------------------------------ */
    await page.click('#grid .card:nth-child(1) [data-add]');
    await sleep(500);
    let badge = await page.$eval('#cartCount', (e) => e.textContent);
    check('add to cart persists to the server', badge === '1', badge);

    await page.click('#grid .card:nth-child(1) [data-add]');
    await sleep(500);
    badge = await page.$eval('#cartCount', (e) => e.textContent);
    check('adding again increments server cart', badge === '2', badge);

    // reload — cart should survive because it lives on the server
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#grid .card');
    await sleep(400);
    badge = await page.$eval('#cartCount', (e) => e.textContent);
    check('cart survives a page reload', badge === '2', badge);

    await page.click('#cartBtn');
    await sleep(400);
    const drawerLines = await page.$$eval('.ci', (els) => els.length);
    check('cart drawer shows server lines', drawerLines === 1, drawerLines);

    /* ------------------------------ checkout ---------------------------- */
    await page.click('#checkout');
    await page.waitForFunction(() => document.getElementById('checkoutView').classList.contains('open'), { timeout: 5000 });
    await sleep(300);
    check('checkout opens as a guest', true);

    const guestNudge = await page.$eval('#ckSaved', (e) => e.textContent.includes('guest')).catch(() => false);
    check('guest sees a sign-in nudge', guestNudge);

    await page.type('#ckName', 'Sahil Agarwal');
    await page.type('#ckEmail', 'sahil@example.com');
    await page.type('#ckPhone', '9876543210');
    await page.type('#ckPin', '560001');
    await page.type('#ckAddr', '12 MG Road');
    await page.type('#ckCity', 'Bengaluru');
    await page.type('#ckState', 'Karnataka');
    await page.click('#ckTo2');
    await sleep(500);
    await page.type('#ckUpi', 'sahil@okhdfcbank');
    await page.click('#ckTo3');
    await sleep(500);
    await page.type('#ckPromo', 'NEXT10');
    await page.click('#ckPromoBtn');
    await sleep(400);
    const totalWithPromo = await page.$eval('#ckTotal', (e) => e.textContent);
    check('promo applies in the checkout UI', totalWithPromo === '₹4,410', totalWithPromo); // 4900 - 490

    await page.click('#ckPlace');
    await page.waitForFunction(() => !document.querySelector('[data-panel="done"]').hidden, { timeout: 8000 });
    const orderNo = await page.$eval('#ckOrderId', (e) => e.textContent);
    check('order placed via the API', /^NB-\d{4}-\d{6}$/.test(orderNo), orderNo);
    const afterOrder = await page.$eval('#cartCount', (e) => e.textContent);
    check('server cart cleared after order', afterOrder === '0', afterOrder);
    await page.click('#ckDone');
    await sleep(400);

    /* ------------------------------ account ----------------------------- */
    await page.goto(BASE + '/account.html', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#authSection');
    const authVisible = await page.$eval('#authSection', (e) => !e.hidden);
    check('account page shows the sign-in card', authVisible);

    await page.type('#auEmail', 'demo@nextbuy.in');
    await page.type('#auPassword', 'demo1234');
    await page.click('#authSubmit');
    await page.waitForFunction(() => !document.getElementById('accountSection').hidden, { timeout: 8000 });
    check('demo customer can sign in', true);

    // place an order while signed in, so history is populated
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#grid .card');
    await sleep(300);
    await page.click('#grid .card:nth-child(3) [data-add]');
    await sleep(500);
    await page.click('#cartBtn');
    await sleep(300);
    await page.click('#checkout');
    await page.waitForFunction(() => document.getElementById('checkoutView').classList.contains('open'), { timeout: 5000 });
    await sleep(400);

    const prefilledEmail = await page.$eval('#ckEmail', (e) => e.value);
    check('checkout prefills the signed-in email', prefilledEmail === 'demo@nextbuy.in', prefilledEmail);

    await page.type('#ckName', 'Demo Customer');
    await page.type('#ckPhone', '9876500000');
    await page.type('#ckPin', '560001');
    await page.type('#ckAddr', '4th Floor, 12 MG Road');
    await page.type('#ckCity', 'Bengaluru');
    await page.type('#ckState', 'Karnataka');
    await page.click('#ckTo2');
    await sleep(400);
    await page.type('#ckUpi', 'demo@okhdfcbank');
    await page.click('#ckTo3');
    await sleep(400);
    await page.click('#ckPlace');
    await page.waitForFunction(() => !document.querySelector('[data-panel="done"]').hidden, { timeout: 8000 });
    const secondOrder = await page.$eval('#ckOrderId', (e) => e.textContent);
    await page.click('#ckDone');
    await sleep(400);

    await page.goto(BASE + '/account.html', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('.order-card').length > 0, { timeout: 8000 });
    const orderCards = await page.$$eval('.order-card', (els) => els.length);
    check('order appears in the customer history', orderCards === 1, orderCards);
    const hasSecond = await page.$eval('#ordersBody', (e, no) => e.textContent.includes(no), secondOrder);
    check('history shows the right order number', hasSecond);

    // address was saved at checkout
    await page.click('.tab[data-tab="addresses"]');
    await sleep(600);
    const addrCards = await page.$$eval('.addr-card', (els) => els.length);
    check('checkout saved the address', addrCards === 1, addrCards);

    await page.click('#signOut');
    await sleep(800);
    const backToAuth = await page.$eval('#authSection', (e) => !e.hidden);
    check('sign out returns to the auth card', backToAuth);

    /* -------------------------------- admin ----------------------------- */
    await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#gate');
    const gateVisible = await page.$eval('#gate', (e) => !e.hidden);
    check('admin page gates non-admins', gateVisible);

    await page.type('#gEmail', 'demo@nextbuy.in');
    await page.type('#gPassword', 'demo1234');
    await page.click('#gSubmit');
    await sleep(1200);
    const stillGated = await page.$eval('#gate', (e) => !e.hidden);
    check('non-admin cannot enter the dashboard', stillGated);

    await page.$eval('#gEmail', (el) => { el.value = ''; });
    await page.$eval('#gPassword', (el) => { el.value = ''; });
    await page.type('#gEmail', 'admin@nextbuy.in');
    await page.type('#gPassword', 'admin1234');
    await page.click('#gSubmit');
    await page.waitForFunction(() => !document.getElementById('dash').hidden, { timeout: 8000 });
    check('admin signs in and sees the dashboard', true);

    await page.waitForSelector('.stat-card', { timeout: 8000 });
    await sleep(300);
    const statCards = await page.$$eval('.stat-card .v', (els) => els.map((e) => e.textContent));
    check('dashboard stats render', statCards.length === 4, statCards.join('|'));
    const revenue = statCards[2];
    check('revenue reflects placed orders', revenue !== '₹0', revenue);

    const productRows = await page.$$eval('#productBody tr', (els) => els.length);
    check('admin product table lists the catalogue', productRows === 12, productRows);

    const orderRows = await page.$$eval('#orderBody tr', (els) => els.length);
    check('admin sees all orders', orderRows === 2, orderRows);

    // create a product
    await page.click('#newProduct');
    await sleep(400);
    await page.type('#pfName', 'Test Lamp');
    await page.select('#pfCategory', await page.$eval('#pfCategory option', (o) => o.value));
    await page.type('#pfPrice', '1500');
    await page.type('#pfStock', '7');
    await page.select('#pfBadge', 'New');
    await page.type('#pfRating', '4.5');
    await page.type('#pfReviews', '12');
    await page.type('#pfDescription', 'A test lamp.');
    await page.click('#pfSave');
    await sleep(1200);
    let rows = await page.$$eval('#productBody tr', (els) => els.length);
    check('admin creates a product', rows === 13, rows);

    // it shows up in the storefront
    const storefront = await browser.newPage();
    await storefront.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await storefront.waitForSelector('#grid .card');
    const storeCount = await storefront.$$eval('#grid .card', (els) => els.length);
    check('new product appears in the storefront', storeCount === 13, storeCount);
    await storefront.close();

    // update stock through the edit form
    const lastId = await page.$$eval('#productBody tr', (trs) => trs[trs.length - 1].querySelector('[data-edit]').dataset.edit);
    await page.click(`[data-edit="${lastId}"]`);
    await sleep(400);
    await page.$eval('#pfStock', (el) => { el.value = '25'; });
    await page.click('#pfSave');
    await sleep(1000);
    const stockNow = await page.$$eval('#productBody tr', (trs) => trs[trs.length - 1].querySelectorAll('td')[4].textContent.trim());
    check('admin edits a product', stockNow === '25', stockNow);

    // delete it (accept the confirm dialog)
    page.once('dialog', (d) => d.accept());
    await page.click(`[data-del="${lastId}"]`);
    await sleep(1200);
    rows = await page.$$eval('#productBody tr', (els) => els.length);
    check('admin deletes a product', rows === 12, rows);

    // change an order's status
    const firstSelect = await page.$('#orderBody select[data-order]');
    const firstOrderId = await firstSelect.evaluate((el) => el.dataset.order);
    await page.select(`#orderBody select[data-order="${firstOrderId}"]`, 'shipped');
    await sleep(1000);
    const statusNow = await page.$eval(`#orderBody select[data-order="${firstOrderId}"]`, (el) => el.value);
    check('admin updates an order status', statusNow === 'shipped', statusNow);

    // the customer sees the new status
    const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const acct = await ctx.newPage();
    await acct.goto(BASE + '/account.html', { waitUntil: 'networkidle0' });
    await acct.waitForSelector('#authSection');
    await acct.type('#auEmail', 'demo@nextbuy.in');
    await acct.type('#auPassword', 'demo1234');
    await acct.click('#authSubmit');
    await acct.waitForFunction(() => document.querySelectorAll('.order-card').length > 0, { timeout: 8000 });
    const pillText = await acct.$$eval('.order-card .pill', (els) => els.map((e) => e.textContent.trim()));
    check('status change is visible to the customer', pillText.includes('shipped'), pillText.join('|'));
    await ctx.close();

    /* ------------------------------ security ---------------------------- */
    const guard = await page.evaluate(async () => {
      const r = await fetch('/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Guard Test', price: 100, image: 'mug.jpg', categoryId: 1, stock: 1, rating: 4, reviews: 1 }) });
      return r.status;
    }).catch(() => 'n/a');
    check('admin API reachable while signed in as admin', guard === 201, guard);

    check('no console errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('BROWSER TEST CRASHED:', e);
  process.exit(1);
});
