/**
 * The database the validation harnesses run against.
 *
 * ## Why the harness owns its data
 *
 * `validate-requirements.mjs` was written against the in-memory seed: store_1 on
 * 198.51.100.24, store_2 on 198.51.100.25, a Diet Pepsi that costs ₹40 in one and ₹42 in
 * the other. The app then moved to a database, the seed store became the real pilot branch
 * — surveyed, but with no network range, because that value is a secret — and every case
 * that needed a session failed on presence. The harness had not regressed; its fixtures
 * had drifted out from under it.
 *
 * So the fixtures live here, next to the harness that depends on them, and go into a
 * **throwaway** embedded database created fresh for each run. Nothing the harness does —
 * registering stores, adding products, placing orders — touches the dev database, and no
 * state from a previous run can leak into the next.
 *
 * ## Usage
 *
 *   import { provisionValidationDatabase } from './validation-fixtures.mjs';
 *   const url = await provisionValidationDatabase();   // 'file:./.data/validation'
 *   // start the app with DATABASE_URL=url (relative to apps/customer-web, see below)
 */

import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, '.data', 'validation');

/** As the repo root sees it. */
export const VALIDATION_DATABASE_URL = 'file:./.data/validation';
/** As `apps/customer-web` sees it — the server's cwd, and the form `.env.local` uses. */
export const VALIDATION_DATABASE_URL_FROM_APP = 'file:../../.data/validation';

/** Registered egress IPs. Both /32: the two stores must not share a range. */
export const STORES = [
  {
    id: 'store_1',
    name: 'Kurinji Metro Bazaar — Kumbakonam',
    address: 'Kumbakonam, Thanjavur District, Tamil Nadu',
    latitude: 10.960012397744165,
    longitude: 79.37967349325342,
    cidrs: ['198.51.100.24/32'],
    ssid: 'KMB-Kumbakonam-Guest',
    vpa: 'harness@upi',
    displayName: 'Kurinji Metro Bazaar',
  },
  {
    // Surveyed and ~32 km from store_1: what lets the radius cases see a radius do
    // something. Inside 100 km, outside 2 km.
    id: 'store_3',
    name: 'Kurinji Metro Bazaar — Thanjavur',
    address: 'Thanjavur, Tamil Nadu',
    latitude: 10.787,
    longitude: 79.1378,
    cidrs: ['198.51.100.26/32'],
    ssid: 'KMB-Thanjavur-Guest',
    vpa: 'harness3@upi',
    displayName: 'Kurinji Metro Bazaar',
  },
  {
    // Unsurveyed on purpose: the directory cases assert that a store with no coordinates
    // is appended without a distance rather than ranked, and this is that store.
    id: 'store_2',
    name: 'SnapUp Test — Home Wi-Fi',
    address: 'Test bench — not a retail location',
    latitude: null,
    longitude: null,
    cidrs: ['198.51.100.25/32'],
    ssid: 'Home-WiFi',
    vpa: 'harness2@upi',
    displayName: 'SnapUp Test',
  },
];

/**
 * The catalogue, mirroring `apps/customer-web/src/server/products/seed.ts`.
 *
 * Duplicated rather than imported: that file is `server-only` and typed, and a test's
 * fixtures should not change because the app's demo data did. The sensitive columns are
 * populated with the exact values the harness greps for, so "hidden fields are never
 * exposed" is checked against something real rather than passing vacuously.
 *
 * [id, store, barcode, name, category, aisle, price, weight, cost, supplier, contact, stock, sku]
 */
const P = (row) => {
  const [id, store, barcode, name, category, aisle, price, weight, cost, supplier, contact, stock, sku] = row;
  return { id, store, barcode, name, category, aisle, price, weight, cost, supplier, contact, stock, sku };
};

