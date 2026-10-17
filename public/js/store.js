/* ==================================================================
   NextBuy storefront — talks to the REST API instead of local data.
   Depends on api.js (API, rupee, esc, toast, initHeader).
   ================================================================== */

/* ------------------------------- state ------------------------------ */
let CATEGORIES = [{ name: 'All', slug: 'all', count: 0 }];
let PRODUCTS = [];
let activeCat = 'all';
let query = '';
let badgeFilter = null;
let cart = { items: [], totals: { subtotal: 0, shipping: 0, total: 0 }, count: 0 };
let currentUser = null;
let savedAddresses = [];

const DELIVERY_FEE = { standard: 0, express: 99 };
const COD_FEE = 40;

/* ------------------------------ helpers ----------------------------- */
const $ = (id) => document.getElementById(id);

function localCheckoutTotals() {
  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const baseShip = subtotal === 0 ? 0 : (subtotal >= 999 ? 0 : 79);
  const shipping = subtotal === 0 ? 0 : baseShip + DELIVERY_FEE[ckDelivery];
  const discount = ckPromo ? Math.round(subtotal * ckPromo.pct / 100) : 0;
  const cod = ckPay === 'cod' && subtotal > 0 ? COD_FEE : 0;
  return { subtotal, shipping, discount, cod, total: Math.max(0, subtotal - discount + shipping + cod) };
}

/* ------------------------------ catalogue --------------------------- */
async function loadCategories() {
  const { categories } = await API.get('/api/categories');
  CATEGORIES = [{ name: 'All', slug: 'all', count: 0 }, ...categories];
  renderFilters();
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (activeCat && activeCat !== 'all') params.set('category', activeCat);
  if (badgeFilter) params.set('badge', badgeFilter);
  if (query) params.set('q', query);
  try {
    const { products } = await API.get('/api/products?' + params.toString());
    PRODUCTS = products;
    renderGrid();
  } catch (e) {
    $('grid').innerHTML = `<div class="empty"><b>Couldn't load products</b>${esc(e.message)}</div>`;
  }
}

function catCount(slug) {
  if (slug === 'all') return CATEGORIES.reduce((s, c) => s + (c.count || 0), 0);
  const c = CATEGORIES.find((x) => x.slug === slug);
  return c ? c.count : 0;
}

function renderFilters() {
  const el = $('filters');
  el.innerHTML = CATEGORIES.map((c) =>
    `<button class="chip ${c.slug === activeCat ? 'active' : ''}" data-cat="${esc(c.slug)}">${esc(c.name)}<span class="n">${catCount(c.slug)}</span></button>`
  ).join('');
  el.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => { activeCat = b.dataset.cat; badgeFilter = null; renderFilters(); loadProducts(); };
  });
}

function badgeClass(b) {
  if (b === 'Sale') return 'sale';
  if (b === 'New') return 'new';
  return '';
}

function updateActiveFilter() {
  const el = $('activeFilter');
  if (!badgeFilter) { el.hidden = true; el.innerHTML = ''; return; }
  const label = badgeFilter === 'New' ? 'New arrivals' : 'Best sellers';
  el.hidden = false;
  el.innerHTML = `Showing <b>${esc(label)}</b> <button type="button" data-clear-filter aria-label="Clear filter">&#10005;</button>`;
  el.querySelector('[data-clear-filter]').onclick = () => { badgeFilter = null; loadProducts(); };
}

