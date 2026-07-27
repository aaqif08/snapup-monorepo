#!/usr/bin/env node
/**
 * CTO requirements validation harness.
 *
 * Reproduces every row of the evidence tables in docs/cto-requirements-implementation.md
 * against a real server, so the claims made to the CTO can be re-run on demand instead of
 * taken on trust.
 *
 * Runs against a PRODUCTION build on purpose:
 *   - SNAPUP_PRESENCE_DEV_BYPASS is ignored in production, so the genuine egress-IP
 *     presence check is exercised rather than skipped.
 *   - Timings reflect the built app, not on-demand dev compilation.
 *
 * The harness sets `x-forwarded-for` itself, playing the role of the single trusted proxy
 * that sits in front of the app in deployment (SNAPUP_TRUSTED_PROXY_HOPS=1 => the
 * right-most entry is the one infrastructure appended). That is what lets us simulate a
 * customer inside the store, at home, and actively spoofing the header.
 *
 * Usage:
 *   node scripts/validate-requirements.mjs              # build, start, test, tear down
 *   node scripts/validate-requirements.mjs --no-build   # reuse an existing .next build
 *   node scripts/validate-requirements.mjs --base-url=http://localhost:3000
 */

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(REPO_ROOT, 'apps', 'customer-web');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The harness signs its own QR tokens in order to forge the attack cases (an expired
 * "photographed" code, a code minted with the wrong key). It therefore has to know the
 * same secrets the server is started with, which is why they are injected here rather
 * than relying on the dev fallbacks in env.ts.
 */
const QR_SECRET = 'validation-harness-qr-secret-do-not-deploy';
const SESSION_SECRET = 'validation-harness-session-secret-do-not-deploy';
const ATTACKER_SECRET = 'a-secret-the-attacker-guessed-wrong';

/** Registered egress IPs from src/server/stores.ts. */
const STORE_1 = { id: 'store_1', ip: '198.51.100.24' };
const STORE_2 = { id: 'store_2', ip: '198.51.100.25' };
/** Outside every registered range — a customer sitting at home. */
const HOME_IP = '203.0.113.200';

/** Present in store_1 only (see products/seed.ts). */
const STORE_1_ONLY_BARCODE = '8901725110016'; // Aashirvaad Atta 5kg
/** Stocked by both stores at deliberately different prices. */
const SHARED_BARCODE = '012000000133'; // Diet Pepsi 12oz
const STORE_1_PRICE = 4000;
const STORE_2_PRICE = 4200;

/** The complete set of fields a customer is allowed to see (projection.ts). */
const PERMITTED_FIELDS = [
  'id',
  'barcode',
  'name',
  'unit_price',
  'image_url',
  'expected_weight_grams',
].sort();

/** Internal columns that must never cross the wire, plus sample values of each. */
const FORBIDDEN_KEYS = [
  'cost_price',
  'profit_margin_pct',
  'supplier_name',
  'supplier_contact',
  'stock_quantity',
  'internal_sku',
  'purchase_history',
];
const FORBIDDEN_VALUES = ['PepsiCo India Distribution', 'BEV-PEP-DT-12', 'orders@pepsico-dist'];

const PERFORMANCE_TARGET_MS = 2000;

// ---------------------------------------------------------------------------
// Tiny assertion runner (no test framework — keeps this dependency-free)
// ---------------------------------------------------------------------------

const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

