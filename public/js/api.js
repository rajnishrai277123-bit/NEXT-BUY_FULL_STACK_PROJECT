/* Shared helpers for every page: fetch wrapper + formatting. */

/* ------------------------------------------------------------------ *
 * Guard: this app talks to a REST API, so it must be served by the
 * Node server. Opening index.html straight off disk (file://) makes
 * every fetch fail with a confusing "Failed to fetch".
 * ------------------------------------------------------------------ */
const IS_FILE_PROTOCOL = location.protocol === 'file:';

function showServerNotice() {
  if (!IS_FILE_PROTOCOL || document.getElementById('serverNotice')) return;
  const el = document.createElement('div');
  el.id = 'serverNotice';
  el.className = 'server-notice';
  el.innerHTML = `
    <div class="sn-inner">
      <b>NextBuy needs its server running</b>
      <p>You've opened this page as a file, so it can't reach the API. Start the server and use the address below instead.</p>
      <ol>
        <li>Open a terminal in the project folder</li>
        <li>Run <code>npm install</code>, then <code>npm run seed</code>, then <code>npm start</code></li>
        <li>Open <code>http://localhost:3000</code> — not the file itself</li>
      </ol>
    </div>`;
  document.body.prepend(el);
}
if (IS_FILE_PROTOCOL && document.body) showServerNotice();

const SERVER_REQUIRED_MSG =
  'This page needs the NextBuy server. Run "npm start" and open http://localhost:3000';

const API = {
  async request(method, path, body) {
    if (IS_FILE_PROTOCOL) throw new Error(SERVER_REQUIRED_MSG);
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body),
  patch: (path, body) => API.request('PATCH', path, body),
  del: (path) => API.request('DELETE', path),
};

/** ₹1,23,456 — Indian digit grouping. */
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

/** Escape anything that goes into innerHTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const PAY_LABELS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', cod: 'Cash on delivery' };
const STATUSES = ['confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];

const dateFmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Render the header account chip + return the current user (or null). */
async function initHeader() {
  const link = document.getElementById('acctLink');
  const av = document.getElementById('acctAv');
  const nm = document.getElementById('acctName');
  let user = null;
  try {
    ({ user } = await API.get('/api/auth/me'));
  } catch { /* offline or not served */ }

  if (link && av && nm) {
    if (user) {
      av.textContent = (user.name || user.email).trim().charAt(0).toUpperCase();
      nm.textContent = (user.name || '').split(' ')[0] || 'Account';
      link.href = 'account.html';
    } else {
      av.textContent = '→';
      nm.textContent = 'Sign in';
      link.href = 'account.html';
    }
  }
  return user;
}

/** Small transient toast, matching the storefront one. */
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  document.getElementById('toastText').textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