function renderGrid() {
  updateActiveFilter();
  $('resultCount').textContent = PRODUCTS.length + (PRODUCTS.length === 1 ? ' product' : ' products');

  if (!PRODUCTS.length) {
    $('grid').innerHTML = '<div class="empty"><b>Nothing here yet</b>Try a different search or category.</div>';
    return;
  }

  $('grid').innerHTML = PRODUCTS.map((p, i) => `
    <article class="card" style="animation-delay:${Math.min(i * 45, 360)}ms">
      <div class="card-media">
        <img class="art" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
        ${p.badge ? `<span class="badge ${badgeClass(p.badge)}">${esc(p.badge)}</span>` : ''}
      </div>
      <div class="card-body">
        <span class="card-cat">${esc(p.category)}</span>
        <h3 class="card-name">${esc(p.name)}</h3>
        <div class="stars"><span class="s">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span>${p.rating} · ${Number(p.reviews).toLocaleString('en-IN')}</div>
        <div class="card-foot">
          <div class="price">
            <span class="now">${rupee(p.price)}</span>
            ${p.compareAt ? `<span class="was">${rupee(p.compareAt)}</span>` : ''}
          </div>
          <button class="add" data-add="${p.id}" aria-label="Add ${esc(p.name)} to cart">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </article>
  `).join('');

  $('grid').querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => addToCart(Number(b.dataset.add), b);
  });
}

/* -------------------------------- cart ------------------------------ */
async function loadCart() {
  try { cart = await API.get('/api/cart'); } catch { /* ignore */ }
  updateCartUI();
}

async function addToCart(productId, btn) {
  try {
    cart = await API.post('/api/cart', { productId, qty: 1 });
    updateCartUI();
    const p = PRODUCTS.find((x) => x.id === productId);
    toast(`${p ? p.name : 'Item'} added to cart`);
    if (btn) { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 900); }
  } catch (e) { toast(e.message); }
}

async function setQty(productId, qty) {
  try { cart = await API.patch(`/api/cart/${productId}`, { qty }); updateCartUI(); }
  catch (e) { toast(e.message); }
}

async function removeLine(productId) {
  try { cart = await API.del(`/api/cart/${productId}`); updateCartUI(); }
  catch (e) { toast(e.message); }
}

function updateCartUI() {
  const count = cart.count || 0;
  $('cartCount').textContent = count;
  $('cartCount').classList.toggle('show', count > 0);
  $('drawerCount').textContent = count > 0 ? `(${count})` : '';

  if (!cart.items.length) {
    $('drawerItems').innerHTML = `<div class="drawer-empty">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>
      <b>Your cart is empty</b><span style="font-size:14px">Add something you'll actually use.</span></div>`;
    $('drawerFoot').style.display = 'none';
    return;
  }
  $('drawerFoot').style.display = 'block';

  $('drawerItems').innerHTML = cart.items.map((i) => `
    <div class="ci">
      <div class="ci-media"><img class="art" src="${esc(i.image)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div>
      <div>
        <div class="ci-name">${esc(i.name)}</div>
        <div class="ci-price">${rupee(i.price)} each</div>
      </div>
      <div class="ci-right">
        <div class="qty">
          <button data-dec="${i.productId}" aria-label="Decrease">−</button>
          <span>${i.qty}</span>
          <button data-inc="${i.productId}" aria-label="Increase">+</button>
        </div>
        <button class="ci-remove" data-rm="${i.productId}">Remove</button>
      </div>
    </div>`).join('');

  $('drawerItems').querySelectorAll('[data-inc]').forEach((b) => {
    b.onclick = () => { const it = cart.items.find((x) => x.productId === Number(b.dataset.inc)); setQty(it.productId, it.qty + 1); };
  });
  $('drawerItems').querySelectorAll('[data-dec]').forEach((b) => {
    b.onclick = () => { const it = cart.items.find((x) => x.productId === Number(b.dataset.dec)); setQty(it.productId, it.qty - 1); };
  });
  $('drawerItems').querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = () => removeLine(Number(b.dataset.rm));
  });

  const t = cart.totals;
  $('subtotal').textContent = rupee(t.subtotal);
  $('shipping').textContent = t.shipping === 0 ? 'Free' : rupee(t.shipping);
  $('total').textContent = rupee(t.total);
}

