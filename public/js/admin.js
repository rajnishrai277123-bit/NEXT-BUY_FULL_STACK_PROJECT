/* ==================================================================
   Admin panel — dashboard, product CRUD, order management.
   Depends on api.js (API, rupee, esc, toast, initHeader, dateFmt, STATUSES).
   ================================================================== */

const $ = (id) => document.getElementById(id);
let categories = [];
let products = [];
let editingId = null;
let imageOptions = [];

/* -------------------------------- gate ------------------------------ */
$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('gateError');
  err.hidden = true;
  const btn = $('gSubmit');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { user } = await API.post('/api/auth/login', { email: $('gEmail').value.trim(), password: $('gPassword').value });
    if (!user.isAdmin) {
      err.textContent = 'That account does not have admin access.';
      err.hidden = false;
      await API.post('/api/auth/logout');
      return;
    }
    await start();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('adminSignOut').onclick = async () => {
  try { await API.post('/api/auth/logout'); } catch { /* ignore */ }
  location.reload();
};

/* ------------------------------ dashboard --------------------------- */
async function start() {
  $('gate').hidden = true;
  $('dash').hidden = false;

  const user = await initHeader();
  $('adminWho').textContent = user ? `Signed in as ${user.email}` : '';

  const [{ categories: cats }, { products: prods }] = await Promise.all([
    API.get('/api/categories'),
    API.get('/api/admin/products'),
  ]);
  categories = cats;
  products = prods;

  imageOptions = [...new Set(products.map((p) => p.image.replace('/images/', '')))].sort();
  $('pfCategory').innerHTML = categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('pfImage').innerHTML = imageOptions.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');

  await Promise.all([loadStats(), loadProductsTable(), loadOrdersTable()]);
}

