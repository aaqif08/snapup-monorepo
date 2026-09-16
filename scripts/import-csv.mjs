#!/usr/bin/env node
/**
 * Imports the pilot catalogue and store registry from CSV.
 *
 *   npm run db:import -- data/products.csv data/stores.csv
 *
 * CSV because that is what a POS or an Excel sheet exports without anyone writing code,
 * and because a retailer can correct a price in it without a database client.
 *
 * ## Money
 *
 * The CSV column is `price_rupees`; the database column is paise. The header name is
 * checked rather than inferred, and the import refuses to run without it. A silent
 * hundred-fold error in either direction is the worst thing this file could do, and "the
 * column was called `price` and we assumed" is not a defence anyone wants to make
 * afterwards.
 *
 * ## Idempotent
 *
 * Products upsert on `(store_id, barcode)`. Re-importing a corrected sheet updates rows
 * rather than duplicating them, so fixing one price does not mean rebuilding the database.
 *
 * ## Stock is added, not assigned
 *
 * Section 8 of the billing brief: "Product imports must increase inventory.available_qty,
 * not overwrite it accidentally, unless an explicitly approved stock-take/import mode says
 * otherwise."
 *
 * This used to assign it — `stock_quantity = EXCLUDED.stock_quantity`. Re-importing a
 * sheet to correct one price silently reset every count on it to whatever the sheet
 * happened to say, discarding every sale since it was exported. The failure is invisible:
 * the import reports success and the shelf counts are simply wrong afterwards.
 *
 * So `stock` is a **delivery**, added to what is already there. To declare an absolute
 * count instead, pass `--stock-take`, which is the "explicitly approved mode" the brief
 * asks for — it has to be typed, it is named in the audit row, and the script says out
 * loud what it is about to do.
 *
 *   npm run db:import -- data/products.csv                 # 40 in the sheet  →  shelf + 40
 *   npm run db:import -- data/products.csv --stock-take    # 40 in the sheet  →  shelf = 40
 *
 * Every movement writes a `stock_imports` row naming the actor, the mode and the before and
 * after counts, and an outbox event so the 30-minute sync carries the delta to the original
 * shop database.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireDatabaseLock } from './db-lock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_URL = 'file:./.data/snapup';

/**
 * Handed back in `main`'s `finally`, after the engine is closed.
 *
 * This script previously opened the data directory with no lock and no handling for a
 * leftover `postmaster.pid`. Run against a live dev server it was a second postmaster on
 * one write-ahead log; run after an unclean stop it simply hung forever, because PGlite
 * blocks rather than errors when it finds that file.
 */
let releaseLock = () => {};
let closeDatabase = async () => {};

/** RFC 4180 enough: quoted fields, doubled quotes inside them, commas and newlines within. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((cell) => cell.trim().length > 0))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Rupees to paise, on the decimal string rather than through a float.
 *
 * `Math.round(275.55 * 100)` is 27555 today and a source of one-paise drift the moment
 * somebody changes the rounding. Integer arithmetic on the two halves has no such mode.
 */
function toPaise(value, label, line) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(
      `line ${line}: ${label} must be a rupee amount like 275 or 275.50, got "${value}"`
    );
  }
  const [rupees, paise = ''] = value.split('.');
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'));
}

function requireHeaders(rows, required, file) {
  if (rows.length === 0) throw new Error(`${file} has no data rows.`);
  const missing = required.filter((h) => !(h in rows[0]));
  if (missing.length > 0) {
    throw new Error(
      `${file} is missing required column(s): ${missing.join(', ')}\n` +
        `Found: ${Object.keys(rows[0]).join(', ')}\n\n` +
        'Prices must be in a column literally named "price_rupees". The importer converts ' +
        'to paise, and guessing at a column called "price" risks a 100x error.'
    );
  }
}