/* ----------------------------- cart drawer -------------------------- */
const overlay = $('overlay');
const drawer = $('drawer');
function openCartDrawer() { overlay.classList.add('open'); drawer.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeCart() { overlay.classList.remove('open'); drawer.classList.remove('open'); if (!$('checkoutView').classList.contains('open')) document.body.style.overflow = ''; }

$('cartBtn').onclick = openCartDrawer;
$('closeCart').onclick = closeCart;
overlay.onclick = closeCart;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeCart(); closeModal(); closeCheckout(); closeMobileMenu(); }
});

/* ------------------------------- search ----------------------------- */
let searchTimer;
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 220);
});

/* ------------------------------- modal ------------------------------ */
const MODALS = {
  track: { title: 'Track your order', body: `<p>Sign in to see your order history and live status.</p><p><a class="btn btn-primary" href="account.html">Go to your account</a></p><p class="m-note">Orders you place are saved to your account.</p>` },
  shipping: { title: 'Shipping & delivery', body: `<ul><li>Free standard shipping on orders over <b>₹999</b>; a flat <b>₹79</b> below that.</li><li>Metro cities: delivered in <b>48 hours</b>.</li><li>Rest of India: <b>3–5 working days</b>.</li><li>Express delivery (₹99) arrives in 1–2 business days.</li></ul><p class="m-note">Demo store — sample policy for illustration.</p>` },
  returns: { title: 'Returns & refunds', body: `<ul><li><b>30-day</b> returns on every item, for any reason.</li><li>Free pickup from your address.</li><li>Refunds land in <b>5–7 working days</b>.</li></ul><p class="m-note">Demo store — sample policy for illustration.</p>` },
  contact: { title: 'Contact us', body: `<div class="kv"><span>Email</span><span>hello@nextbuy.in</span></div><div class="kv"><span>Phone</span><span>+91 80 4567 8900</span></div><div class="kv"><span>Hours</span><span>Mon–Sat, 9am–7pm IST</span></div><p class="m-note">Demo store — contact details are illustrative.</p>` },
  gift: { title: 'NextBuy gift cards', body: `<p>A NextBuy gift card is the easy way to give someone their pick of the collection.</p><div class="kv"><span>Denominations</span><span>₹500 · ₹1,000 · ₹2,500 · ₹5,000</span></div><div class="kv"><span>Validity</span><span>12 months from issue</span></div><p class="m-note">Demo store — gift cards are not purchasable here.</p>` },
  sustainability: { title: 'Sustainability', body: `<ul><li>Recycled, plastic-free packaging.</li><li>Carbon-neutral delivery on metro routes.</li><li>Annual supplier audits.</li></ul><p class="m-note">Demo store — sample commitments.</p>` },
  careers: { title: 'Careers at NextBuy', body: `<p>We hire people who care about craft and detail.</p><ul><li>Senior Product Designer — Bengaluru</li><li>Supply Chain Associate — Bengaluru</li><li>Customer Experience Lead — Remote</li></ul><p class="m-note">Demo store — these roles are illustrative.</p>` },
  press: { title: 'Press & media', body: `<div class="kv"><span>Media enquiries</span><span>press@nextbuy.in</span></div><p class="m-note">Demo store — for illustration only.</p>` },
  privacy: { title: 'Privacy policy', body: `<p>We store your name, email and delivery details so we can fulfil orders. Passwords are hashed with scrypt — we never store them in plain text.</p><p>We never sell your data.</p><p class="m-note">Demo store — sample policy text, not legal advice.</p>` },
  terms: { title: 'Terms of service', body: `<p>By using NextBuy you agree to these sample terms. Prices are shown in ₹.</p><p class="m-note">Demo store — sample terms, not legal advice.</p>` },
  cookies: { title: 'Cookie policy', body: `<p>We set one cookie — <code>nb_sid</code> — to keep you signed in and remember your cart. It is HttpOnly and cannot be read by scripts.</p><p class="m-note">Demo store.</p>` },
};