async function loadStats() {
  const { stats, lowStock, recentOrders } = await API.get('/api/admin/stats');
  $('stats').innerHTML = [
    { k: 'Products', v: stats.products, d: 'active in catalogue' },
    { k: 'Orders', v: stats.orders, d: 'all time' },
    { k: 'Revenue', v: rupee(stats.revenue), d: 'excluding cancelled' },
    { k: 'Customers', v: stats.customers, d: 'registered accounts' },
  ].map((s) => `<div class="stat-card"><div class="k">${esc(s.k)}</div><div class="v">${esc(String(s.v))}</div><div class="d">${esc(s.d)}</div></div>`).join('');

  $('lowStock').innerHTML = lowStock.length
    ? lowStock.map((p) => `<div class="item">${esc(p.name)} · <b>${p.stock}</b> left</div>`).join('')
    : '<div class="item" style="color:var(--text-dim)">Everything is comfortably in stock.</div>';

  $('recentBody').innerHTML = recentOrders.length
    ? recentOrders.map((o) => `
        <tr>
          <td class="ono" style="font-family:var(--font-mono);font-size:12.5px">${esc(o.orderNo)}</td>
          <td>${esc(o.email)}</td>
          <td>${esc(dateFmt(o.createdAt))}</td>
          <td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td>
          <td class="num">${rupee(o.total)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" style="color:var(--text-dim)">No orders yet.</td></tr>';
}

/* ------------------------------- products --------------------------- */
async function loadProductsTable() {
  $('productBody').innerHTML = products.map((p) => `
    <tr>
      <td><div class="prod-cell"><img src="${esc(p.image)}" alt=""><span>${esc(p.name)}</span></div></td>
      <td>${esc(p.category)}</td>
      <td>${p.badge ? `<span class="pill">${esc(p.badge)}</span>` : '<span style="color:var(--text-faint)">—</span>'}</td>
      <td class="num">${rupee(p.price)}</td>
      <td class="num" style="${p.stock <= 20 ? 'color:var(--accent);font-weight:600' : ''}">${p.stock}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" data-edit="${p.id}">Edit</button>
        <button class="btn-sm danger" data-del="${p.id}">Delete</button>
      </td>
    </tr>`).join('');

  $('productBody').querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openForm(Number(b.dataset.edit)); });
  $('productBody').querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteProduct(Number(b.dataset.del)); });
}

function openForm(id = null) {
  editingId = id;
  const p = id ? products.find((x) => x.id === id) : null;
  $('pfTitle').textContent = p ? `Edit — ${p.name}` : 'Add product';
  $('pfName').value = p ? p.name : '';
  $('pfCategory').value = p ? String(categories.find((c) => c.name === p.category)?.id || '') : (categories[0] ? categories[0].id : '');
  $('pfImage').value = p ? p.image.replace('/images/', '') : (imageOptions[0] || '');
  $('pfPrice').value = p ? p.price : '';
  $('pfCompare').value = p && p.compareAt ? p.compareAt : '';
  $('pfStock').value = p ? p.stock : '';
  $('pfBadge').value = p && p.badge ? p.badge : '';
  $('pfRating').value = p ? p.rating : '';
  $('pfReviews').value = p ? p.reviews : '';
  $('pfDescription').value = p && p.description ? p.description : '';
  $('productForm').hidden = false;
  $('productForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('newProduct').onclick = () => openForm(null);
$('pfCancel').onclick = () => { $('productForm').hidden = true; editingId = null; };

$('pfSave').onclick = async () => {
  const body = {
    name: $('pfName').value.trim(),
    categoryId: Number($('pfCategory').value),
    image: $('pfImage').value,
    price: Number($('pfPrice').value),
    compareAt: $('pfCompare').value === '' ? null : Number($('pfCompare').value),
    stock: Number($('pfStock').value || 0),
    badge: $('pfBadge').value || null,
    rating: Number($('pfRating').value || 0),
    reviews: Number($('pfReviews').value || 0),
    description: $('pfDescription').value.trim() || null,
  };
  try {
    if (editingId) await API.request('PUT', `/api/admin/products/${editingId}`, body);
    else await API.post('/api/admin/products', body);
    toast(editingId ? 'Product updated' : 'Product created');
    $('productForm').hidden = true;
    editingId = null;
    products = (await API.get('/api/admin/products')).products;
    await Promise.all([loadProductsTable(), loadStats()]);
  } catch (e) { toast(e.message); }
};

async function deleteProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
  try {
    await API.del(`/api/admin/products/${id}`);
    toast('Product deleted');
    products = (await API.get('/api/admin/products')).products;
    await Promise.all([loadProductsTable(), loadStats()]);
  } catch (e) { toast(e.message); }
}

/* -------------------------------- orders ---------------------------- */
async function loadOrdersTable() {
  const { orders } = await API.get('/api/admin/orders');
  $('orderBody').innerHTML = orders.length
    ? orders.map((o) => `
        <tr>
          <td style="font-family:var(--font-mono);font-size:12.5px">${esc(o.orderNo)}</td>
          <td>${esc(o.email)}<div style="font-size:12px;color:var(--text-faint)">${esc(o.shippingAddress.city)} ${esc(o.shippingAddress.pin)}</div></td>
          <td>${o.items.reduce((s, i) => s + i.qty, 0)}</td>
          <td>${esc(dateFmt(o.createdAt))}</td>
          <td class="num">${rupee(o.total)}</td>
          <td>
            <select class="status-select" data-order="${o.id}">
              ${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="6" style="color:var(--text-dim)">No orders yet.</td></tr>';

  $('orderBody').querySelectorAll('[data-order]').forEach((sel) => {
    sel.onchange = async () => {
      try {
        await API.patch(`/api/admin/orders/${sel.dataset.order}`, { status: sel.value });
        toast(`Order marked ${sel.value}`);
        loadStats();
      } catch (e) { toast(e.message); loadOrdersTable(); }
    };
  });
}

/* --------------------------------- init ----------------------------- */
(async function init() {
  if (IS_FILE_PROTOCOL) return; // api.js has already shown the notice
  const user = await initHeader();
  if (user && user.isAdmin) {
    await start();
  } else {
    $('gate').hidden = false;
    if (user) $('gEmail').value = user.email;
  }
})();
