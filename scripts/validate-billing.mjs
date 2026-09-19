#!/usr/bin/env node
/**
 * Billing acceptance suite — the nine scenarios in section 9 of the intern brief.
 *
 *   A  Scan the same SKU twice: one line, quantity 2; stock unchanged before approval.
 *   B  A second checkout after a completed one still scans and prices.
 *   C  Payment received, not yet approved: no bill, stock unchanged.
 *   D  Staff approve: exactly one bill, stock reduced by the bill quantity.
 *   E  Duplicate webhook and staff double-click: still one bill, one deduction.
 *   F  Insufficient stock at approval: refused cleanly; no bill, no stock change.
 *   G  Payment failure and staff rejection: no bill, no deduction.
 *   H  Import stock: quantity increases and an outbox event is queued.
 *   I  The 30-minute sync in a safe test mode: events reach the original once, a rerun
 *      sends nothing, reconciliation is clean.
 *
 * Runs against a production build with the real presence check, the real webhook
 * signature check, and the real sync — all pointed at throwaway databases. The payment
 * gateway is Cashfree with harness credentials: the webhook is signed here with the same
 * secret key the server is started with, exactly as Cashfree signs it (base64 HMAC-SHA256
 * over timestamp + raw body). No real gateway is ever called; the suite never asks the
 * server to *open* a payment.
 *
 * Usage:
 *   node scripts/validate-billing.mjs              # build, provision, start, test, tear down
 *   node scripts/validate-billing.mjs --no-build   # reuse an existing .next build
 */

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  provisionValidationDatabase,
  PRODUCTS,
  VALIDATION_DATABASE_URL,
  VALIDATION_DATABASE_URL_FROM_APP,
} from './validation-fixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'apps', 'customer-web');
const ORIGIN_DIR = path.join(ROOT, '.data', 'validation-origin');
const ORIGIN_URL_FROM_APP = 'file:../../.data/validation-origin';

const QR_SECRET = 'billing-suite-qr-secret-do-not-deploy';
const SESSION_SECRET = 'billing-suite-session-secret-do-not-deploy';
const ADMIN_TOKEN = 'billing-suite-admin-token-do-not-deploy';
const EXIT_TOKEN_SECRET = 'billing-suite-exit-token-secret-do-not-deploy';
const CASHFREE_SECRET = 'billing-suite-cashfree-secret-do-not-deploy';

const STORE = { id: 'store_1', ip: '198.51.100.24' };
const OWNER = { email: 'owner@billing-suite.test', password: 'correct-horse-battery', name: 'Suite Owner' };

/** The SKUs the scenarios move. Looked up from the shared fixtures so the two cannot drift. */
const PEPSI = PRODUCTS.find((p) => p.id === 'p1');
const COKE = PRODUCTS.find((p) => p.id === 'p2');
const MILK = PRODUCTS.find((p) => p.id === 'p3');
const SALT = PRODUCTS.find((p) => p.id === 'p5');
const DELIVERY = 40;