const modalOverlay = $('modalOverlay');
function openModal(key) {
  const m = MODALS[key];
  if (!m) return;
  $('modalTitle').textContent = m.title;
  $('modalBody').innerHTML = m.body;
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modalOverlay.classList.remove('open');
  if (!drawer.classList.contains('open') && !$('checkoutView').classList.contains('open')) document.body.style.overflow = '';
}
$('modalClose').onclick = closeModal;
modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
document.querySelectorAll('[data-modal]').forEach((a) => {
  a.onclick = (e) => { e.preventDefault(); closeMobileMenu(); openModal(a.dataset.modal); };
});

/* ---------------------------- navigation ---------------------------- */
const burgerBtn = $('burger');
const mobileMenu = $('mobileMenu');
function closeMobileMenu() { mobileMenu.classList.remove('open'); burgerBtn.setAttribute('aria-expanded', 'false'); }
burgerBtn.onclick = () => {
  const open = mobileMenu.classList.toggle('open');
  burgerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
};
function scrollToId(id) { const el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

document.querySelectorAll('[data-goto]').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    closeMobileMenu();
    if (a.dataset.goto === 'shop') { badgeFilter = null; loadProducts(); }
    scrollToId(a.dataset.goto);
  };
});
document.querySelectorAll('[data-scroll-top]').forEach((a) => {
  a.onclick = (e) => { e.preventDefault(); closeMobileMenu(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
});
document.querySelectorAll('[data-badge]').forEach((a) => {
  a.onclick = (e) => {
    e.preventDefault();
    closeMobileMenu();
    badgeFilter = a.dataset.badge;
    activeCat = 'all'; query = ''; $('search').value = '';
    renderFilters(); loadProducts(); scrollToId('shop');
  };
});
document.querySelectorAll('[data-toast]').forEach((a) => {
  a.onclick = (e) => { e.preventDefault(); toast(`Demo store — ${a.dataset.toast} isn't connected yet`); };
});

/* ------------------------------ checkout ---------------------------- */
const checkoutView = $('checkoutView');
let ckStep = 1, ckPromo = null, ckDelivery = 'standard', ckPay = 'upi';

async function openCheckout() {
  if (!cart.count) { toast('Your cart is empty — add something first'); return; }
  closeCart();
  ckStep = 1;
  checkoutView.classList.add('open');
  checkoutView.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (currentUser) {
    try { ({ addresses: savedAddresses } = await API.get('/api/addresses')); } catch { savedAddresses = []; }
    // prefill from the customer's own details
    if (currentUser.name) $('ckName').value ||= currentUser.name;
    $('ckEmail').value ||= currentUser.email;
  } else {
    savedAddresses = [];
  }
  renderSavedAddresses();
  renderCheckout();
  checkoutView.scrollTop = 0;
}
function closeCheckout() {
  checkoutView.classList.remove('open');
  checkoutView.setAttribute('aria-hidden', 'true');
  if (!drawer.classList.contains('open')) document.body.style.overflow = '';
}
document.querySelectorAll('[data-ck-close]').forEach((el) => {
  el.onclick = (e) => { e.preventDefault(); closeCheckout(); };
});

function renderSavedAddresses() {
  const panel = document.querySelector('[data-panel="1"]');
  if (!panel) return;
  let box = $('ckSaved');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ckSaved';
    box.style.marginBottom = '22px';
    panel.insertBefore(box, panel.querySelector('.ck-grid'));
  }
  if (!savedAddresses.length) {
    box.innerHTML = currentUser ? '' : '<p class="ck-note" style="margin-bottom:20px">Checking out as a guest. <a href="account.html" style="color:var(--accent);font-weight:600">Sign in</a> to save your details and track orders.</p>';
    return;
  }
  box.innerHTML = `<h3 class="ck-h3" style="margin-top:0">Saved addresses</h3><div class="ck-opts">${
    savedAddresses.map((a) => `<label class="ck-opt"><input type="radio" name="ckSavedAddr" value="${a.id}"><span><b>${esc(a.name)}</b><small>${esc(a.line1)}, ${esc(a.city)} ${esc(a.pin)}</small></span></label>`).join('')
  }</div>`;
  box.querySelectorAll('input[name="ckSavedAddr"]').forEach((r) => {
    r.onchange = () => {
      const a = savedAddresses.find((x) => String(x.id) === r.value);
      if (!a) return;
      $('ckName').value = a.name; $('ckPhone').value = a.phone;
      $('ckAddr').value = a.line1; $('ckCity').value = a.city;
      $('ckState').value = a.state; $('ckPin').value = a.pin;
      toast('Address filled in');
    };
  });
}

function goStep(n) {
  if (typeof ckStep === 'number' && n > ckStep) {
    if (ckStep === 1 && !validateDelivery()) return;
    if (ckStep === 2 && !validatePayment()) return;
  }
  ckStep = n;
  renderCheckout();
  checkoutView.scrollTop = 0;
}
document.querySelectorAll('[data-ck-edit]').forEach((a) => {
  a.onclick = (e) => { e.preventDefault(); goStep(Number(a.dataset.ckEdit)); };
});
$('ckTo2').onclick = () => goStep(2);
$('ckTo3').onclick = () => goStep(3);
$('ckBack1').onclick = () => goStep(1);
$('ckBack2').onclick = () => goStep(2);
$('ckPlace').onclick = placeOrder;
$('ckDone').onclick = () => { resetCheckout(); closeCheckout(); toast('Thanks for shopping with NextBuy'); };

/* ---- validation (mirrors the server, but the server is authoritative) ---- */
function setErr(id, msg) {
  const el = $(id);
  const field = el.closest('.ck-field');
  if (field) {
    field.classList.toggle('invalid', !!msg);
    const e = field.querySelector('.ck-err');
    if (e) e.textContent = msg || '';
  }
  return !msg;
}
function validateDelivery() {
  let ok = true;
  ok = setErr('ckName', $('ckName').value.trim().length < 2 ? 'Please enter your full name' : '') && ok;
  ok = setErr('ckEmail', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('ckEmail').value.trim()) ? 'Enter a valid email address' : '') && ok;
  const phone = $('ckPhone').value.replace(/\D/g, '');
  ok = setErr('ckPhone', !(phone.length === 10 || (phone.length === 12 && phone.startsWith('91'))) ? 'Enter a 10-digit mobile number' : '') && ok;
  ok = setErr('ckAddr', $('ckAddr').value.trim().length < 4 ? 'Enter your street address' : '') && ok;
  ok = setErr('ckCity', $('ckCity').value.trim().length < 2 ? 'Enter your city' : '') && ok;
  ok = setErr('ckState', $('ckState').value.trim().length < 2 ? 'Enter your state' : '') && ok;
  ok = setErr('ckPin', $('ckPin').value.replace(/\D/g, '').length !== 6 ? 'Enter a 6-digit PIN code' : '') && ok;
  if (!ok) toast('Please fix the highlighted fields');
  return ok;
}
function validatePayment() {
  let ok = true;
  if (ckPay === 'upi') {
    ok = setErr('ckUpi', !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test($('ckUpi').value.trim()) ? 'Enter a valid UPI ID (e.g. name@bank)' : '') && ok;
  } else if (ckPay === 'card') {
    ok = setErr('ckCardNum', !/^\d{16}$/.test($('ckCardNum').value.replace(/\s/g, '')) ? 'Enter the 16-digit card number' : '') && ok;
    ok = setErr('ckCardExp', !/^(0[1-9]|1[0-2])\/\d{2}$/.test($('ckCardExp').value.trim()) ? 'Use MM/YY' : '') && ok;
    ok = setErr('ckCardCvv', !/^\d{3,4}$/.test($('ckCardCvv').value.trim()) ? '3-digit CVV' : '') && ok;
    ok = setErr('ckCardName', $('ckCardName').value.trim().length < 2 ? 'Enter the name on the card' : '') && ok;
  } else if (ckPay === 'netbanking') {
    ok = setErr('ckBank', !$('ckBank').value ? 'Choose your bank' : '') && ok;
  }
  if (!ok) toast('Please fix the highlighted fields');
  return ok;
}