export const PRODUCTS = [
  ['p1',  'store_1', '012000000133',  'Diet Pepsi 12oz Can',              'Beverages', 'A3', 4000,  380,  2600,  'PepsiCo India Distribution',    'orders@pepsico-dist.example',     240, 'BEV-PEP-DT-12'],
  ['p2',  'store_1', '049000028904',  'Coca-Cola 20oz Bottle',            'Beverages', 'A3', 6000,  620,  4100,  'Hindustan Coca-Cola Beverages', 'supply@hccb.example',             180, 'BEV-COK-20'],
  ['p3',  'store_1', '8901030865278', 'Amul Gold Full Cream Milk 1L',     'Dairy',     'B1', 7200,  1030, 6300,  'Amul Dairy Co-operative',       'b2b@amul.example',                96,  'DRY-AML-GLD-1L'],
  ['p4',  'store_1', '8901719101106', 'Britannia Good Day Cashew 200g',   'Snacks',    'C2', 5000,  210,  3800,  'Britannia Industries',          'trade@britannia.example',         154, 'SNK-BRT-GD-200'],
  ['p5',  'store_1', '8904004400015', 'Tata Salt 1kg',                    'Staples',   'D1', 2800,  1010, 2100,  'Tata Consumer Products',        'distribution@tataconsumer.example', 320, 'STP-TAT-SLT-1K'],
  ['p6',  'store_1', '8901058000108', 'Maggi 2-Minute Noodles 70g',       'Staples',   'D2', 1400,  75,   1050,  'Nestle India',                  'orders@nestle-in.example',        640, 'STP-MAG-70'],
  ['p7',  'store_1', '8901396160205', 'Colgate Strong Teeth 200g',        'Personal',  'E1', 11000, 230,  8200,  'Colgate-Palmolive India',       'supply@colgate-in.example',       78,  'PC-CLG-ST-200'],
  ['p8',  'store_1', '8901030634567', 'Surf Excel Easy Wash 1kg',         'Household', 'F1', 13500, 1020, 10800, 'Hindustan Unilever',            'trade@hul.example',               45,  'HH-SRF-EW-1K'],
  ['p9',  'store_1', '8901725110016', 'Aashirvaad Atta 5kg',              'Staples',   'D1', 27500, 5050, 23000, 'ITC Foods',                     'foods@itc.example',               62,  'STP-ASH-ATT-5K'],
  ['p10', 'store_1', '8901491101820', 'Lay’s Classic Salted 52g',         'Snacks',    'C1', 2000,  60,   1400,  'PepsiCo India Distribution',    'orders@pepsico-dist.example',     510, 'SNK-LAY-CS-52'],
  ['p11', 'store_1', '8901063093027', 'Nescafe Classic Coffee 50g',       'Beverages', 'A1', 19000, 78,   14200, 'Nestle India',                  'orders@nestle-in.example',        88,  'BEV-NES-CL-50'],
  ['p12', 'store_1', '8906002490011', 'Fortune Sunflower Oil 1L',         'Staples',   'D3', 15500, 920,  13100, 'Adani Wilmar',                  'sales@adaniwilmar.example',       130, 'STP-FRT-SFO-1L'],
  // store_2: the same barcode at a different price proves scoping is enforced, and one
  // item store_1 also stocks so cross-store reads have something to be refused for.
  ['p13', 'store_2', '012000000133',  'Diet Pepsi 12oz Can',              'Beverages', 'A1', 4200,  380,  2600,  'PepsiCo India Distribution',    'orders@pepsico-dist.example',     210, 'BEV-PEP-DT-12'],
  ['p14', 'store_2', '8901058000108', 'Maggi 2-Minute Noodles 70g',       'Staples',   'B1', 1500,  75,   1050,  'Nestle India',                  'orders@nestle-in.example',        300, 'STP-MAG-70'],
].map(P);

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'], ...options });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
  });
}

/**
 * A fresh database with the fixtures in it. Returns the URL the *repo root* uses; the
 * server, whose cwd is the app directory, wants `VALIDATION_DATABASE_URL_FROM_APP`.
 */
export async function provisionValidationDatabase() {
  await rm(DATA_DIR, { recursive: true, force: true });

  // The real migration, so the fixtures land in the schema the app actually runs — a
  // hand-written CREATE TABLE here would be a second schema to keep in step.
  await run(process.execPath, [join(ROOT, 'scripts', 'db-migrate.mjs')], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: VALIDATION_DATABASE_URL },
  });

  const { PGlite } = await import('@electric-sql/pglite');
  const db = await PGlite.create(DATA_DIR);
  try {
    for (const s of STORES) {
      await db.query(
        `INSERT INTO stores (
           id, name, address, latitude, longitude, authorized_egress_cidrs,
           advertised_ssid, merchant_vpa, merchant_display_name, is_active, is_open
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, true)`,
        [s.id, s.name, s.address, s.latitude, s.longitude, s.cidrs, s.ssid, s.vpa, s.displayName]
      );
    }
    await db.query(
      `SELECT setval('store_id_seq', GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '[^0-9]', '', 'g'), '')::bigint), 0) FROM stores), 1))`
    );

    for (const p of PRODUCTS) {
      const margin = Math.round(((p.price - p.cost) / p.price) * 1000) / 10;
      await db.query(
        `INSERT INTO products (
           id, store_id, barcode, name, category, aisle, image_url,
           unit_price, expected_weight_grams, is_active,
           cost_price, profit_margin_pct, supplier_name, supplier_contact,
           stock_quantity, internal_sku, purchase_history
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13, $14, $15, $16::jsonb)`,
        [
          p.id, p.store, p.barcode, p.name, p.category, p.aisle, `/products/${p.id}.png`,
          p.price, p.weight, p.cost, margin, p.supplier, p.contact, p.stock, p.sku,
          JSON.stringify([
            { date: '2026-05-02', qty: 240, unit_cost: p.cost },
            { date: '2026-06-14', qty: 180, unit_cost: Math.round(p.cost * 0.97) },
          ]),
        ]
      );
    }
    // The console mints product ids from this sequence; explicit inserts do not advance it.
    await db.query(`SELECT setval('product_id_seq', 1000)`);
  } finally {
    await db.close();
  }

  return VALIDATION_DATABASE_URL;
}
