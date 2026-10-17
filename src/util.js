'use strict';

/** Promo codes the server knows about. Kept server-side so they can't be faked. */
const PROMOS = { NEXT10: 10 }; // code -> percent off

const DELIVERY_FEE = { standard: 0, express: 99 };
const COD_FEE = 40;
const FREE_SHIPPING_OVER = 999;
const FLAT_SHIPPING = 79;

/* ---------------------------- validation ---------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPI_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;
const CARD_RE = /^\d{16}$/;
const EXPIRY_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;
const CVV_RE = /^\d{3,4}$/;
const PIN_RE = /^\d{6}$/;

const PAYMENT_METHODS = ['upi', 'card', 'netbanking', 'cod'];
const DELIVERY_SPEEDS = ['standard', 'express'];

function str(value, { min = 0, max = 500, field = 'value' } = {}) {
  if (typeof value !== 'string') throw httpError(400, `${field} is required.`);
  const v = value.trim();
  if (v.length < min) throw httpError(400, `${field} must be at least ${min} characters.`);
  if (v.length > max) throw httpError(400, `${field} is too long.`);
  return v;
}

function email(value) {
  const v = str(value, { min: 3, max: 200, field: 'Email' }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw httpError(400, 'Enter a valid email address.');
  return v;
}

function phone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^\d{10}$/.test(local)) throw httpError(400, 'Enter a 10-digit mobile number.');
  return local;
}

function pin(value) {
  const v = String(value ?? '').replace(/\D/g, '');
  if (!PIN_RE.test(v)) throw httpError(400, 'Enter a 6-digit PIN code.');
  return v;
}

function int(value, { min = 1, max = 9999, field = 'Value' } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Validate a payment payload server-side (never trust the browser). */
function validatePayment(method, body) {
  if (!PAYMENT_METHODS.includes(method)) throw httpError(400, 'Choose a payment method.');
  if (method === 'upi') {
    const v = str(body.upiId, { min: 3, max: 100, field: 'UPI ID' });
    if (!UPI_RE.test(v)) throw httpError(400, 'Enter a valid UPI ID (e.g. name@bank).');
  } else if (method === 'card') {
    const num = String(body.cardNumber ?? '').replace(/\s/g, '');
    if (!CARD_RE.test(num)) throw httpError(400, 'Enter the 16-digit card number.');
    if (!EXPIRY_RE.test(str(body.cardExpiry, { min: 4, max: 5, field: 'Expiry' }))) throw httpError(400, 'Expiry must be in MM/YY format.');
    if (!CVV_RE.test(str(body.cardCvv, { min: 3, max: 4, field: 'CVV' }))) throw httpError(400, 'Enter a valid CVV.');
    str(body.cardName, { min: 2, max: 120, field: 'Name on card' });
  } else if (method === 'netbanking') {
    str(body.bank, { min: 2, max: 80, field: 'Bank' });
  }
  return method;
}

/* ------------------------------ totals ------------------------------ */
/**
 * Single source of truth for order maths. Prices come from the database,
 * never from the client.
 */
function computeTotals({ items, promo, deliverySpeed = 'standard', paymentMethod = 'upi' }) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const baseShipping = subtotal === 0 ? 0 : (subtotal >= FREE_SHIPPING_OVER ? 0 : FLAT_SHIPPING);
  const shipping = subtotal === 0 ? 0 : baseShipping + (DELIVERY_FEE[deliverySpeed] ?? 0);
  const pct = PROMOS[promo] || 0;
  const discount = pct ? Math.round((subtotal * pct) / 100) : 0;
  const codFee = paymentMethod === 'cod' && subtotal > 0 ? COD_FEE : 0;
  const total = Math.max(0, subtotal - discount + shipping + codFee);
  return { subtotal, discount, shipping, codFee, total };
}

/* ---------------------------- serializers --------------------------- */
function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    categorySlug: row.category_slug,
    price: row.price,
    compareAt: row.compare_at,
    rating: row.rating,
    reviews: row.reviews,
    badge: row.badge,
    image: `/images/${row.image}`,
    stock: row.stock,
    active: !!row.active,
  };
}

function serializeCartItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    price: row.price,
    image: `/images/${row.image}`,
    qty: row.qty,
    lineTotal: row.price * row.qty,
    stock: row.stock,
  };
}

function serializeOrder(row, itemRows) {
  return {
    id: row.id,
    orderNo: row.order_no,
    email: row.email,
    subtotal: row.subtotal,
    discount: row.discount,
    shipping: row.shipping,
    codFee: row.cod_fee,
    total: row.total,
    promo: row.promo,
    paymentMethod: row.payment_method,
    deliverySpeed: row.delivery_speed,
    status: row.status,
    createdAt: row.created_at,
    customer: row.user_name ? { name: row.user_name, email: row.email } : null,
    shippingAddress: {
      name: row.ship_name,
      phone: row.ship_phone,
      line1: row.ship_line1,
      city: row.ship_city,
      state: row.ship_state,
      pin: row.ship_pin,
    },
    items: itemRows.map((i) => ({
      productId: i.product_id,
      name: i.name,
      image: i.image ? `/images/${i.image}` : null,
      price: i.price,
      qty: i.qty,
      lineTotal: i.price * i.qty,
    })),
  };
}

module.exports = {
  PROMOS,
  DELIVERY_FEE,
  COD_FEE,
  FREE_SHIPPING_OVER,
  FLAT_SHIPPING,
  PAYMENT_METHODS,
  DELIVERY_SPEEDS,
  str, email, phone, pin, int,
  httpError,
  validatePayment,
  computeTotals,
  serializeProduct,
  serializeCartItem,
  serializeOrder,
};