document.querySelectorAll('input[name="ckPay"]').forEach((r) => {
  r.onchange = () => {
    ckPay = r.value;
    document.querySelectorAll('[data-pay-panel]').forEach((p) => { p.hidden = p.dataset.payPanel !== ckPay; });
    renderCheckoutSummary();
  };
});
document.querySelectorAll('input[name="ckDelivery"]').forEach((r) => {
  r.onchange = () => { ckDelivery = r.value; renderCheckoutSummary(); };
});
$('ckPromoBtn').onclick = applyPromo;
$('ckPromo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } });
function applyPromo() {
  const code = $('ckPromo').value.trim().toUpperCase();
  const msg = $('ckPromoMsg');
  if (code === 'NEXT10') { ckPromo = { code, pct: 10 }; msg.textContent = 'NEXT10 applied — 10% off'; msg.className = 'ck-promo-msg ok'; }
  else if (!code) { ckPromo = null; msg.textContent = 'Enter a promo code'; msg.className = 'ck-promo-msg bad'; }
  else { ckPromo = null; msg.textContent = "That code isn't valid"; msg.className = 'ck-promo-msg bad'; }
  renderCheckoutSummary();
}

function renderCheckout() {
  const done = ckStep === 'done';
  checkoutView.classList.toggle('done', done);
  document.querySelectorAll('.ck-panel').forEach((p) => { p.hidden = String(p.dataset.panel) !== String(ckStep); });
  document.querySelectorAll('.ck-step').forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle('active', !done && n === ckStep);
    s.classList.toggle('done', !done && n < ckStep);
  });
  $('ckStepsBar').hidden = done;
  if (done) return;
  renderCheckoutSummary();
  if (ckStep === 3) renderReview();
}
function renderCheckoutSummary() {
  const t = localCheckoutTotals();
  $('ckItems').innerHTML = cart.items.map((i) => `
    <div class="ck-item">
      <div class="ck-item-media"><img src="${esc(i.image)}" alt=""></div>
      <div><div class="ck-item-name">${esc(i.name)}</div><div class="ck-item-meta">Qty ${i.qty} · ${rupee(i.price)}</div></div>
      <div class="ck-item-amt">${rupee(i.lineTotal)}</div>
    </div>`).join('');
  $('ckSub').textContent = rupee(t.subtotal);
  $('ckShip').textContent = t.shipping === 0 ? 'Free' : rupee(t.shipping);
  $('ckDiscountRow').style.display = t.discount > 0 ? 'flex' : 'none';
  if (t.discount > 0) $('ckDiscount').textContent = '−' + rupee(t.discount);
  $('ckCodRow').style.display = t.cod > 0 ? 'flex' : 'none';
  if (t.cod > 0) $('ckCod').textContent = rupee(t.cod);
  $('ckTotal').textContent = rupee(t.total);
}
function renderReview() {
  const v = (id) => esc($(id).value.trim());
  $('ckReviewAddr').innerHTML = `<b>${v('ckName')}</b><br>${v('ckAddr')}<br>${v('ckCity')}, ${v('ckState')} ${$('ckPin').value.replace(/\D/g, '')}<br>${v('ckPhone')} · ${v('ckEmail')}`;
  let pay = PAY_LABELS[ckPay];
  if (ckPay === 'upi') pay += ' · ' + v('ckUpi');
  if (ckPay === 'card') pay += ' · •••• ' + $('ckCardNum').value.replace(/\s/g, '').slice(-4);
  if (ckPay === 'netbanking') pay += ' · ' + v('ckBank');
  if (ckPay === 'cod') pay += ' · pay ' + rupee(localCheckoutTotals().cod) + ' on delivery';
  $('ckReviewPay').textContent = pay;
  $('ckDeliveryLabel').textContent = ckDelivery === 'express' ? 'Express — 1–2 business days (₹99)' : 'Standard — 3–5 business days (Free)';
}