let BASE_URL = '';
const results = [];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function scenario(id, description, fn) {
  try {
    const detail = await fn();
    results.push({ id, ok: true });
    console.log(`  \x1b[32mPASS\x1b[0m ${id}  ${description}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  } catch (error) {
    results.push({ id, ok: false, detail: error.message });
    console.log(`  \x1b[31mFAIL\x1b[0m ${id}  ${description}\n         \x1b[31m${error.message}\x1b[0m`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStatus(response, status) {
  expect(
    response.status === status,
    `expected HTTP ${status}, got ${response.status} (body: ${response.text.slice(0, 200)})`
  );
}

async function api(pathname, { method = 'GET', ip, token, cookie, body, raw, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (ip) requestHeaders['x-forwarded-for'] = ip;
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (cookie) requestHeaders.cookie = cookie;
  if (body !== undefined || raw !== undefined) requestHeaders['content-type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: requestHeaders,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON surfaces through `text` */
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function startSession(ip = STORE.ip) {
  const qr = await api(`/api/store/${STORE.id}/entry-qr`);
  expectStatus(qr, 200);
  const started = await api('/api/session/start', { method: 'POST', ip, body: { qr_token: qr.json.qr_token } });
  expectStatus(started, 201);
  return started.json.session_token;
}

/** What the operator sees, which includes stock. */
async function stockOf(productId) {
  const response = await api(`/api/admin/products?store_id=${STORE.id}`, { token: ADMIN_TOKEN });
  expectStatus(response, 200);
  const product = response.json.products.find((p) => p.id === productId);
  expect(product, `product ${productId} not in the operator listing`);
  return product.stock_quantity;
}

async function setStock(productId, quantity) {
  const response = await api(`/api/admin/products/${productId}`, {
    method: 'PATCH',
    token: ADMIN_TOKEN,
    body: { stock_quantity: quantity },
  });
  expectStatus(response, 200);
}

async function placeOrder(token, lines) {
  const response = await api('/api/orders', {
    method: 'POST',
    ip: STORE.ip,
    token,
    body: { lines },
  });
  expectStatus(response, 201);
  return response.json.order;
}

async function readOrder(token, orderId) {
  const response = await api(`/api/orders/${orderId}`, { ip: STORE.ip, token });
  expectStatus(response, 200);
  return response.json.order;
}

/**
 * A gateway webhook, signed the way Cashfree signs one: base64 HMAC-SHA256 over
 * `timestamp + rawBody`, keyed by the secret key, in `x-webhook-signature`.
 */
async function webhook(orderId, { event = 'PAYMENT_SUCCESS_WEBHOOK', paymentId, amountPaise, stale = false }) {
  const raw = JSON.stringify({
    type: event,
    data: {
      order: { order_id: orderId, order_amount: amountPaise / 100 },
      payment: {
        cf_payment_id: paymentId,
        payment_status: event === 'PAYMENT_SUCCESS_WEBHOOK' ? 'SUCCESS' : 'FAILED',
        payment_amount: amountPaise / 100,
        payment_message: event === 'PAYMENT_FAILED_WEBHOOK' ? 'Declined by issuer' : undefined,
      },
    },
  });
  const timestamp = String(stale ? Date.now() - 60 * 60 * 1000 : Date.now());
  const signature = createHmac('sha256', CASHFREE_SECRET).update(timestamp + raw).digest('base64');
  return api('/api/payments/webhook', {
    method: 'POST',
    raw,
    headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
  });
}

/** Pays an order through the gateway path, then claims the exit code the desk will ask for. */
async function payViaGateway(token, order, paymentId) {
  const delivered = await webhook(order.id, { paymentId, amountPaise: order.total });
  expectStatus(delivered, 200);
  const claimed = await api(`/api/orders/${order.id}/payment`, {
    method: 'POST',
    ip: STORE.ip,
    token,
    body: { method: 'gateway' },
  });
  expectStatus(claimed, 200);
  expect(claimed.json.payment_verified === true, 'a webhook-confirmed payment was not treated as verified');
  expect(typeof claimed.json.verification_code === 'string', 'no verification code issued');
  return claimed.json.verification_code;
}

async function desk(cookie, code, body) {
  return api(`/api/staff/verify/${code}?store_id=${STORE.id}`, {
    method: body ? 'POST' : 'GET',
    cookie,
    body,
  });
}

// ---------------------------------------------------------------------------
// The origin database — a stand-in for the shop's own system
// ---------------------------------------------------------------------------

async function provisionOrigin() {
  await rm(ORIGIN_DIR, { recursive: true, force: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(ORIGIN_DIR);
  try {
    await db.query(
      `CREATE TABLE inventory (sku_code text PRIMARY KEY, available_qty integer NOT NULL, last_updated timestamptz)`
    );
    // Same counts as ours at the start: reconciliation should find nothing to report.
    for (const p of PRODUCTS.filter((p) => p.store === STORE.id)) {
      await db.query(`INSERT INTO inventory (sku_code, available_qty) VALUES ($1, $2)`, [p.sku, p.stock]);
    }
  } finally {
    await db.close();
  }
}

async function originQuantity(sku) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(ORIGIN_DIR);
  try {
    const { rows } = await db.query(`SELECT available_qty FROM inventory WHERE sku_code = $1`, [sku]);
    return rows[0]?.available_qty ?? null;
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// H — before the server starts, because the import script needs the data directory
// ---------------------------------------------------------------------------

async function importDelivery() {
  const dir = await mkdtemp(path.join(tmpdir(), 'snapup-billing-'));
  const sheet = path.join(dir, 'delivery.csv');
  await writeFile(
    sheet,
    'store_id,barcode,name,category,aisle,price_rupees,weight_grams,cost_rupees,supplier,stock,sku\n' +
      `${STORE.id},${PEPSI.barcode},${PEPSI.name},${PEPSI.category},${PEPSI.aisle},${PEPSI.price / 100},${PEPSI.weight},${PEPSI.cost / 100},${PEPSI.supplier},${DELIVERY},${PEPSI.sku}\n`
  );
  await run(process.execPath, [path.join(ROOT, 'scripts', 'import-csv.mjs'), sheet, '--actor=billing-suite'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: VALIDATION_DATABASE_URL },
  });
  await rm(dir, { recursive: true, force: true });
}

async function readAfterImport() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(path.join(ROOT, '.data', 'validation'));
  try {
    const stock = (await db.query(`SELECT stock_quantity FROM products WHERE id = $1`, [PEPSI.id])).rows[0];
    const audit = (await db.query(`SELECT mode, qty_before, qty_after, imported_by FROM stock_imports WHERE product_id = $1`, [PEPSI.id])).rows;
    const events = (await db.query(`SELECT payload FROM outbox WHERE event_type = 'stock.imported' AND subject_id = $1`, [PEPSI.id])).rows;
    return { stock: stock.stock_quantity, audit, events };
  } finally {
    await db.close();
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function runScenarios(importResult) {
  const state = {};

  // The desk needs a member of staff. The first console signup becomes the owner.
  const signup = await api('/api/auth/console/signup', { method: 'POST', body: OWNER });
  expectStatus(signup, 201);
  const setCookie = signup.headers.get('set-cookie') ?? '';
  state.cookie = setCookie.split(';')[0];
  expect(state.cookie.includes('='), 'signup set no account cookie');

  await scenario('H', 'Import stock: quantity increases; audit row and outbox event written', async () => {
    const { stock, audit, events } = importResult;
    expect(stock === PEPSI.stock + DELIVERY, `expected ${PEPSI.stock + DELIVERY}, got ${stock}`);
    expect(audit.length === 1 && audit[0].mode === 'increase', 'no increase audit row');
    expect(audit[0].qty_before === PEPSI.stock && audit[0].qty_after === PEPSI.stock + DELIVERY, 'audit before/after wrong');
    expect(audit[0].imported_by === 'billing-suite', 'importer not recorded');
    expect(events.length === 1 && events[0].payload.delta === DELIVERY, 'no stock.imported event with the delta');
    return `${PEPSI.stock} -> ${stock}, delta ${DELIVERY} queued`;
  });

  await scenario('A', 'Same SKU twice: one line at quantity 2; stock untouched before approval', async () => {
    state.token = await startSession();
    const before = await stockOf(PEPSI.id);
    state.order = await placeOrder(state.token, [{ product_id: PEPSI.id, quantity: 2 }]);
    expect(state.order.lines.length === 1, `expected one line, got ${state.order.lines.length}`);
    expect(state.order.lines[0].quantity === 2, `expected quantity 2, got ${state.order.lines[0].quantity}`);
    expect(state.order.exit.bill_number === null, 'a bill number before anything was paid');
    expect((await stockOf(PEPSI.id)) === before, 'stock moved on order creation');
    return `1 line x2, stock ${before}`;
  });

  await scenario('C', 'Payment received, not approved: pending state, no bill, stock unchanged', async () => {
    const before = await stockOf(PEPSI.id);
    state.code = await payViaGateway(state.token, state.order, 'pay_suite_0001');
    const order = await readOrder(state.token, state.order.id);
    expect(order.payment.confirmation === 'psp_webhook', `confirmation ${order.payment.confirmation}`);
    expect(order.exit.approved_at === null, 'approved before staff looked');
    expect(order.exit.bill_number === null, 'a bill exists before staff approval');
    expect((await stockOf(PEPSI.id)) === before, 'stock moved on payment');
    return `psp_webhook, no bill, stock ${before}`;
  });

  await scenario('E1', 'Duplicate webhook: recorded once, still no bill', async () => {
    const again = await webhook(state.order.id, { paymentId: 'pay_suite_0001', amountPaise: state.order.total });
    expectStatus(again, 200);
    const order = await readOrder(state.token, state.order.id);
    expect(order.exit.bill_number === null, 'a duplicate webhook produced a bill');
    expect(order.status === 'paid', 'order lost its paid status');
    return 'second delivery accepted and ignored';
  });

  await scenario('D', 'Staff approve: exactly one bill; stock down by the bill quantity', async () => {
    const before = await stockOf(PEPSI.id);
    const found = await desk(state.cookie, state.code);
    expectStatus(found, 200);
    const approved = await desk(state.cookie, state.code, { action: 'proceed' });
    expectStatus(approved, 200);
    expect(approved.json.bill_released === true, 'desk did not report the bill released');
    expect(/^SU\d{6}-\d{7}$/.test(approved.json.bill_number ?? ''), `bill number ${approved.json.bill_number}`);
    state.billNumber = approved.json.bill_number;
    const order = await readOrder(state.token, state.order.id);
    expect(order.exit.bill_number === state.billNumber, 'customer sees a different bill number');
    expect(order.exit.approved_at !== null, 'customer not told of the approval');
    const after = await stockOf(PEPSI.id);
    expect(after === before - 2, `stock ${before} -> ${after}, expected ${before - 2}`);
    state.stockAfterD = after;
    return `bill ${state.billNumber}, stock ${before} -> ${after}`;
  });

  await scenario('E2', 'Staff double-click: refused; one bill, one deduction', async () => {
    const again = await desk(state.cookie, state.code, { action: 'proceed' });
    expectStatus(again, 409);
    expect(again.json.error.code === 'already_authorised', `got ${again.json.error.code}`);
    const order = await readOrder(state.token, state.order.id);
    expect(order.exit.bill_number === state.billNumber, 'bill number changed on replay');
    expect((await stockOf(PEPSI.id)) === state.stockAfterD, 'stock deducted twice');
    return '409 already_authorised, nothing moved';
  });

  await scenario('F', 'Insufficient stock at approval: refused; no bill, no stock change', async () => {
    const order = await placeOrder(state.token, [{ product_id: COKE.id, quantity: 3 }]);
    await setStock(COKE.id, 1);
    const code = await payViaGateway(state.token, order, 'pay_suite_0002');
    const approved = await desk(state.cookie, code, { action: 'proceed' });
    expectStatus(approved, 409);
    expect(approved.json.error.code === 'insufficient_stock', `got ${approved.json.error.code}`);
    expect(approved.json.error.shortfalls?.[0]?.available === 1, 'shortfall not reported');
    const after = await readOrder(state.token, order.id);
    expect(after.exit.bill_number === null && after.exit.approved_at === null, 'approved despite the shortfall');
    expect((await stockOf(COKE.id)) === 1, 'stock changed on a refused approval');
    return `409 insufficient_stock (want 3, have 1), stock stays 1`;
  });

  await scenario('G1', 'Staff rejection: no bill, no deduction', async () => {
    const order = await placeOrder(state.token, [{ product_id: MILK.id, quantity: 1 }]);
    const before = await stockOf(MILK.id);
    const code = await payViaGateway(state.token, order, 'pay_suite_0003');
    const denied = await desk(state.cookie, code, { action: 'deny', reason: 'Basket does not match' });
    expectStatus(denied, 200);
    const after = await readOrder(state.token, order.id);
    expect(after.exit.denied === true, 'denial not recorded');
    expect(after.exit.bill_number === null, 'a denied basket got a bill');
    expect((await stockOf(MILK.id)) === before, 'stock moved on denial');
    return `denied, stock ${before}`;
  });

  await scenario('G2', 'Payment failure: order stays unpaid; no bill, no deduction', async () => {
    const order = await placeOrder(state.token, [{ product_id: SALT.id, quantity: 1 }]);
    const before = await stockOf(SALT.id);
    const failed = await webhook(order.id, { event: 'PAYMENT_FAILED_WEBHOOK', paymentId: 'pay_suite_0004', amountPaise: order.total });
    expectStatus(failed, 200);
    const after = await readOrder(state.token, order.id);
    expect(after.status !== 'paid', `a failed payment marked the order ${after.status}`);
    expect(after.exit.bill_number === null, 'a failed payment got a bill');
    expect((await stockOf(SALT.id)) === before, 'stock moved on a failed payment');
    return `status ${after.status}, stock ${before}`;
  });

  await scenario('G3', 'A declined attempt does not block the retry that succeeds', async () => {
    const order = await placeOrder(state.token, [{ product_id: SALT.id, quantity: 1 }]);
    const declined = await webhook(order.id, { event: 'PAYMENT_FAILED_WEBHOOK', paymentId: 'pay_suite_0005a', amountPaise: order.total });
    expectStatus(declined, 200);
    const mid = await readOrder(state.token, order.id);
    expect(mid.payment.gateway_state === 'DECLINED_OR_CANCELLED', `state after decline: ${mid.payment.gateway_state}`);
    const retried = await webhook(order.id, { paymentId: 'pay_suite_0005b', amountPaise: order.total });
    expectStatus(retried, 200);
    const after = await readOrder(state.token, order.id);
    expect(after.status === 'paid' && after.payment.confirmation === 'psp_webhook', `retry not recorded: ${after.status}/${after.payment.confirmation}`);
    expect(after.payment.gateway_state === 'PAYMENT_RECEIVED_PENDING_STAFF', `state after retry: ${after.payment.gateway_state}`);
    return 'declined -> retried -> paid';
  });

  await scenario('G4', 'A replayed webhook from an hour ago is refused', async () => {
    const order = await placeOrder(state.token, [{ product_id: SALT.id, quantity: 1 }]);
    const stale = await webhook(order.id, { paymentId: 'pay_suite_0006', amountPaise: order.total, stale: true });
    expectStatus(stale, 200);
    const after = await readOrder(state.token, order.id);
    expect(after.status !== 'paid', 'a stale signature marked the order paid');
    return 'dropped, order untouched';
  });

  await scenario('B', 'A second session after a completed checkout still scans and prices', async () => {
    const ended = await api('/api/session/end', { method: 'POST', ip: STORE.ip, token: state.token });
    expectStatus(ended, 200);
    const second = await startSession();
    const scan = await api(`/api/products/barcode/${PEPSI.barcode}`, { ip: STORE.ip, token: second });
    expectStatus(scan, 200);
    const order = await placeOrder(second, [{ product_id: PEPSI.id, quantity: 1 }]);
    expect(order.total > 0, 'second session could not price a basket');
    state.token = second;
    return `scan 200, priced ${order.total} paise`;
  });

  await scenario('I1', 'Sync: stock events reach the original once; payment events are skipped, not failed', async () => {
    const run1 = await api('/api/admin/sync/run', { method: 'POST', token: ADMIN_TOKEN });
    expectStatus(run1, 200);
    const r = run1.json;
    expect(r.outcome === 'ok', `outcome ${r.outcome}: ${r.detail ?? ''}`);
    // H's delivery and D's sale: two stock lines. Everything else in the log is a payment
    // state change with nowhere to go under an inventory-only mapping.
    expect(r.sent === 2, `expected 2 stock events sent, got ${r.sent}`);
    expect(r.failed === 0, `${r.failed} event(s) failed`);
    expect(r.skipped >= 6, `expected the payment events skipped, got ${r.skipped}`);
    expect(r.reconciliation && r.reconciliation.mismatched.length === 0,
      `reconciliation reported ${JSON.stringify(r.reconciliation?.mismatched)}`);
    state.runId = r.runId;
    return `${r.runId}: sent ${r.sent}, skipped ${r.skipped}, reconciled ${r.reconciliation.checked} SKU(s) clean`;
  });

  await scenario('I2', 'Sync rerun: nothing pending, nothing resent', async () => {
    const run2 = await api('/api/admin/sync/run', { method: 'POST', token: ADMIN_TOKEN });
    expectStatus(run2, 200);
    expect(run2.json.sent === 0 && run2.json.failed === 0, `rerun sent ${run2.json.sent}, failed ${run2.json.failed}`);
    expect(run2.json.outcome === 'ok', `outcome ${run2.json.outcome}`);
    return `${run2.json.runId}: sent 0`;
  });

  return state;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
  });
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not come up at ${url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--no-build');
  const port = Number(process.env.PORT ?? 3118);

  console.log('Provisioning databases...');
  await provisionValidationDatabase();
  await provisionOrigin();

  console.log('Importing a delivery (scenario H)...');
  await importDelivery();
  const importResult = await readAfterImport();

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: VALIDATION_DATABASE_URL_FROM_APP,
    SNAPUP_QR_SECRET: QR_SECRET,
    SNAPUP_SESSION_SECRET: SESSION_SECRET,
    SNAPUP_ADMIN_API_TOKEN: ADMIN_TOKEN,
    SNAPUP_EXIT_TOKEN_SECRET: EXIT_TOKEN_SECRET,
    SNAPUP_TRUSTED_PROXY_HOPS: '1',
    SNAPUP_PAYMENT_GATEWAY: 'cashfree',
    SNAPUP_CASHFREE_APP_ID: 'suite-app-id',
    SNAPUP_CASHFREE_SECRET_KEY: CASHFREE_SECRET,
    SNAPUP_CASHFREE_ENV: 'sandbox',
    SNAPUP_ORIGIN_DATABASE_URL: ORIGIN_URL_FROM_APP,
    SNAPUP_ORIGIN_TABLE_MAP: JSON.stringify({
      inventoryTable: 'inventory',
      inventorySkuColumn: 'sku_code',
      inventoryQtyColumn: 'available_qty',
      inventoryUpdatedColumn: 'last_updated',
      conflictPolicy: 'origin_wins',
    }),
  };

  const nextBin = require.resolve('next/dist/bin/next');
  if (!skipBuild) {
    console.log('Building production bundle...\n');
    await run(process.execPath, [nextBin, 'build'], { cwd: APP_DIR, env: serverEnv });
  }

  BASE_URL = `http://127.0.0.1:${port}`;
  console.log(`\nStarting production server on port ${port}...`);
  const server = spawn(process.execPath, [nextBin, 'start', '--port', String(port)], {
    cwd: APP_DIR,
    env: serverEnv,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let state = {};
  try {
    await waitForServer(`${BASE_URL}/api/store/${STORE.id}/entry-qr`);
    console.log('Server ready.\n');
    console.log('\x1b[1mBilling acceptance — sections 1 to 9 of the brief\x1b[0m');
    state = await runScenarios(importResult);
  } finally {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }

  // The origin can only be opened once the server has let go of it.
  await scenario('I3', 'The original database holds exactly one application of each event', async () => {
    const pepsi = await originQuantity(PEPSI.sku);
    const expected = PEPSI.stock + DELIVERY - 2;
    expect(pepsi === expected, `original has ${pepsi}, expected ${expected} (${PEPSI.stock} + ${DELIVERY} - 2)`);
    expect(pepsi === state.stockAfterD, `original ${pepsi} disagrees with ours ${state.stockAfterD}`);
    const coke = await originQuantity(COKE.sku);
    expect(coke === COKE.stock, `a refused approval reached the original: ${coke}`);
    const milk = await originQuantity(MILK.sku);
    expect(milk === MILK.stock, `a denied basket reached the original: ${milk}`);
    return `${PEPSI.sku}: ${pepsi} on both sides`;
  });

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(72));
  if (failed.length === 0) {
    console.log(`\x1b[32m\x1b[1mAll ${results.length} billing scenarios passed.\x1b[0m`);
    console.log('READY');
  } else {
    console.log(`\x1b[31m\x1b[1m${failed.length} of ${results.length} billing scenarios FAILED:\x1b[0m`);
    for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
    console.log('NOT READY');
    process.exitCode = 1;
  }
  console.log('='.repeat(72));
}

main().catch((error) => {
  console.error(`\n\x1b[31mSuite error: ${error.stack ?? error}\x1b[0m`);
  process.exitCode = 1;
});
