/* ==================================================================
   Account page — sign in / register, order history, saved addresses.
   Depends on api.js (API, rupee, esc, toast, initHeader, dateFmt).
   ================================================================== */

const $ = (id) => document.getElementById(id);
let mode = 'login';
let user = null;

/* ------------------------------ rendering --------------------------- */
function showAuth() {
  $('authSection').hidden = false;
  $('accountSection').hidden = true;
  setMode('login');
}
function showAccount() {
  $('authSection').hidden = true;
  $('accountSection').hidden = false;
  $('helloName').textContent = `Hello, ${(user.name || '').split(' ')[0] || 'there'}`;
  $('helloEmail').textContent = user.email;
  loadOrders();
  loadAddresses();
}

function setMode(next) {
  mode = next;
  const isLogin = next === 'login';
  $('authTitle').textContent = isLogin ? 'Sign in' : 'Create your account';
  $('authSub').textContent = isLogin ? 'Welcome back — pick up where you left off.' : 'Save your details, track orders and check out faster.';
  $('nameField').hidden = isLogin;
  $('pwHint').hidden = isLogin;
  $('authSubmit').textContent = isLogin ? 'Sign in' : 'Create account';
  $('auPassword').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
  $('authSwitch').innerHTML = isLogin
    ? 'New here? <a href="#" id="toRegister">Create an account</a>'
    : 'Already have an account? <a href="#" id="toLogin">Sign in</a>';
  bindSwitch();
  $('authError').hidden = true;
}
function bindSwitch() {
  const r = $('toRegister');
  const l = $('toLogin');
  if (r) r.onclick = (e) => { e.preventDefault(); setMode('register'); };
  if (l) l.onclick = (e) => { e.preventDefault(); setMode('login'); };
}

function authError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.hidden = !msg;
}

/* -------------------------------- auth ------------------------------ */
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  authError('');
  const btn = $('authSubmit');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    const body = { email: $('auEmail').value.trim(), password: $('auPassword').value };
    if (mode === 'register') body.name = $('auName').value.trim();
    const { user: u } = await API.post(mode === 'register' ? '/api/auth/register' : '/api/auth/login', body);
    user = u;
    await initHeader();
    showAccount();
    toast(mode === 'register' ? 'Welcome to NextBuy' : 'Signed in');
  } catch (err) {
    authError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('signOut').onclick = async () => {
  try { await API.post('/api/auth/logout'); } catch { /* ignore */ }
  user = null;
  await initHeader();
  toast('Signed out');
  showAuth();
};

/* ------------------------------- orders ----------------------------- */
async function loadOrders() {
  const box = $('ordersBody');
  box.innerHTML = '<p style="color:var(--text-dim)">Loading your orders…</p>';
  try {
    const { orders } = await API.get('/api/orders');
    if (!orders.length) {
      box.innerHTML = `<div class="empty-state"><b>No orders yet</b>When you place an order it will appear here.<br><br><a class="btn btn-primary" href="index.html#shop">Start shopping</a></div>`;
      return;
    }
    box.innerHTML = `<div class="order-list">${orders.map(orderCard).join('')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
  }
}

function orderCard(o) {
  const eta = o.deliverySpeed === 'express' ? '1–2 business days' : '3–5 business days';
  return `
    <article class="order-card">
      <div class="order-head">
        <div>
          <div class="ono">${esc(o.orderNo)}</div>
          <div class="meta">Placed ${esc(dateFmt(o.createdAt))} · ${esc(PAY_LABELS[o.paymentMethod] || o.paymentMethod)} · ${esc(eta)}</div>
        </div>
        <span class="pill ${esc(o.status)}">${esc(o.status)}</span>
      </div>
      <div class="order-body">
        ${o.items.map((i) => `
          <div class="order-line">
            <div class="thumb">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}</div>
            <div><div class="nm">${esc(i.name)}</div><div class="qt">Qty ${i.qty} · ${rupee(i.price)} each</div></div>
            <div class="amt">${rupee(i.lineTotal)}</div>
          </div>`).join('')}
      </div>
      <div class="order-foot">
        <span>Delivering to <b>${esc(o.shippingAddress.name)}</b>, ${esc(o.shippingAddress.city)} ${esc(o.shippingAddress.pin)}</span>
        <span>Total <b>${rupee(o.total)}</b>${o.discount ? ` <span style="color:var(--sage)">(saved ${rupee(o.discount)})</span>` : ''}</span>
      </div>
    </article>`;
}

/* ------------------------------ addresses --------------------------- */
async function loadAddresses() {
  const box = $('addrList');
  try {
    const { addresses } = await API.get('/api/addresses');
    if (!addresses.length) {
      box.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>No saved addresses</b>Add one above and it will be offered at checkout.</div>`;
      return;
    }
    box.innerHTML = addresses.map((a) => `
      <div class="addr-card">
        <button class="del" data-del-addr="${a.id}">Remove</button>
        <div class="lbl">${esc(a.label || 'Address')}</div>
        <b>${esc(a.name)}</b>
        ${esc(a.line1)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pin)}<br>${esc(a.phone)}
      </div>`).join('');
    box.querySelectorAll('[data-del-addr]').forEach((b) => {
      b.onclick = async () => {
        try { await API.del(`/api/addresses/${b.dataset.delAddr}`); toast('Address removed'); loadAddresses(); }
        catch (e) { toast(e.message); }
      };
    });
  } catch (e) {
    box.innerHTML = `<div class="alert error">${esc(e.message)}</div>`;
  }
}

$('addAddr').onclick = async () => {
  const body = {
    label: $('adLabel').value.trim() || null,
    name: $('adName').value.trim(),
    phone: $('adPhone').value.trim(),
    line1: $('adLine1').value.trim(),
    city: $('adCity').value.trim(),
    state: $('adState').value.trim(),
    pin: $('adPin').value.trim(),
  };
  try {
    await API.post('/api/addresses', body);
    ['adLabel', 'adName', 'adPhone', 'adLine1', 'adCity', 'adState', 'adPin'].forEach((id) => { $(id).value = ''; });
    toast('Address saved');
    loadAddresses();
  } catch (e) { toast(e.message); }
};

/* -------------------------------- tabs ------------------------------ */
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('tabOrders').hidden = t.dataset.tab !== 'orders';
    $('tabAddresses').hidden = t.dataset.tab !== 'addresses';
  };
});

/* -------------------------------- init ------------------------------ */
(async function init() {
  if (IS_FILE_PROTOCOL) return; // api.js has already shown the notice
  user = await initHeader();
  if (user) showAccount(); else showAuth();
})();