async function connect(url) {
  const isEmbedded = url.startsWith('file:') || url.startsWith('pglite://');
  if (!isEmbedded) {
    const { neon } = await import('@neondatabase/serverless');
    return neon(url);
  }
  const dir = resolve(ROOT, url.replace(/^(file:|pglite:\/\/)/, '').replace(/^\/\//, ''));

  // Refuses while the app holds the directory, and clears a stale `postmaster.pid` only
  // once this process owns it. Without this the import either corrupts a live database or
  // hangs on one that was not shut down cleanly.
  releaseLock = acquireDatabaseLock(dir);

  const { PGlite } = await import('@electric-sql/pglite');
  const database = await PGlite.create(dir);
  closeDatabase = () => database.close();
  return async (statement, values) => (await database.query(statement, values)).rows;
}

/**
 * Appends the audit row and the sync event for one stock movement.
 *
 * Tolerant of an unmigrated database for the same reason `appendOutbox` is: these tables
 * are in `schema.sql` and unapplied pending the owner's approval, and a catalogue import
 * that refuses to run because the audit table is absent helps nobody. The movement itself
 * has already been written; this is the record of it, and a missing record is recoverable
 * where a failed import at eleven at night is not.
 */
async function recordStockMovement(sql, movement) {
  try {
    await sql(
      `INSERT INTO stock_imports (
         store_id, product_id, internal_sku, barcode,
         mode, quantity, qty_before, qty_after, imported_by, source, imported_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        movement.storeId,
        movement.productId,
        movement.sku,
        movement.barcode,
        movement.mode,
        movement.quantity,
        movement.qtyBefore,
        movement.qtyAfter,
        movement.actor,
        movement.source,
        movement.at,
      ]
    );

    // One event per SKU, matching what the sync expects — see `server/sync/outbox.ts` for
    // why a movement is never batched into a single multi-line event.
    //
    // The delta is what actually changed, not what the sheet said. Under `--stock-take`
    // those differ: a sheet declaring 40 against a shelf of 55 is a delta of -15, and that
    // is the number the original database has to apply to reach the same answer.
    const delta = movement.qtyAfter - movement.qtyBefore;
    if (delta === 0) return;

    await sql(
      `INSERT INTO outbox (event_type, store_id, subject_id, payload, created_at)
       VALUES ('stock.imported', $1, $2, $3::jsonb, $4)`,
      [
        movement.storeId,
        movement.productId,
        JSON.stringify({
          sku: movement.sku,
          barcode: movement.barcode,
          delta,
          mode: movement.mode,
          imported_by: movement.actor,
          source: movement.source,
        }),
        movement.at,
      ]
    );
  } catch (error) {
    if (/relation "(stock_imports|outbox)" does not exist/i.test(error.message ?? '')) {
      stockAuditSkipped += 1;
      return;
    }
    throw error;
  }
}

/** Counted rather than logged per row, so an unmigrated database says one thing, not 547. */
let stockAuditSkipped = 0;

async function importProducts(sql, file, options) {
  const rows = parseCsv(await readFile(file, 'utf8'));
  requireHeaders(rows, ['barcode', 'name', 'price_rupees'], file);

  const mode = options.stockTake ? 'stock_take' : 'increase';
  const at = Date.now();

  let count = 0;
  let moved = 0;
  for (const [index, row] of rows.entries()) {
    const line = index + 2; // +1 for the header, +1 because humans count from one
    const storeId = row.store_id || process.env.SNAPUP_IMPORT_STORE || 'store_1';

    if (!row.barcode) {
      throw new Error(`line ${line}: barcode is required — it is what the scanner matches.`);
    }

    const price = toPaise(row.price_rupees, 'price_rupees', line);
    // Cost defaults to the price when the sheet omits it, so the margin reads as zero
    // rather than as a profit nobody entered. An honest blank beats an invented number on
    // a dashboard somebody will make decisions from.
    const cost = row.cost_rupees ? toPaise(row.cost_rupees, 'cost_rupees', line) : price;
    const margin = price > 0 ? Number((((price - cost) / price) * 100).toFixed(2)) : 0;

    // `before` is read in the same statement as the write, so it sees the row as it was:
    // a CTE observes the snapshot the statement started from, whatever the upsert then
    // does to it. Reading it separately would race any concurrent movement.
    const [result] = await sql(
      `WITH before AS (
         SELECT stock_quantity FROM products WHERE store_id = $1 AND barcode = $2
       ),
       upserted AS (
         INSERT INTO products (
           id, store_id, barcode, name, category, aisle, image_url,
           unit_price, expected_weight_grams, is_active,
           cost_price, profit_margin_pct, supplier_name, supplier_contact,
           stock_quantity, internal_sku, purchase_history,
           brand, mrp_paise, discount_paise, gst_amount_paise, gst_rate_bp
         ) VALUES (
           'prod_' || nextval('product_id_seq'), $1, $2, $3, $4, NULLIF($5, ''), $6,
           $7, $8, true, $9, $10, $11, '', $12, $13, '[]'::jsonb,
           NULLIF($14, ''), $15, $16, $17, $18
         )
         ON CONFLICT (store_id, barcode) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           aisle = EXCLUDED.aisle,
           unit_price = EXCLUDED.unit_price,
           expected_weight_grams = EXCLUDED.expected_weight_grams,
           cost_price = EXCLUDED.cost_price,
           profit_margin_pct = EXCLUDED.profit_margin_pct,
           supplier_name = EXCLUDED.supplier_name,
           -- Section 8. The sheet's figure is a delivery to be added, unless someone
           -- explicitly asked for a stock-take, in which case it is the count itself.
           stock_quantity = CASE
             WHEN $19 THEN EXCLUDED.stock_quantity
             ELSE products.stock_quantity + EXCLUDED.stock_quantity
           END,
           internal_sku = EXCLUDED.internal_sku,
           brand = EXCLUDED.brand,
           mrp_paise = EXCLUDED.mrp_paise,
           discount_paise = EXCLUDED.discount_paise,
           gst_amount_paise = EXCLUDED.gst_amount_paise,
           gst_rate_bp = EXCLUDED.gst_rate_bp,
           is_active = true
         RETURNING id, internal_sku, barcode, stock_quantity
       )
       SELECT u.id, u.internal_sku, u.barcode,
              u.stock_quantity AS qty_after,
              COALESCE((SELECT stock_quantity FROM before), 0) AS qty_before
         FROM upserted AS u`,
      [
        storeId,
        row.barcode,
        row.name,
        row.category || 'General',
        row.aisle || '',
        row.image_url || '',
        price,
        Number(row.weight_grams || 0),
        cost,
        margin,
        row.supplier || '',
        Number(row.stock || 0),
        row.sku || '',
        row.brand || '',
        // Optional columns. A sheet without them leaves MRP unknown and the Snap Up
        // discount at zero, which is the correct reading of "not stated" — a missing
        // discount must never be inferred from the price.
        row.mrp_rupees ? toPaise(row.mrp_rupees, 'mrp_rupees', line) : null,
        row.discount_rupees ? toPaise(row.discount_rupees, 'discount_rupees', line) : 0,
        // GST already inside the price. Zero when the sheet does not state it — never
        // derived from a rate here, because the retailer's taxable value, CGST and SGST
        // all have to agree with it for a GSTR filing.
        row.gst_amount_rupees ? toPaise(row.gst_amount_rupees, 'gst_amount_rupees', line) : 0,
        // Basis points, so 18.00% is 1800 and no float ever reaches the column.
        row.gst_rate ? Math.round(Number(row.gst_rate) * 100) : null,
        options.stockTake,
      ]
    );
    count += 1;

    const qtyBefore = Number(result.qty_before);
    const qtyAfter = Number(result.qty_after);

    if (qtyAfter !== qtyBefore) {
      moved += 1;
      await recordStockMovement(sql, {
        storeId,
        productId: result.id,
        sku: result.internal_sku || '',
        barcode: result.barcode,
        mode,
        quantity: Number(row.stock || 0),
        qtyBefore,
        qtyAfter,
        actor: options.actor,
        source: options.source,
        at,
      });
    }
  }

  console.log(`  products: ${count} rows imported or updated`);
  console.log(
    `  stock:    ${moved} row(s) changed count, ${mode === 'stock_take' ? 'assigned as a stock-take' : 'added to what was on the shelf'}`
  );

  const noWeight = rows.filter((r) => !r.weight_grams || Number(r.weight_grams) === 0).length;
  if (noWeight > 0) {
    console.log(`\n  NOTE: ${noWeight} product(s) have no weight.`);
    console.log('  The exit gate compares basket weight against the expected total, so those');
    console.log('  items contribute nothing to the check. Fine for a pilot, not for a gate.');
  }
}

async function importStores(sql, file) {
  const rows = parseCsv(await readFile(file, 'utf8'));
  requireHeaders(rows, ['store_id', 'name', 'address'], file);

  for (const [index, row] of rows.entries()) {
    const line = index + 2;

    // Coordinates stay NULL unless both are present. A half-entered pair is always a
    // mistake, and 0,0 is a real place off the coast of Ghana rather than a way of
    // spelling "unknown".
    const hasCoords = Boolean(row.latitude && row.longitude);
    if ((row.latitude || row.longitude) && !hasCoords) {
      throw new Error(`line ${line}: give both latitude and longitude, or neither.`);
    }

    const cidrs = (row.egress_cidr || '')
      .split(/[;|]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    await sql(
      `INSERT INTO stores (
         id, name, address, latitude, longitude, authorized_egress_cidrs,
         advertised_ssid, merchant_vpa, merchant_display_name, is_active, is_open
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), $10, true)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         authorized_egress_cidrs = EXCLUDED.authorized_egress_cidrs,
         advertised_ssid = EXCLUDED.advertised_ssid,
         merchant_vpa = EXCLUDED.merchant_vpa,
         merchant_display_name = EXCLUDED.merchant_display_name,
         is_active = EXCLUDED.is_active`,
      [
        row.store_id,
        row.name,
        row.address,
        hasCoords ? Number(row.latitude) : null,
        hasCoords ? Number(row.longitude) : null,
        cidrs,
        row.ssid || 'SnapUp-Guest',
        row.merchant_vpa || '',
        row.merchant_display_name || '',
        row.is_active !== 'false',
      ]
    );
  }

  // Ids from a sheet are inserted explicitly, and an explicit insert does not advance the
  // sequence the console mints ids from. Left unsynced, the first shop registered through
  // signup collides on store_1 and fails with a primary-key violation that looks nothing
  // like its cause. Only ever moves the sequence forward.
  await sql(
    `SELECT setval('store_id_seq', GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '[^0-9]', '', 'g'), '')::bigint), 0) FROM stores), 1))`
  );

  console.log(`  stores: ${rows.length} rows imported or updated`);

  // Both of these produce a branch that is switched on and unusable, which looks exactly
  // like a bug from the shop floor. Naming them here turns a support call into a checklist.
  const noNetwork = rows.filter((r) => !r.egress_cidr).map((r) => r.store_id);
  if (noNetwork.length > 0) {
    console.log(`\n  WARNING: no egress_cidr for ${noNetwork.join(', ')}.`);
    console.log('  Those branches refuse every shopper until their customer-Wi-Fi public IP');
    console.log('  is registered. That is fail-closed behaviour, not a fault.');
  }

  const noVpa = rows.filter((r) => !r.merchant_vpa).map((r) => r.store_id);
  if (noVpa.length > 0) {
    console.log(`\n  WARNING: no merchant_vpa for ${noVpa.join(', ')}.`);
    console.log('  Money cannot reach the shop without it: in-app UPI is unavailable and');
    console.log('  checkout falls back to paying at the counter.');
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Section 8's "explicitly approved stock-take/import mode". It is a flag rather than a
  // config value because it has to be a decision someone takes on the day, for one sheet.
  const stockTake = args.includes('--stock-take');

  // Who moved the stock. A script has no signed-in user, so it is asked for and only
  // guessed at as a last resort - an audit row reading "unknown" is worth less than one
  // reading a name, and --actor is how it gets one.
  const actorArg = args.find((a) => a.startsWith('--actor='));
  const actor =
    actorArg?.slice('--actor='.length).trim() ||
    process.env.SNAPUP_IMPORT_ACTOR?.trim() ||
    process.env.USER ||
    process.env.USERNAME ||
    'unattributed-import';

  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: npm run db:import -- <products.csv> [stores.csv] [--stock-take] [--actor=name]\n');
    console.error('Templates are in data/. Copy them, fill them in, and pass the copies.');
    console.error('');
    console.error('  stock in the sheet is ADDED to the shelf count by default.');
    console.error('  --stock-take  treats it as an absolute count instead, replacing what is there.');
    console.error('  --actor=name  names who moved the stock, for the audit row.');
    process.exit(1);
  }

  // Said out loud before anything is written. A stock-take discards counts, and the
  // difference between the two modes is invisible once the import has finished.
  if (stockTake) {
    console.log('MODE: stock-take - the sheet REPLACES shelf counts rather than adding to them.');
  } else {
    console.log('MODE: increase - the sheet is a delivery, ADDED to the shelf counts.');
    console.log('      Pass --stock-take to declare absolute counts instead.');
  }
  console.log(`Stock movements recorded against "${actor}".\n`);

  const sql = await connect(process.env.DATABASE_URL ?? DEFAULT_URL);
  console.log('Importing…\n');

  // Classify everything first, then import in dependency order. Products carry a foreign
  // key to stores, so a products-first argument order fails on a constraint that is
  // entirely correct — and "pass the files in the right order" is a rule nobody should
  // have to remember at eleven at night before a pilot.
  const classified = [];
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    const header = (await readFile(path, 'utf8')).split(String.fromCharCode(10))[0].toLowerCase();

    // Detected from the header rather than the filename, so a sheet called
    // `kurinji-final-v3.csv` still imports as whatever it actually contains.
    if (header.includes('barcode')) classified.push({ kind: 'products', path });
    else if (header.includes('store_id')) classified.push({ kind: 'stores', path });
    else {
      throw new Error(
        `${file}: cannot tell what this is. A product sheet needs a "barcode" column and a ` +
          'store sheet needs a "store_id" column.'
      );
    }
  }

  for (const entry of classified.filter((f) => f.kind === 'stores')) {
    await importStores(sql, entry.path);
  }
  for (const entry of classified.filter((f) => f.kind === 'products')) {
    await importProducts(sql, entry.path, { stockTake, actor, source: entry.path });
  }

  if (stockAuditSkipped > 0) {
    console.log(`\n  NOTE: ${stockAuditSkipped} stock movement(s) were not audited.`);
    console.log('  stock_imports/outbox are in schema.sql and not yet applied here, so those');
    console.log('  movements reached the shelf count but not the log the 30-minute sync reads.');
    console.log('  Run npm run db:migrate to close that gap.');
  }

  const counts = await sql(
    `SELECT (SELECT count(*)::int FROM products) AS products,
            (SELECT count(*)::int FROM stores) AS stores`
  );
  console.log(`\nDatabase now holds ${counts[0].products} products across ${counts[0].stores} stores.`);
}

main()
  .catch((error) => {
    console.error('\nImport failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => {});
    releaseLock();
  });
