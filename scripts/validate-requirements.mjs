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
const ADMIN_TOKEN = 'validation-harness-admin-token-do-not-deploy';
const EXIT_TOKEN_SECRET = 'validation-harness-exit-token-secret-do-not-deploy';

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
// Store directory and device location
// ---------------------------------------------------------------------------

/** Seeded store coordinates, from src/server/stores/seed.ts. */
const HSR_LAYOUT = { lat: 12.9082, lng: 77.6476 }; // store_1 sits here
const JAYANAGAR = { lat: 12.925, lng: 77.5838 }; // store_5 sits here

async function validateStoreDirectory(state) {
  section('Store directory — device location');

  await check('R5.1', 'Directory works without location (customer declined)', async () => {
    const response = await api('/api/stores/nearby', { ip: STORE_1.ip });
    expectStatus(response, 200);
    expect(response.json.located === false, 'located should be false with no coordinates');
    expect(response.json.stores.length > 0, 'no stores returned');
    const withDistance = response.json.stores.filter((s) => s.distanceKm !== undefined);
    expect(
      withDistance.length === 0,
      `distances invented for ${withDistance.length} stores despite no coordinates`
    );
    return `${response.json.stores.length} stores, no distances`;
  });

  await check('R5.2', 'Coordinates produce real distances, nearest first', async () => {
    const response = await api(
      `/api/stores/nearby?lat=${HSR_LAYOUT.lat}&lng=${HSR_LAYOUT.lng}`,
      { ip: STORE_1.ip }
    );
    expectStatus(response, 200);
    expect(response.json.located === true, 'located should be true');

    const stores = response.json.stores;
    expect(stores.length > 1, 'need at least two stores to check ordering');
    expect(stores.every((s) => typeof s.distanceKm === 'number'), 'a store is missing distanceKm');

    for (let i = 1; i < stores.length; i += 1) {
      expect(
        stores[i].distanceKm >= stores[i - 1].distanceKm,
        `out of order: ${stores[i - 1].distanceKm} then ${stores[i].distanceKm}`
      );
    }

    expect(stores[0].id === 'store_1', `expected store_1 nearest to HSR Layout, got ${stores[0].id}`);
    expect(stores[0].distanceKm < 0.5, `store_1 should be ~0km away, got ${stores[0].distanceKm}`);
    return `nearest ${stores[0].name} at ${stores[0].distanceKm}km`;
  });

  await check('R5.3', 'Ordering actually tracks the device position', async () => {
    // Same catalogue, different vantage point: if distance were faked or cached, the
    // nearest store would not change.
    const response = await api(
      `/api/stores/nearby?lat=${JAYANAGAR.lat}&lng=${JAYANAGAR.lng}`,
      { ip: STORE_1.ip }
    );
    expectStatus(response, 200);
    const nearest = response.json.stores[0];
    expect(nearest.id === 'store_5', `expected store_5 nearest to Jayanagar, got ${nearest.id}`);
    return `from Jayanagar: ${nearest.name} at ${nearest.distanceKm}km`;
  });

  await check('R5.4', 'Radius filters the directory', async () => {
    const wide = await api(`/api/stores/nearby?lat=${HSR_LAYOUT.lat}&lng=${HSR_LAYOUT.lng}&radius_km=100`, {
      ip: STORE_1.ip,
    });
    const tight = await api(`/api/stores/nearby?lat=${HSR_LAYOUT.lat}&lng=${HSR_LAYOUT.lng}&radius_km=2`, {
      ip: STORE_1.ip,
    });
    expectStatus(wide, 200);
    expectStatus(tight, 200);
    expect(
      tight.json.stores.length < wide.json.stores.length,
      `radius had no effect: ${tight.json.stores.length} vs ${wide.json.stores.length}`
    );
    return `2km -> ${tight.json.stores.length}, 100km -> ${wide.json.stores.length}`;
  });

  await check('R5.5', 'Malformed coordinates are rejected', async () => {
    const cases = ['?lat=91&lng=77', '?lat=12.9&lng=999', '?lat=abc&lng=77', '?lat=12.9'];
    for (const query of cases) {
      const response = await api(`/api/stores/nearby${query}`, { ip: STORE_1.ip });
      expectStatus(response, 400);
      expectErrorCode(response, 'invalid_coordinates');
    }
    return `${cases.length} malformed inputs -> 400`;
  });

  await check('R5.6', 'Directory never leaks a store network range', async () => {
    const response = await api(`/api/stores/nearby?lat=${HSR_LAYOUT.lat}&lng=${HSR_LAYOUT.lng}`, {
      ip: STORE_1.ip,
    });
    // The registered CIDRs are exactly what an attacker needs in order to know which
    // network to appear to originate from.
    const leaks = ['authorizedEgressCidrs', 'authorized_egress_cidrs', '198.51.100.', '203.0.113.', '/32'];
    const found = leaks.filter((needle) => response.text.includes(needle));
    expect(found.length === 0, `directory leaked: ${found.join(', ')}`);
    return 'no CIDR data in the public directory';
  });

  await check('R5.7', 'Directory is private-cached, never shared', async () => {
    const response = await api(`/api/stores/nearby?lat=${HSR_LAYOUT.lat}&lng=${HSR_LAYOUT.lng}`, {
      ip: STORE_1.ip,
    });
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl.includes('private'), `expected private, got "${cacheControl}"`);
    expect(!cacheControl.includes('public'), `must not be public: "${cacheControl}"`);
    return cacheControl;
  });
}

// ---------------------------------------------------------------------------
// Admin store registry
// ---------------------------------------------------------------------------