async function check(id, description, fn) {
  try {
    const detail = await fn();
    results.push({ section: currentSection, id, description, ok: true, detail });
    console.log(`  \x1b[32mPASS\x1b[0m ${id}  ${description}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  } catch (error) {
    results.push({ section: currentSection, id, description, ok: false, detail: error.message });
    console.log(`  \x1b[31mFAIL\x1b[0m ${id}  ${description}\n         \x1b[31m${error.message}\x1b[0m`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStatus(response, status) {
  expect(
    response.status === status,
    `expected HTTP ${status}, got ${response.status} (body: ${JSON.stringify(response.json)})`
  );
}

function expectErrorCode(response, code) {
  const actual = response.json?.error?.code;
  expect(actual === code, `expected error code "${code}", got "${actual}"`);
}

// ---------------------------------------------------------------------------
// HTTP + token helpers
// ---------------------------------------------------------------------------

let BASE_URL = '';

async function api(pathname, { method = 'GET', ip, token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (ip) requestHeaders['x-forwarded-for'] = ip;
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON responses (e.g. a 404 HTML page) are surfaced via `text` */
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** Mirrors signPayload() in src/server/crypto.ts. */
function signPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

/** Replaces a token's signature with a valid-looking but incorrect one. */
function tamperSignature(token) {
  const [body] = token.split('.');
  return `${body}.${createHmac('sha256', 'wrong-key').update(body).digest('base64url')}`;
}

async function fetchEntryQr(storeId) {
  const response = await api(`/api/store/${storeId}/entry-qr`);
  expectStatus(response, 200);
  return response.json;
}

async function startSession(store, ip = store.ip) {
  const { qr_token } = await fetchEntryQr(store.id);
  return api('/api/session/start', { method: 'POST', ip, body: { qr_token } });
}

// ---------------------------------------------------------------------------
// Requirement 1 — Secure Dual Presence Authentication
// ---------------------------------------------------------------------------

async function validateRequirement1(state) {
  section('Requirement 1 — Secure Dual Presence Authentication');

  await check('R1.1', 'QR + store network -> access granted', async () => {
    const response = await startSession(STORE_1);
    expectStatus(response, 201);
    expect(typeof response.json.session_token === 'string', 'no session_token returned');
    expect(response.json.store.id === STORE_1.id, 'session bound to the wrong store');
    state.sessionToken = response.json.session_token;
    return `201, session for ${response.json.store.name}`;
  });

  await check('R1.2', 'Valid QR, customer at home -> denied', async () => {
    const response = await startSession(STORE_1, HOME_IP);
    expectStatus(response, 403);
    expectErrorCode(response, 'presence_not_verified');
    return '403 presence_not_verified';
  });

  await check('R1.3', 'Store network, invalid QR -> denied', async () => {
    const { qr_token } = await fetchEntryQr(STORE_1.id);
    const response = await api('/api/session/start', {
      method: 'POST',
      ip: STORE_1.ip,
      body: { qr_token: tamperSignature(qr_token) },
    });
    expectStatus(response, 401);
    expectErrorCode(response, 'qr_bad_signature');
    return '401 qr_bad_signature';
  });

  await check('R1.4', 'Photographed QR (10 min old) on store network -> denied', async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleToken = signPayload(
      { v: 1, sid: STORE_1.id, nonce: 'photographed', iat: now - 600, exp: now - 480 },
      QR_SECRET
    );
    const response = await api('/api/session/start', {
      method: 'POST',
      ip: STORE_1.ip,
      body: { qr_token: staleToken },
    });
    expectStatus(response, 401);
    expectErrorCode(response, 'qr_expired');
    return '401 qr_expired';
  });

  await check('R1.5', 'Attacker-minted QR (wrong secret) -> denied', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = signPayload(
      { v: 1, sid: STORE_1.id, nonce: 'forged', iat: now, exp: now + 120 },
      ATTACKER_SECRET
    );
    const response = await api('/api/session/start', {
      method: 'POST',
      ip: STORE_1.ip,
      body: { qr_token: forged },
    });
    expectStatus(response, 401);
    expectErrorCode(response, 'qr_bad_signature');
    return '401 qr_bad_signature';
  });

  await check('R1.6', 'Session valid, then customer walks out -> terminated', async () => {
    // Same signed token, now arriving from a non-store IP.
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: HOME_IP,
      token: state.sessionToken,
    });
    expectStatus(response, 403);
    expectErrorCode(response, 'presence_lost');
    return '403 presence_lost';
  });

  await check('R1.7', 'Heartbeat from outside store -> session inactive', async () => {
    const response = await api('/api/session/heartbeat', {
      method: 'POST',
      ip: HOME_IP,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(response.json.active === false, 'heartbeat still reported active');
    expect(
      response.json.reason === 'presence_lost',
      `expected reason presence_lost, got ${response.json.reason}`
    );
    return '{ active: false, reason: "presence_lost" }';
  });

  await check('R1.8', 'Spoofed x-forwarded-for claiming store IP -> denied', async () => {
    // The client asserts the store's IP; the trusted proxy appends the true one on the
    // right. Counting from the right is what defeats this.
    const response = await startSession(STORE_1, `${STORE_1.ip}, ${HOME_IP}`);
    expectStatus(response, 403);
    expectErrorCode(response, 'presence_not_verified');
    return '403 presence_not_verified';
  });

  await check('R1.9', 'Heartbeat inside store -> session active', async () => {
    const response = await api('/api/session/heartbeat', {
      method: 'POST',
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(response.json.active === true, 'heartbeat reported inactive inside the store');
    return `active, ${response.json.expires_in_seconds}s remaining`;
  });

  await check('R1.10', 'Session capped at 30 minutes', async () => {
    const response = await api('/api/session/heartbeat', {
      method: 'POST',
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const remaining = response.json.expires_in_seconds;
    expect(remaining > 1740 && remaining <= 1800, `expected <=1800s TTL, got ${remaining}s`);
    return `${remaining}s <= 1800s`;
  });

  await check('R1.11', 'Entrance QR rotates on a 120s TTL', async () => {
    const qr = await fetchEntryQr(STORE_1.id);
    expect(qr.rotate_after_seconds === 120, `expected 120s, got ${qr.rotate_after_seconds}`);
    const lifetime = qr.expires_at - Math.floor(Date.now() / 1000);
    expect(lifetime > 0 && lifetime <= 120, `QR lifetime out of range: ${lifetime}s`);
    return `rotate_after_seconds = 120`;
  });

  await check('R1.12', 'Explicit session end revokes access', async () => {
    const started = await startSession(STORE_1);
    expectStatus(started, 201);
    const token = started.json.session_token;

    const ended = await api('/api/session/end', { method: 'POST', ip: STORE_1.ip, token });
    expectStatus(ended, 200);

    const after = await api(`/api/products/barcode/${SHARED_BARCODE}`, { ip: STORE_1.ip, token });
    expectStatus(after, 401);
    expectErrorCode(after, 'revoked');
    return '401 revoked';
  });
}

// ---------------------------------------------------------------------------
// Requirement 2 — Secure Server-Side Database Gateway
// ---------------------------------------------------------------------------

async function validateRequirement2(state) {
  section('Requirement 2 — Secure Server-Side Database Gateway');

  await check('R2.1', 'Unauthenticated product request -> denied', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, { ip: STORE_1.ip });
    expectStatus(response, 401);
    expectErrorCode(response, 'missing_token');
    return '401 missing_token';
  });

  await check('R2.2', 'Tampered session token -> denied', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: tamperSignature(state.sessionToken),
    });
    expectStatus(response, 401);
    expectErrorCode(response, 'bad_signature');
    return '401 bad_signature';
  });

  await check('R2.3', 'Product response exposes exactly the 6 permitted fields', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    const actual = Object.keys(response.json.product).sort();
    expect(
      JSON.stringify(actual) === JSON.stringify(PERMITTED_FIELDS),
      `field set mismatch.\n           expected: ${PERMITTED_FIELDS.join(', ')}\n           actual:   ${actual.join(', ')}`
    );
    return actual.join(', ');
  });

  await check('R2.4', 'No internal column or value appears in any response', async () => {
    const single = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const search = await api('/api/products/search?q=&page_size=50', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const corpus = `${single.text}\n${search.text}`;

    const leakedKeys = FORBIDDEN_KEYS.filter((key) => corpus.includes(key));
    expect(leakedKeys.length === 0, `leaked internal columns: ${leakedKeys.join(', ')}`);

    const leakedValues = FORBIDDEN_VALUES.filter((value) => corpus.includes(value));
    expect(leakedValues.length === 0, `leaked internal values: ${leakedValues.join(', ')}`);

    return `${FORBIDDEN_KEYS.length} columns withheld across single + search responses`;
  });

  await check('R2.5', 'page_size is hard-capped (no bulk export via pagination)', async () => {
    const response = await api('/api/products/search?page_size=100000', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(
      response.json.page.page_size === 50,
      `expected page_size 50, got ${response.json.page.page_size}`
    );
    expect(response.json.items.length <= 50, `returned ${response.json.items.length} items`);
    return 'page_size=100000 -> 50';
  });

  await check('R2.6', 'No bulk export endpoint exists', async () => {
    const response = await api('/api/products', { ip: STORE_1.ip, token: state.sessionToken });
    expect(response.status === 404, `expected 404, got ${response.status}`);
    return '/api/products -> 404';
  });

  await check('R2.7', 'Cross-store read is refused (store_2 cannot see store_1 stock)', async () => {
    const started = await startSession(STORE_2);
    expectStatus(started, 201);
    state.store2Token = started.json.session_token;

    const response = await api(`/api/products/barcode/${STORE_1_ONLY_BARCODE}`, {
      ip: STORE_2.ip,
      token: state.store2Token,
    });
    expectStatus(response, 404);
    expectErrorCode(response, 'product_not_found');
    return '404 product_not_found';
  });

  await check('R2.8', 'Store scoping is enforced, not assumed (per-store pricing)', async () => {
    const asStore1 = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const asStore2 = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_2.ip,
      token: state.store2Token,
    });
    expectStatus(asStore1, 200);
    expectStatus(asStore2, 200);
    expect(
      asStore1.json.product.unit_price === STORE_1_PRICE,
      `store_1 price ${asStore1.json.product.unit_price} != ${STORE_1_PRICE}`
    );
    expect(
      asStore2.json.product.unit_price === STORE_2_PRICE,
      `store_2 price ${asStore2.json.product.unit_price} != ${STORE_2_PRICE}`
    );
    return `same barcode -> ${STORE_1_PRICE / 100} vs ${STORE_2_PRICE / 100}`;
  });

  await check('R2.9', 'Store id comes from the session, not a query parameter', async () => {
    // A store_2 session asking for store_1 data must still be served store_2's catalogue.
    const response = await api(
      `/api/products/barcode/${SHARED_BARCODE}?store_id=store_1&sid=store_1`,
      { ip: STORE_2.ip, token: state.store2Token }
    );
    expectStatus(response, 200);
    expect(
      response.json.product.unit_price === STORE_2_PRICE,
      `query parameter overrode session scoping (got ${response.json.product.unit_price})`
    );
    return 'query parameter ignored';
  });

  await check('R2.10', 'Malformed barcode is rejected before the lookup', async () => {
    const response = await api('/api/products/barcode/not-a-barcode', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 400);
    expectErrorCode(response, 'invalid_barcode');
    return '400 invalid_barcode';
  });

  // Runs last in this section: it deliberately exhausts a session's token bucket.
  await check('R2.11', 'Rate limiting caps enumeration', async () => {
    const started = await startSession(STORE_1);
    expectStatus(started, 201);
    const token = started.json.session_token;

    let limited = 0;
    let served = 0;
    for (let i = 0; i < 60; i += 1) {
      const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
        ip: STORE_1.ip,
        token,
      });
      if (response.status === 429) limited += 1;
      else if (response.status === 200) served += 1;
    }

    expect(limited > 0, `60 rapid requests produced no 429 (served ${served})`);
    return `${served} served, ${limited} rate-limited (429)`;
  });
}

// ---------------------------------------------------------------------------
// Requirement 3 — High-Speed Barcode Retrieval
// ---------------------------------------------------------------------------

async function validateRequirement3(state) {
  section(`Requirement 3 — High-Speed Barcode Retrieval (${PERFORMANCE_TARGET_MS}ms target)`);

  // Warm the route so the first measurement is not dominated by lazy module init.
  for (let i = 0; i < 3; i += 1) {
    await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
  }

  const samples = [];

  await check('R3.1', 'Five consecutive scans complete within target', async () => {
    for (let i = 0; i < 5; i += 1) {
      const startedAt = performance.now();
      const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
        ip: STORE_1.ip,
        token: state.sessionToken,
      });
      const elapsed = performance.now() - startedAt;
      expectStatus(response, 200);
      samples.push({ endToEnd: elapsed, lookup: response.json.lookup_ms });
    }

    const slowest = Math.max(...samples.map((s) => s.endToEnd));
    expect(
      slowest < PERFORMANCE_TARGET_MS,
      `slowest scan ${slowest.toFixed(1)}ms exceeded the ${PERFORMANCE_TARGET_MS}ms target`
    );
    return `slowest ${slowest.toFixed(1)}ms of ${PERFORMANCE_TARGET_MS}ms budget`;
  });

  if (samples.length > 0) {
    console.log('\n         \x1b[2mScan   End-to-end   Server DB lookup\x1b[0m');
    samples.forEach((sample, index) => {
      console.log(
        `         \x1b[2m${String(index + 1).padEnd(6)} ${`${sample.endToEnd.toFixed(1)} ms`.padEnd(12)} ${sample.lookup} ms\x1b[0m`
      );
    });
    console.log('');
  }

  await check('R3.2', 'Server-Timing header reports the DB lookup', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const timing = response.headers.get('server-timing');
    expect(Boolean(timing) && timing.includes('lookup'), `missing Server-Timing: ${timing}`);
    return timing;
  });

  await check('R3.3', 'Response body carries a measurable lookup time', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expect(typeof response.json.lookup_ms === 'number', 'lookup_ms missing or not numeric');
    return `lookup_ms = ${response.json.lookup_ms}`;
  });
}

// ---------------------------------------------------------------------------
// Requirement 4 — Database Retrieval Optimization
// ---------------------------------------------------------------------------

async function validateRequirement4(state) {
  section('Requirement 4 — Database Retrieval Optimization');

  await check('R4.1', 'Search is paginated with page metadata', async () => {
    const response = await api('/api/products/search?page=1&page_size=5', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(response.json.items.length <= 5, `returned ${response.json.items.length} items`);
    expect(response.json.page.page === 1, 'page metadata missing or wrong');
    expect(typeof response.json.page.total === 'number', 'page.total missing');
    return `page 1 of ${response.json.page.total} items, ${response.json.items.length} returned`;
  });

  await check('R4.2', 'Pagination actually advances', async () => {
    const [first, second] = await Promise.all([
      api('/api/products/search?page=1&page_size=3', { ip: STORE_1.ip, token: state.sessionToken }),
      api('/api/products/search?page=2&page_size=3', { ip: STORE_1.ip, token: state.sessionToken }),
    ]);
    expectStatus(first, 200);
    expectStatus(second, 200);
    const firstIds = first.json.items.map((item) => item.id);
    const secondIds = second.json.items.map((item) => item.id);
    const overlap = firstIds.filter((id) => secondIds.includes(id));
    expect(overlap.length === 0, `pages overlap: ${overlap.join(', ')}`);
    return `[${firstIds.join(', ')}] then [${secondIds.join(', ')}]`;
  });

  await check('R4.3', 'Search results are projected the same as single lookups', async () => {
    const response = await api('/api/products/search?page_size=5', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(response.json.items.length > 0, 'no items to inspect');
    for (const item of response.json.items) {
      const actual = Object.keys(item).sort();
      expect(
        JSON.stringify(actual) === JSON.stringify(PERMITTED_FIELDS),
        `item ${item.id} exposed: ${actual.join(', ')}`
      );
    }
    return `${response.json.items.length} items, all 6-field projected`;
  });

  await check('R4.4', 'Product caching is private, never shared/CDN', async () => {
    const response = await api(`/api/products/barcode/${SHARED_BARCODE}`, {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl.includes('private'), `expected "private", got "${cacheControl}"`);
    expect(!cacheControl.includes('public'), `cache-control must never be public: "${cacheControl}"`);
    return cacheControl;
  });

  await check('R4.5', 'Search filters by query rather than returning everything', async () => {
    const all = await api('/api/products/search?page_size=50', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const filtered = await api('/api/products/search?q=maggi&page_size=50', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(filtered, 200);
    expect(
      filtered.json.page.total < all.json.page.total,
      `filtered total ${filtered.json.page.total} not smaller than ${all.json.page.total}`
    );
    expect(filtered.json.items.length > 0, 'query matched nothing');
    return `"maggi" -> ${filtered.json.page.total} of ${all.json.page.total}`;
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}`))
    );
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { 'x-forwarded-for': STORE_1.ip } });
      if (response.status < 500) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server did not become ready at ${url} within ${timeoutMs}ms`);
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // child.kill() only reaps the shim; next spawns a worker that would keep the port.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes('--no-build');
  const externalBaseUrl = args.find((arg) => arg.startsWith('--base-url='))?.split('=')[1];
  const port = Number(process.env.PORT ?? 3117);

  const serverEnv = {
    ...process.env,
    NODE_ENV: 'production',
    SNAPUP_QR_SECRET: QR_SECRET,
    SNAPUP_SESSION_SECRET: SESSION_SECRET,
    SNAPUP_TRUSTED_PROXY_HOPS: '1',
    // Deliberately absent: SNAPUP_PRESENCE_DEV_BYPASS. The real presence check must run.
  };

  let server = null;

  try {
    if (externalBaseUrl) {
      BASE_URL = externalBaseUrl.replace(/\/$/, '');
      console.log(`Validating against existing server at ${BASE_URL}`);
    } else {
      const nextBin = require.resolve('next/dist/bin/next');

      if (!skipBuild) {
        console.log('Building production bundle...\n');
        await run(process.execPath, [nextBin, 'build'], { cwd: APP_DIR, env: serverEnv });
      }

      BASE_URL = `http://127.0.0.1:${port}`;
      console.log(`\nStarting production server on port ${port}...`);
      server = spawn(process.execPath, [nextBin, 'start', '--port', String(port)], {
        cwd: APP_DIR,
        env: serverEnv,
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      server.on('error', (error) => {
        console.error(`\x1b[31mFailed to start server: ${error.message}\x1b[0m`);
      });

      await waitForServer(`${BASE_URL}/api/store/${STORE_1.id}/entry-qr`);
      console.log('Server ready.');
    }

    const state = {};
    await validateRequirement1(state);
    await validateRequirement2(state);
    await validateRequirement3(state);
    await validateRequirement4(state);
  } finally {
    stopServer(server);
  }

  // ---- Summary ----
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;

  console.log(`\n${'='.repeat(72)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1mAll ${results.length} validation cases passed.\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${failed} of ${results.length} validation cases FAILED:\x1b[0m`);
    for (const result of results.filter((entry) => !entry.ok)) {
      console.log(`  \x1b[31m- ${result.id} ${result.description}\x1b[0m`);
    }
  }
  console.log(`${'='.repeat(72)}\n`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n\x1b[31mHarness error: ${error.stack ?? error.message}\x1b[0m\n`);
  process.exit(1);
});