async function placeOrder() {
  if (!validateDelivery()) { goStep(1); return; }
  if (!validatePayment()) { goStep(2); return; }

  const btn = $('ckPlace');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Processing…';

  const payload = {
    name: $('ckName').value.trim(),
    email: $('ckEmail').value.trim(),
    phone: $('ckPhone').value.trim(),
    line1: $('ckAddr').value.trim(),
    city: $('ckCity').value.trim(),
    state: $('ckState').value.trim(),
    pin: $('ckPin').value.trim(),
    deliverySpeed: ckDelivery,
    paymentMethod: ckPay,
    promo: ckPromo ? ckPromo.code : null,
    saveAddress: !!currentUser,
    upiId: $('ckUpi').value.trim(),
    cardNumber: $('ckCardNum').value.replace(/\s/g, ''),
    cardExpiry: $('ckCardExp').value.trim(),
    cardCvv: $('ckCardCvv').value.trim(),
    cardName: $('ckCardName').value.trim(),
    bank: $('ckBank').value,
  };

  try {
    const { order } = await API.post('/api/orders', payload);
    $('ckOrderId').textContent = order.orderNo;
    $('ckOrderTotal').textContent = rupee(order.total) + (order.paymentMethod === 'cod' ? ' (due on delivery)' : ' paid');
    $('ckOrderPay').textContent = PAY_LABELS[order.paymentMethod];
    $('ckOrderEta').textContent = order.deliverySpeed === 'express' ? '1–2 business days' : '3–5 business days';
    $('ckOrderEmail').textContent = order.email;
    ckStep = 'done';
    await loadCart();
    renderCheckout();
    checkoutView.scrollTop = 0;
  } catch (e) {
    toast(e.message);
    if (e.status === 401 || e.status === 403) closeCheckout();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function resetCheckout() {
  ckStep = 1; ckPromo = null; ckDelivery = 'standard'; ckPay = 'upi';
  document.querySelectorAll('.ck-field').forEach((f) => { f.classList.remove('invalid'); const e = f.querySelector('.ck-err'); if (e) e.textContent = ''; });
  ['ckName', 'ckEmail', 'ckPhone', 'ckPin', 'ckAddr', 'ckCity', 'ckState', 'ckUpi', 'ckCardNum', 'ckCardExp', 'ckCardCvv', 'ckCardName', 'ckPromo']
    .forEach((id) => { const el = $(id); if (el) el.value = ''; });
  $('ckBank').value = '';
  document.querySelector('input[name="ckDelivery"][value="standard"]').checked = true;
  document.querySelector('input[name="ckPay"][value="upi"]').checked = true;
  document.querySelectorAll('[data-pay-panel]').forEach((p) => { p.hidden = p.dataset.payPanel !== 'upi'; });
  $('ckPromoMsg').textContent = '';
  $('ckPromoMsg').className = 'ck-promo-msg';
  checkoutView.classList.remove('done');
}
$('checkout').onclick = openCheckout;

/* ------------------------------ reveal ------------------------------ */
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

/* ------------------------------- init ------------------------------- */
(async function init() {
  if (IS_FILE_PROTOCOL) {
    // api.js has already shown the notice; make the grid explain itself too.
    const g = document.getElementById('grid');
    if (g) g.innerHTML = '<div class="empty"><b>Products need the server</b>Run <code>npm start</code> and open <a href="http://localhost:3000">http://localhost:3000</a> instead of opening this file.</div>';
    const rc = document.getElementById('resultCount');
    if (rc) rc.textContent = '';
    return;
  }
  currentUser = await initHeader();
  await Promise.all([loadCategories(), loadCart()]);
  await loadProducts();
})();