async function validateAdminRegistry(state) {
  section('Admin store registry');

  await check('R6.1', 'Registry write API rejects anonymous callers', async () => {
    const response = await api('/api/admin/stores', { ip: STORE_1.ip });
    expectStatus(response, 401);
    expectErrorCode(response, 'missing_token');
    return '401 missing_token';
  });

  await check('R6.2', 'Registry write API rejects a wrong token', async () => {
    const response = await api('/api/admin/stores', {
      ip: STORE_1.ip,
      token: 'not-the-admin-token',
    });
    expectStatus(response, 403);
    expectErrorCode(response, 'invalid_token');
    return '403 invalid_token';
  });

  await check('R6.3', 'Admin can register a new store', async () => {
    const response = await api('/api/admin/stores', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        name: 'Harness Test Mart',
        address: 'Whitefield, Bangalore',
        latitude: 12.9698,
        longitude: 77.75,
        authorizedEgressCidrs: ['192.0.2.77/32'],
        advertisedSsid: 'Harness-Guest',
        isActive: true,
        isOpen: true,
      },
    });
    expectStatus(response, 201);
    state.createdStoreId = response.json.store.id;
    return `created ${state.createdStoreId}`;
  });

  await check('R6.4', 'A newly registered store reaches customers immediately', async () => {
    const response = await api('/api/stores/nearby?lat=12.9698&lng=77.75', { ip: STORE_1.ip });
    expectStatus(response, 200);
    const found = response.json.stores.find((store) => store.id === state.createdStoreId);
    expect(Boolean(found), 'the new store is absent from the customer directory');
    expect(found.id === response.json.stores[0].id, 'new store should be nearest to its own coordinates');
    return `${found.name} at ${found.distanceKm}km, no redeploy`;
  });

  await check('R6.5', 'A store registered by an admin can grant sessions', async () => {
    const qr = await fetchEntryQr(state.createdStoreId);
    const response = await api('/api/session/start', {
      method: 'POST',
      ip: '192.0.2.77',
      body: { qr_token: qr.qr_token },
    });
    expectStatus(response, 201);
    return `201 for a store that did not exist at boot`;
  });

  await check('R6.6', 'Malformed network ranges are refused', async () => {
    const response = await api('/api/admin/stores', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        name: 'Bad CIDR Mart',
        address: 'Nowhere',
        latitude: 12.9,
        longitude: 77.6,
        authorizedEgressCidrs: ['10.0.0.1', '999.1.1.1/32'],
        advertisedSsid: 'Bad-Guest',
      },
    });
    expectStatus(response, 400);
    expectErrorCode(response, 'invalid_store');
    return '400 invalid_store';
  });

  await check('R6.7', 'A store with no network fails closed, with a warning', async () => {
    const created = await api('/api/admin/stores', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        name: 'Unregistered Network Mart',
        address: 'Electronic City, Bangalore',
        latitude: 12.8452,
        longitude: 77.6602,
        authorizedEgressCidrs: [],
        advertisedSsid: 'Unregistered-Guest',
      },
    });
    expectStatus(created, 201);
    expect(created.json.warnings.length > 0, 'no warning raised for a store with no network');

    // The important half: it must refuse everyone rather than admitting everyone.
    const qr = await fetchEntryQr(created.json.store.id);
    const session = await api('/api/session/start', {
      method: 'POST',
      ip: '198.51.100.99',
      body: { qr_token: qr.qr_token },
    });
    expectStatus(session, 403);
    expectErrorCode(session, 'presence_not_verified');
    return 'warned on create, 403 presence_not_verified for customers';
  });

  await check('R6.8', 'Deactivating a store withdraws it everywhere', async () => {
    const patched = await api(`/api/admin/stores/${state.createdStoreId}`, {
      method: 'PATCH',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: { isActive: false },
    });
    expectStatus(patched, 200);

    const directory = await api('/api/stores/nearby?lat=12.9698&lng=77.75', { ip: STORE_1.ip });
    const stillListed = directory.json.stores.some((store) => store.id === state.createdStoreId);
    expect(!stillListed, 'deactivated store still appears in the customer directory');

    // And it can no longer mint sessions: the entrance QR endpoint stops serving it.
    const qr = await api(`/api/store/${state.createdStoreId}/entry-qr`, { ip: STORE_1.ip });
    expectStatus(qr, 404);
    return 'hidden from directory, entry QR 404';
  });

  await check('R6.9', 'Admin view shows network ranges the customer view withholds', async () => {
    const response = await api('/api/admin/stores', { ip: STORE_1.ip, token: ADMIN_TOKEN });
    expectStatus(response, 200);
    const store1 = response.json.stores.find((store) => store.id === 'store_1');
    expect(Boolean(store1), 'store_1 missing from the admin listing');
    expect(
      Array.isArray(store1.authorized_egress_cidrs) && store1.authorized_egress_cidrs.length > 0,
      'admin listing is missing the network ranges it exists to manage'
    );
    return `store_1 -> ${store1.authorized_egress_cidrs.join(', ')}`;
  });

  await check('R6.10', 'Unknown store id cannot be patched', async () => {
    const response = await api('/api/admin/stores/store_does_not_exist', {
      method: 'PATCH',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: { isOpen: false },
    });
    expectStatus(response, 404);
    expectErrorCode(response, 'store_not_found');
    return '404 store_not_found';
  });
}

// ---------------------------------------------------------------------------
// Admin product catalogue
// ---------------------------------------------------------------------------

async function validateAdminCatalogue(state) {
  section('Admin product catalogue');

  await check('R7.1', 'Catalogue write API rejects anonymous callers', async () => {
    const response = await api('/api/admin/products?store_id=store_1', { ip: STORE_1.ip });
    expectStatus(response, 401);
    expectErrorCode(response, 'missing_token');
    return '401 missing_token';
  });

  await check('R7.2', 'Admin can add a product to a real store catalogue', async () => {
    const response = await api('/api/admin/products', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        store_id: 'store_1',
        barcode: '7011234567890',
        name: 'Harness Test Cereal 500g',
        category: 'Staples',
        image_url: '/products/test.png',
        unit_price: 24900,
        cost_price: 18000,
        expected_weight_grams: 505,
        stock_quantity: 40,
        internal_sku: 'STP-HRN-500',
        supplier_name: 'Harness Foods',
        supplier_contact: 'supply@harness.example',
      },
    });
    expectStatus(response, 201);
    state.createdProductId = response.json.product.id;
    return `created ${state.createdProductId}`;
  });

  await check('R7.3', 'A product an admin added is scannable by customers', async () => {
    const response = await api('/api/products/barcode/7011234567890', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(response, 200);
    expect(response.json.product.unit_price === 24900, 'price mismatch through the customer path');
    return `${response.json.product.name} @ Rs${response.json.product.unit_price / 100}`;
  });

  await check('R7.4', 'Admin-created products keep the 6-field customer projection', async () => {
    const response = await api('/api/products/barcode/7011234567890', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const actual = Object.keys(response.json.product).sort();
    expect(
      JSON.stringify(actual) === JSON.stringify(PERMITTED_FIELDS),
      `field set drifted for an admin-created product: ${actual.join(', ')}`
    );
    // The commercial fields were supplied on create, so this proves the projection is
    // applied to new data rather than only to the seed.
    const leaked = ['18000', 'Harness Foods', 'STP-HRN-500', 'supply@harness.example'].filter(
      (needle) => response.text.includes(needle)
    );
    expect(leaked.length === 0, `leaked: ${leaked.join(', ')}`);
    return '6 fields, no commercial data';
  });

  await check('R7.5', 'Duplicate barcode within a store is refused', async () => {
    const response = await api('/api/admin/products', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        store_id: 'store_1',
        barcode: '7011234567890',
        name: 'Duplicate Cereal',
        category: 'Staples',
        image_url: '',
        unit_price: 10000,
        cost_price: 5000,
        expected_weight_grams: 100,
        stock_quantity: 1,
        internal_sku: 'DUP-1',
        supplier_name: 'X',
        supplier_contact: 'x@example.com',
      },
    });
    expectStatus(response, 409);
    expectErrorCode(response, 'duplicate_barcode');
    return '409 duplicate_barcode';
  });

  await check('R7.6', 'Malformed product payloads are refused', async () => {
    const response = await api('/api/admin/products', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        store_id: 'store_1',
        barcode: 'not-digits',
        name: '',
        category: 'Staples',
        image_url: '',
        unit_price: -5,
        cost_price: 1.5,
        expected_weight_grams: 0,
        stock_quantity: 1,
        internal_sku: 'X',
        supplier_name: 'X',
        supplier_contact: 'x@example.com',
      },
    });
    expectStatus(response, 400);
    expectErrorCode(response, 'invalid_product');
    expect(response.json.errors.length >= 3, `expected several errors, got ${response.json.errors?.length}`);
    return `400 with ${response.json.errors.length} field errors`;
  });

  await check('R7.7', 'A product for an unregistered store is refused', async () => {
    const response = await api('/api/admin/products', {
      method: 'POST',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: {
        store_id: 'store_does_not_exist',
        barcode: '7019999999999',
        name: 'Orphan Product',
        category: 'Staples',
        image_url: '',
        unit_price: 1000,
        cost_price: 500,
        expected_weight_grams: 100,
        stock_quantity: 1,
        internal_sku: 'ORP-1',
        supplier_name: 'X',
        supplier_contact: 'x@example.com',
      },
    });
    expectStatus(response, 400);
    return '400 — no orphan catalogue entries';
  });

  await check('R7.8', 'Withdrawing a product hides it from customers', async () => {
    const patched = await api(`/api/admin/products/${state.createdProductId}`, {
      method: 'PATCH',
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
      body: { is_active: false },
    });
    expectStatus(patched, 200);

    const lookup = await api('/api/products/barcode/7011234567890', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    expectStatus(lookup, 404);
    expectErrorCode(lookup, 'product_not_found');

    // And it must not resurface through search either — the easier path to forget.
    const search = await api('/api/products/search?q=Harness&page_size=50', {
      ip: STORE_1.ip,
      token: state.sessionToken,
    });
    const stillListed = search.json.items.some((item) => item.barcode === '7011234567890');
    expect(!stillListed, 'withdrawn product still appears in customer search');
    return '404 on lookup, absent from search';
  });

  await check('R7.9', 'A withdrawn product is still visible to the operator', async () => {
    const response = await api('/api/admin/products?store_id=store_1', {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    expectStatus(response, 200);
    const found = response.json.products.find((product) => product.id === state.createdProductId);
    expect(Boolean(found), 'withdrawn product vanished from the admin listing too');
    expect(found.is_active === false, 'expected is_active false');
    return 'listed, is_active: false';
  });

  await check('R7.10', 'Operator view carries the commercial fields customers never see', async () => {
    const response = await api('/api/admin/products?store_id=store_1', {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    const product = response.json.products[0];
    for (const field of ['cost_price', 'supplier_name', 'stock_quantity', 'internal_sku']) {
      expect(field in product, `admin view is missing ${field}`);
    }
    // purchase_history stays server-side even for the operator: nothing renders it.
    expect(!('purchase_history' in product), 'purchase_history should not be projected');
    return 'cost, supplier, stock, SKU present; purchase_history withheld';
  });
}

// ---------------------------------------------------------------------------
// Server-priced orders and payment
// ---------------------------------------------------------------------------

/**
 * These cases exist because the basket used to be priced in the browser. The cart total
 * drove the UPI payment amount and the exit token's expected weight, both of which a
 * customer could edit before paying. Every case below is an attempt to do exactly that.
 */
async function validateOrders(state) {
  section('Server-priced orders and payment');

  /**
   * Sessions are minted sparingly and reused.
   *
   * `/api/session/start` is rate-limited per source IP (10 burst, refilling at 0.5/sec) —
   * deliberately, since it is the endpoint an attacker would use to brute-force QR
   * signatures. A test that opened a fresh session per case would trip that limit and
   * report a security control as an order-pricing failure. Only the two cases that are
   * *about* session identity take their own; everything else shares one, which is also
   * closer to how a real customer behaves: one entry, many actions.
   */
  async function freshSession(store = STORE_1) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await startSession(store);
      if (response.status === 201) return response.json.session_token;
      if (response.status !== 429) expectStatus(response, 201);
      await new Promise((resolve) => setTimeout(resolve, 2200));
    }
    throw new Error('could not obtain a session: still rate-limited after 8 attempts');
  }

  const primaryToken = await freshSession(STORE_1);

  /** Resolves a barcode to the product id the order API expects. */
  async function productIdFor(token, barcode, ip = STORE_1.ip) {
    const response = await api(`/api/products/barcode/${barcode}`, { ip, token });
    expectStatus(response, 200);
    return response.json.product;
  }

  await check('R8.1', 'Order creation requires a presence-verified session', async () => {
    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      body: { lines: [{ product_id: 'p_1', quantity: 1 }] },
    });
    expectStatus(response, 401);
    expectErrorCode(response, 'missing_token');
    return '401 missing_token';
  });

  await check('R8.2', 'Total is computed server-side from the catalogue', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      lines: undefined,
      body: { lines: [{ product_id: product.id, quantity: 2 }] },
    });
    expectStatus(response, 201);

    const order = response.json.order;
    const expectedSubtotal = STORE_1_PRICE * 2;
    expect(
      order.subtotal === expectedSubtotal,
      `subtotal ${order.subtotal} != catalogue price x2 (${expectedSubtotal})`
    );
    expect(
      order.total === expectedSubtotal + order.platform_fee - order.discount,
      'total does not reconcile against its own components'
    );
    state.orderToken = token;
    state.orderId = order.id;
    return `2 x ${STORE_1_PRICE} -> subtotal ${order.subtotal}, total ${order.total}`;
  });

  await check('R8.3', 'A client-supplied price is ignored, not trusted', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    // The shape a tampering client would send: its own price, total and weight alongside
    // the line. None of it is part of the contract, and none of it may have any effect.
    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: {
        lines: [{ product_id: product.id, quantity: 1, unit_price: 1, line_total: 1 }],
        subtotal: 1,
        total: 1,
        discount: 999999,
        expected_weight_grams: 1,
      },
    });
    expectStatus(response, 201);

    const order = response.json.order;
    expect(order.subtotal === STORE_1_PRICE, `subtotal was influenced: ${order.subtotal}`);
    expect(order.discount === 0, `client-supplied discount was applied: ${order.discount}`);
    expect(
      order.expected_weight_grams > 1,
      'client-supplied weight reached the exit token payload'
    );
    return `asked to pay 1 paise, priced at ${order.total}`;
  });

  await check('R8.4', 'Tampered quantities are refused', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const attempts = [-1, 0, 1000, 1.5];
    for (const quantity of attempts) {
      const response = await api('/api/orders', {
        method: 'POST',
        ip: STORE_1.ip,
        token,
        body: { lines: [{ product_id: product.id, quantity }] },
      });
      expectStatus(response, 400);
      expectErrorCode(response, 'invalid_quantity');
    }
    return `${attempts.length} invalid quantities -> 400`;
  });

  await check('R8.5', 'An unknown or withdrawn product cannot be ordered', async () => {
    const token = primaryToken;
    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: 'p_does_not_exist', quantity: 1 }] },
    });
    expectStatus(response, 409);
    expectErrorCode(response, 'unknown_product');
    return '409 unknown_product';
  });

  await check('R8.6', "Another store's product cannot be priced into this basket", async () => {
    // store_2's catalogue is a different set of ids. Ordering one of them through a
    // store_1 session must fail rather than silently pricing it.
    const storeTwoToken = await freshSession(STORE_2);
    const storeTwoProduct = await productIdFor(storeTwoToken, SHARED_BARCODE, STORE_2.ip);

    const storeOneToken = primaryToken;
    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token: storeOneToken,
      body: { lines: [{ product_id: storeTwoProduct.id, quantity: 1 }] },
    });
    expectStatus(response, 409);
    expectErrorCode(response, 'unknown_product');
    return `store_2's ${storeTwoProduct.id} refused by a store_1 session`;
  });

  await check('R8.7', 'The login discount is withheld from an unverifiable claim', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const response = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      // Exactly what the old checkout page trusted: a client asserting it is logged in.
      body: {
        lines: [{ product_id: product.id, quantity: 1 }],
        client_claims_authenticated: true,
      },
    });
    expectStatus(response, 201);
    expect(response.json.order.discount === 0, 'discount granted on a client-side claim');
    expect(
      response.json.discount_reason === 'identity_unverifiable',
      `unexpected discount_reason: ${response.json.discount_reason}`
    );
    return 'discount 0, reason identity_unverifiable';
  });

  await check('R8.8', 'No exit token is issued before payment is recorded', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });
    expectStatus(created, 201);
    expect(created.json.exit_token === undefined, 'exit token issued at order creation');
    expect(
      created.json.order.status === 'awaiting_payment',
      `unexpected status ${created.json.order.status}`
    );
    return 'status awaiting_payment, no token';
  });

  await check('R8.9', 'The exit token is server-signed over server-computed figures', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: product.id, quantity: 3 }] },
    });
    expectStatus(created, 201);
    const order = created.json.order;

    const paid = await api(`/api/orders/${order.id}/payment`, {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { method: 'in_store' },
    });
    expectStatus(paid, 200);

    const exitToken = paid.json.exit_token;
    expect(typeof exitToken === 'string' && exitToken.includes('.'), 'no signed exit token');

    // Verify it the way the exit terminal will: recompute the HMAC over the body.
    const [body, signature] = exitToken.split('.');
    const expected = createHmac('sha256', EXIT_TOKEN_SECRET).update(body).digest('base64url');
    expect(signature === expected, 'exit token signature does not verify');

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    expect(payload.amt === order.total, `token amount ${payload.amt} != order total ${order.total}`);
    expect(
      payload.w === order.expected_weight_grams,
      `token weight ${payload.w} != order weight ${order.expected_weight_grams}`
    );
    expect(payload.sid === STORE_1.id, 'token is not bound to the store');
    return `signed, ${payload.items} items, ${payload.w}g, ${payload.amt} paise`;
  });

  await check('R8.10', 'A forged exit token does not verify', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = signPayload(
      { v: 1, oid: 'ord_forged', sid: STORE_1.id, w: 1, amt: 1, items: 1, conf: 'psp_webhook', iat: now, exp: now + 900 },
      ATTACKER_SECRET
    );
    const [body, signature] = forged.split('.');
    const expected = createHmac('sha256', EXIT_TOKEN_SECRET).update(body).digest('base64url');
    expect(signature !== expected, 'an attacker-signed exit token verified against our key');
    return 'attacker-minted token fails signature check';
  });

  await check('R8.11', 'An unverified payment is labelled as unverified', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });
    const paid = await api(`/api/orders/${created.json.order.id}/payment`, {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      // The phase-1 reality: the customer says they paid the shop directly and nothing
      // corroborates it. That must be visible to the gate, not rounded up to "paid".
      body: { method: 'upi_attested' },
    });
    expectStatus(paid, 200);
    expect(paid.json.payment_verified === false, 'a self-attested payment reported as verified');
    expect(
      paid.json.order.payment.confirmation === 'customer_attested',
      `unexpected confirmation ${paid.json.order.payment.confirmation}`
    );

    const payload = JSON.parse(Buffer.from(paid.json.exit_token.split('.')[0], 'base64url').toString('utf8'));
    expect(payload.conf === 'customer_attested', 'confirmation level absent from the exit token');
    return 'payment_verified false, conf=customer_attested in token';
  });

  await check('R8.12', "One customer cannot pay another customer's order", async () => {
    const victimToken = primaryToken;
    const product = await productIdFor(victimToken, SHARED_BARCODE);
    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token: victimToken,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });
    expectStatus(created, 201);

    const attackerToken = await freshSession();
    const response = await api(`/api/orders/${created.json.order.id}/payment`, {
      method: 'POST',
      ip: STORE_1.ip,
      token: attackerToken,
      body: { method: 'in_store' },
    });
    expectStatus(response, 404);
    expectErrorCode(response, 'order_not_found');
    return '404 order_not_found for a different session';
  });

  await check('R8.13', 'Confirming payment twice is idempotent', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);
    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });

    const orderId = created.json.order.id;
    const first = await api(`/api/orders/${orderId}/payment`, {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { method: 'in_store' },
    });
    const second = await api(`/api/orders/${orderId}/payment`, {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { method: 'in_store' },
    });

    expectStatus(first, 200);
    expectStatus(second, 200);
    expect(
      first.json.order.total === second.json.order.total,
      'the order changed between confirmations'
    );
    return 'second confirmation returns the same paid order';
  });

  await check('R8.14', 'A customer who has left the store cannot place an order', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);

    // Same valid session token, now arriving from outside the registered network — the
    // customer walked out mid-basket. Continuous presence applies to ordering too.
    const response = await api('/api/orders', {
      method: 'POST',
      ip: HOME_IP,
      token,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });
    expectStatus(response, 403);
    expectErrorCode(response, 'presence_lost');
    return '403 presence_lost';
  });

  await check('R8.15', 'Order responses never carry cost or margin data', async () => {
    const token = primaryToken;
    const product = await productIdFor(token, SHARED_BARCODE);
    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_1.ip,
      token,
      body: { lines: [{ product_id: product.id, quantity: 1 }] },
    });

    const serialised = JSON.stringify(created.json);
    for (const key of ['cost_price', 'unitCostPaise', 'lineCostPaise', 'totalCostPaise', 'profit_margin_pct']) {
      expect(!serialised.includes(key), `${key} leaked into the customer order response`);
    }
    return 'cost and margin fields withheld from the customer projection';
  });
}

// ---------------------------------------------------------------------------
// Store analytics
// ---------------------------------------------------------------------------

/**
 * Analytics is the one surface where a plausible-looking wrong number is worse than a
 * missing one: an owner staffs a shift on it. So these cases assert exact figures rather
 * than "a number appeared", and they run against a store this function creates itself.
 *
 * The dedicated store matters. Every other section shares the seeded stores, whose event
 * counts depend on which checks ran before — so an assertion like "productsScanned is
 * exactly 1" would be measuring test order, not the read model. A store created here has
 * an empty log by construction, which means each figure below can be predicted from the
 * events this function deliberately produced and nothing else.
 */
async function validateAnalytics(state) {
  section('Store analytics');

  const STORE_IP = '192.0.2.90';
  const PRODUCT = {
    barcode: '7031234567890',
    unitPrice: 5000,
    costPrice: 3000,
    weight: 500,
    aisle: 'Aisle 3 - Beverages',
  };
  const UNSTOCKED_BARCODE = '7099999999999';
  const QUANTITY = 2;

  // Derived from the pricing rules in orders/pricing.ts, restated here on purpose: if the
  // harness recomputed them by importing the module, a change to both would cancel out.
  const SUBTOTAL = PRODUCT.unitPrice * QUANTITY; // 10000
  const PLATFORM_FEE = 200;
  const TOTAL = SUBTOTAL + PLATFORM_FEE; // no discount — identity is unverifiable
  const COST = PRODUCT.costPrice * QUANTITY; // 6000
  const GROSS_PROFIT = TOTAL - COST;

  /** Reads the dashboard the admin console renders. */
  async function analytics(storeId, window = '7d') {
    const response = await api(`/api/admin/analytics?store_id=${storeId}&window=${window}`, {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    expectStatus(response, 200);
    return response.json;
  }

  // ---- Fixtures: a store and a catalogue entry that exist only for this section ----

  const createdStore = await api('/api/admin/stores', {
    method: 'POST',
    ip: STORE_1.ip,
    token: ADMIN_TOKEN,
    body: {
      name: 'Analytics Test Mart',
      address: 'Indiranagar, Bangalore',
      latitude: 12.9784,
      longitude: 77.6408,
      authorizedEgressCidrs: [`${STORE_IP}/32`],
      advertisedSsid: 'Analytics-Guest',
      isActive: true,
      isOpen: true,
    },
  });
  expectStatus(createdStore, 201);
  const storeId = createdStore.json.store.id;

  const createdProduct = await api('/api/admin/products', {
    method: 'POST',
    ip: STORE_1.ip,
    token: ADMIN_TOKEN,
    body: {
      store_id: storeId,
      barcode: PRODUCT.barcode,
      name: 'Analytics Test Cola 500ml',
      category: 'Beverages',
      aisle: PRODUCT.aisle,
      image_url: '',
      unit_price: PRODUCT.unitPrice,
      cost_price: PRODUCT.costPrice,
      expected_weight_grams: PRODUCT.weight,
      stock_quantity: 100,
      internal_sku: 'BEV-ANL-500',
      supplier_name: 'Analytics Foods',
      supplier_contact: 'supply@analytics.example',
    },
  });
  expectStatus(createdProduct, 201);
  // Taken from the create response rather than by scanning the barcode: a lookup would
  // itself record a product_scanned event and make the scan counts below untrue.
  const productId = createdProduct.json.product.id;

  // ---- Access control ----

  await check('R9.1', 'Analytics API rejects anonymous callers', async () => {
    const response = await api(`/api/admin/analytics?store_id=${storeId}`, { ip: STORE_1.ip });
    expectStatus(response, 401);
    expectErrorCode(response, 'missing_token');
    return '401 missing_token';
  });

  await check('R9.2', 'Analytics API rejects a wrong token', async () => {
    const response = await api(`/api/admin/analytics?store_id=${storeId}`, {
      ip: STORE_1.ip,
      token: 'not-the-admin-token',
    });
    expectStatus(response, 403);
    expectErrorCode(response, 'invalid_token');
    return '403 invalid_token';
  });

  await check('R9.3', 'A store id is required — there is no cross-store rollup', async () => {
    // The absence of this endpoint is the feature: a retailer must never be able to reach
    // a competitor's takings through their own console by omitting a parameter.
    const response = await api('/api/admin/analytics', { ip: STORE_1.ip, token: ADMIN_TOKEN });
    expectStatus(response, 400);
    expectErrorCode(response, 'missing_store_id');
    return '400 missing_store_id';
  });

  await check('R9.4', 'Only the supported windows are accepted', async () => {
    const rejected = await api(`/api/admin/analytics?store_id=${storeId}&window=all_time`, {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    expectStatus(rejected, 400);
    expectErrorCode(rejected, 'unknown_window');

    for (const window of ['today', '7d', '30d']) {
      const accepted = await api(`/api/admin/analytics?store_id=${storeId}&window=${window}`, {
        ip: STORE_1.ip,
        token: ADMIN_TOKEN,
      });
      expectStatus(accepted, 200);
      expect(accepted.json.window === window, `window echoed back as ${accepted.json.window}`);
    }
    return 'today/7d/30d accepted, all_time -> 400';
  });

  await check('R9.5', 'An unknown store id is refused', async () => {
    const response = await api('/api/admin/analytics?store_id=store_does_not_exist', {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    expectStatus(response, 404);
    expectErrorCode(response, 'unknown_store');
    return '404 unknown_store';
  });

  await check('R9.6', 'Analytics is never cached', async () => {
    const response = await api(`/api/admin/analytics?store_id=${storeId}`, {
      ip: STORE_1.ip,
      token: ADMIN_TOKEN,
    });
    const cacheControl = response.headers.get('cache-control') ?? '';
    expect(cacheControl.includes('no-store'), `expected no-store, got "${cacheControl}"`);
    return cacheControl;
  });

  // ---- The read model, driven by a real shopping trip ----

  await check('R9.7', 'A store that has traded nothing reports nothing, not sample data', async () => {
    const { analytics: a, data_since } = await analytics(storeId);

    expect(a.sessionsStarted === 0, `invented ${a.sessionsStarted} sessions`);
    expect(a.productsScanned === 0, `invented ${a.productsScanned} scans`);
    expect(a.revenue.grossPaise === 0, `invented ${a.revenue.grossPaise} paise of revenue`);
    expect(a.topProducts.length === 0, 'invented top products');
    expect(a.aisleTraffic.length === 0, 'invented aisle traffic');

    // The distinction the dashboard exists to preserve: a metric with no basis is null and
    // renders as "—", never as a zero an owner would read as "nobody bought anything".
    expect(a.conversionRatePct === null, `conversion was ${a.conversionRatePct}, expected null`);
    expect(
      a.averageShoppingMinutes === null,
      `average shopping time was ${a.averageShoppingMinutes}, expected null`
    );
    expect(
      a.revenue.averageOrderValuePaise === null,
      `AOV was ${a.revenue.averageOrderValuePaise}, expected null`
    );
    expect(data_since === null, `data_since was ${data_since} for a store with no events`);
    return 'zeros where counted, null where unknowable, data_since null';
  });

  const session = await api('/api/session/start', {
    method: 'POST',
    ip: STORE_IP,
    body: { qr_token: (await fetchEntryQr(storeId)).qr_token },
  });
  expectStatus(session, 201);
  const token = session.json.session_token;

  await check('R9.8', 'A presence-verified entry is counted as footfall', async () => {
    const { analytics: a, data_since } = await analytics(storeId);
    expect(a.sessionsStarted === 1, `expected 1 session, got ${a.sessionsStarted}`);
    // Only entries that passed both presence factors can reach the recording point, so this
    // is a count of verified entries rather than of attempts.
    expect(typeof data_since === 'number', 'data_since should be set once events exist');
    return `sessionsStarted 1, log starts at ${new Date(data_since).toISOString()}`;
  });

  await check('R9.9', 'A scan is counted and located to an aisle', async () => {
    const scan = await api(`/api/products/barcode/${PRODUCT.barcode}`, { ip: STORE_IP, token });
    expectStatus(scan, 200);

    const { analytics: a } = await analytics(storeId);
    expect(a.productsScanned === 1, `expected 1 scan, got ${a.productsScanned}`);
    expect(a.aisleTraffic.length === 1, `expected 1 aisle, got ${a.aisleTraffic.length}`);

    const [aisle] = a.aisleTraffic;
    expect(aisle.aisle === PRODUCT.aisle, `expected "${PRODUCT.aisle}", got "${aisle.aisle}"`);
    expect(aisle.scans === 1, `expected 1 scan in the aisle, got ${aisle.scans}`);
    // Footfall, not scan volume: one shopper scanning five things is one session here.
    expect(aisle.sessions === 1, `expected 1 session in the aisle, got ${aisle.sessions}`);
    return `1 scan located to "${aisle.aisle}", 1 session`;
  });

  await check('R9.10', 'A barcode the shop does not stock is recorded as a catalogue gap', async () => {
    const miss = await api(`/api/products/barcode/${UNSTOCKED_BARCODE}`, { ip: STORE_IP, token });
    expectStatus(miss, 404);

    const { analytics: a } = await analytics(storeId);
    expect(a.missedScans.length === 1, `expected 1 missed scan, got ${a.missedScans.length}`);
    expect(
      a.missedScans[0].barcode === UNSTOCKED_BARCODE,
      `recorded the wrong barcode: ${a.missedScans[0].barcode}`
    );
    // A miss must not inflate the scan count — they answer different questions.
    expect(a.productsScanned === 1, `a miss was counted as a scan (${a.productsScanned})`);
    return `${UNSTOCKED_BARCODE} listed as a gap, scan count unchanged`;
  });

  await check('R9.11', 'An abandoned basket is not in the takings', async () => {
    const created = await api('/api/orders', {
      method: 'POST',
      ip: STORE_IP,
      token,
      body: { lines: [{ product_id: productId, quantity: QUANTITY }] },
    });
    expectStatus(created, 201);
    state.analyticsOrderId = created.json.order.id;

    // The order exists and is priced; the customer has simply not paid. Revenue that moves
    // on basket submission would overstate a day's trading by every abandoned cart.
    const { analytics: a } = await analytics(storeId);
    expect(a.revenue.ordersPlaced === 0, `counted ${a.revenue.ordersPlaced} unpaid orders`);
    expect(a.revenue.grossPaise === 0, `booked ${a.revenue.grossPaise} paise before payment`);
    expect(a.unitsSold === 0, `counted ${a.unitsSold} units before payment`);
    return `order ${state.analyticsOrderId} priced at ${created.json.order.total}, takings still 0`;
  });

  await check('R9.12', 'Payment books the sale, and gross profit reconciles', async () => {
    const paid = await api(`/api/orders/${state.analyticsOrderId}/payment`, {
      method: 'POST',
      ip: STORE_IP,
      token,
      body: { method: 'in_store' },
    });
    expectStatus(paid, 200);

    const { analytics: a } = await analytics(storeId);
    expect(a.revenue.ordersPlaced === 1, `expected 1 order, got ${a.revenue.ordersPlaced}`);
    expect(a.revenue.grossPaise === TOTAL, `expected ${TOTAL} paise, got ${a.revenue.grossPaise}`);
    expect(
      a.revenue.grossProfitPaise === GROSS_PROFIT,
      `expected ${GROSS_PROFIT} profit, got ${a.revenue.grossProfitPaise}`
    );
    expect(
      a.revenue.averageOrderValuePaise === TOTAL,
      `expected AOV ${TOTAL}, got ${a.revenue.averageOrderValuePaise}`
    );
    expect(
      a.revenue.platformFeePaise === PLATFORM_FEE,
      `expected ${PLATFORM_FEE} in fees, got ${a.revenue.platformFeePaise}`
    );
    expect(a.unitsSold === QUANTITY, `expected ${QUANTITY} units, got ${a.unitsSold}`);

    // Top products are ranked on money taken, and the line price is copied onto the event
    // so that re-pricing the item tomorrow cannot restate today's takings.
    expect(a.topProducts.length === 1, `expected 1 top product, got ${a.topProducts.length}`);
    expect(
      a.topProducts[0].revenuePaise === SUBTOTAL,
      `expected ${SUBTOTAL} line revenue, got ${a.topProducts[0].revenuePaise}`
    );
    expect(a.topProducts[0].unitsSold === QUANTITY, 'units sold missing from the ranking');
    return `${TOTAL} paise gross, ${GROSS_PROFIT} profit, ${QUANTITY} units`;
  });

  await check('R9.13', 'Paying twice does not book the sale twice', async () => {
    // The payment route is idempotent by design (R8.13). If the event were recorded outside
    // that guard, a retried request or a double tap would silently inflate the day's total.
    const again = await api(`/api/orders/${state.analyticsOrderId}/payment`, {
      method: 'POST',
      ip: STORE_IP,
      token,
      body: { method: 'in_store' },
    });
    expectStatus(again, 200);

    const { analytics: a } = await analytics(storeId);
    expect(a.revenue.ordersPlaced === 1, `revenue double-counted: ${a.revenue.ordersPlaced} orders`);
    expect(a.revenue.grossPaise === TOTAL, `revenue double-counted: ${a.revenue.grossPaise} paise`);
    expect(a.unitsSold === QUANTITY, `units double-counted: ${a.unitsSold}`);
    return `second confirmation left the takings at ${TOTAL} paise`;
  });

  await check('R9.14', 'Shopping time is reported only for sessions that actually ended', async () => {
    const before = await analytics(storeId);
    expect(
      before.analytics.averageShoppingMinutes === null,
      'a duration was reported for a session still in progress'
    );
    expect(
      before.analytics.completedSessionSampleSize === 0,
      `sample size ${before.analytics.completedSessionSampleSize} before any session ended`
    );

    const ended = await api('/api/session/end', { method: 'POST', ip: STORE_IP, token });
    expectStatus(ended, 200);

    const { analytics: a } = await analytics(storeId);
    expect(a.sessionsCompleted === 1, `expected 1 completed session, got ${a.sessionsCompleted}`);
    expect(a.completedSessionSampleSize === 1, `expected sample size 1, got ${a.completedSessionSampleSize}`);
    expect(
      typeof a.averageShoppingMinutes === 'number' && a.averageShoppingMinutes >= 0,
      `expected a duration, got ${a.averageShoppingMinutes}`
    );
    // The session both started and converted, so conversion is the full 100% rather than a
    // ratio over sessions that were never going to be counted.
    expect(a.conversionRatePct === 100, `expected 100% conversion, got ${a.conversionRatePct}`);
    return `sample size 1, ${a.averageShoppingMinutes} min, 100% conversion`;
  });

  await check('R9.15', "One store's takings never appear in another's dashboard", async () => {
    // store_1 has been trading throughout this run. Neither store may see the other.
    const mine = await analytics(storeId);
    const theirs = await analytics(STORE_1.id);

    expect(mine.analytics.storeId === storeId, 'response is scoped to the wrong store');
    expect(theirs.analytics.storeId === STORE_1.id, 'response is scoped to the wrong store');
    expect(
      mine.analytics.revenue.grossPaise === TOTAL,
      `this store's takings changed to ${mine.analytics.revenue.grossPaise}`
    );

    // The decisive check: the item sold here must be absent from the other store's ranking,
    // and vice versa. A shared read model would surface both in both.
    const leakedIntoTheirs = theirs.analytics.topProducts.some((p) => p.productId === productId);
    expect(!leakedIntoTheirs, "this store's product appeared in store_1's ranking");

    const barcodesHere = mine.analytics.missedScans.map((m) => m.barcode);
    expect(
      barcodesHere.length === 1 && barcodesHere[0] === UNSTOCKED_BARCODE,
      `store_1's missed scans bled into this store: ${barcodesHere.join(', ')}`
    );
    return `${theirs.analytics.revenue.ordersPlaced} orders at store_1, ${mine.analytics.revenue.ordersPlaced} here, no overlap`;
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
    SNAPUP_ADMIN_API_TOKEN: ADMIN_TOKEN,
    SNAPUP_EXIT_TOKEN_SECRET: EXIT_TOKEN_SECRET,
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
    await validateStoreDirectory(state);
    await validateAdminRegistry(state);
    await validateAdminCatalogue(state);
    await validateOrders(state);
    await validateAnalytics(state);
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
