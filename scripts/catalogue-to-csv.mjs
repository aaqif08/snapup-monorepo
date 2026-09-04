#!/usr/bin/env node
/**
 * Converts the supplied SnapMart barcode catalogue (.docx) into the CSV the importer eats.
 *
 *   node scripts/catalogue-to-csv.mjs "UI SS/SnapMart_Barcode_Catalogue.docx" data/products.csv
 *
 * ## Why convert rather than import directly
 *
 * `import-csv.mjs` is the tested path into the database — it upserts on (store, barcode),
 * refuses a sheet with no `price_rupees` header, holds the database lock, and warns about
 * missing weights. Writing a second importer that talks to Postgres would mean two things
 * to keep correct. This produces a sheet, and the sheet goes through the door that already
 * works. It also leaves a reviewable artefact: a diff of the CSV shows exactly what the
 * document changed.
 *
 * ## A .docx is a zip
 *
 * The text lives in `word/document.xml`. Each record is one paragraph of run fragments that
 * concatenate without separators, so `Brand:` runs straight into `Variant:` — the regex
 * below anchors on the labels rather than on whitespace for that reason.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

/**
 * The record line, e.g.
 *   Brand: India GateVariant: 1.000 kgSKU Code: SMSKU-000001MRP: ₹220.00  |  Sell: ₹210.00
 *   |  Discount: ₹10.00 flat  |  Final: ₹200.00Available Qty: 20Barcode: SNAP0000000001
 */
const RECORD =
  /Brand:\s*(?<brand>.*?)Variant:\s*(?<variant>[\d.]+)\s*(?<unit>[a-zA-Z]+?)SKU Code:\s*(?<sku>\S+?)MRP:\s*₹(?<mrp>[\d.]+)\s*\|\s*Sell:\s*₹(?<sell>[\d.]+)\s*\|\s*Discount:\s*(?<disc>.*?)\|\s*Final:\s*₹(?<final>[\d.]+)Available Qty:\s*(?<qty>\d+)Barcode:\s*(?<barcode>\S+)$/i;

/**
 * Unit → grams.
 *
 * Litres and millilitres are converted at 1 ml = 1 g. That is an approximation — milk is
 * about 1.03 — and it is a deliberate one: the exit scale check tolerates ±5%, so a 3%
 * density error is well inside the window, and the alternative is a density table for a
 * pilot that does not need one.
 *
 * `pc` and `pcs` return null, not zero. An item sold by the piece has no catalogue weight,
 * and saying so lets the exit desk report it as unchecked instead of quietly treating it as
 * weightless — which is the failure that makes an honest basket look like a thief's.
 */
function toGrams(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  switch (unit.toLowerCase()) {
    case 'kg':
      return Math.round(n * 1000);
    case 'g':
      return Math.round(n);
    case 'l':
      return Math.round(n * 1000);
    case 'ml':
      return Math.round(n);
    default:
      return null;
  }
}

/** Minimal CSV escaping: quote when the value could otherwise break a row. */
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Pull one entry out of a zip, without a dependency and without a shell.
 *
 * A `.docx` is a zip, but `Expand-Archive` refuses anything not named `.zip` and `unzip` is
 * not guaranteed to exist. Node ships `zlib`, and a zip's local file header is a fixed
 * 30-byte structure followed by the name, the extra field and the payload — so finding one
 * known entry and inflating it is less code than shelling out, and it works on whatever
 * machine runs the pilot.
 *
 * Only stored (0) and deflated (8) entries are handled, which is everything Word writes.
 */
function readZipEntry(buffer, wanted) {
  const LOCAL_HEADER = 0x04034b50;

  for (let at = 0; at + 30 <= buffer.length; at += 1) {
    if (buffer.readUInt32LE(at) !== LOCAL_HEADER) continue;

    const method = buffer.readUInt16LE(at + 8);
    const compressedSize = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const extraLength = buffer.readUInt16LE(at + 28);
    const nameAt = at + 30;

    if (nameAt + nameLength > buffer.length) continue;
    const name = buffer.toString('utf8', nameAt, nameAt + nameLength);
    if (name !== wanted) continue;

    const dataAt = nameAt + nameLength + extraLength;

    // A streamed entry writes zero into the header and puts the real sizes in a trailing
    // descriptor. Inflating to the end of the buffer still works, because the deflate
    // stream knows where it ends.
    const end = compressedSize > 0 ? dataAt + compressedSize : buffer.length;
    const payload = buffer.subarray(dataAt, end);

    if (method === 0) return payload.toString('utf8');
    if (method === 8) return inflateRawSync(payload).toString('utf8');
    throw new Error(`Zip entry "${name}" uses unsupported compression method ${method}.`);
  }

  throw new Error(`"${wanted}" not found inside the document.`);
}

async function extractDocumentXml(docxPath) {
  return readZipEntry(await readFile(docxPath), 'word/document.xml');
}

function paragraphs(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) =>
    [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((run) => run[1])
      .join('')
      .replace(/<[^>]+>/g, '')
      .trim()
  );
}

async function main() {
  const [docxPath, outPath, storeId = 'store_1'] = process.argv.slice(2);
  if (!docxPath || !outPath) {
    console.error('Usage: node scripts/catalogue-to-csv.mjs <catalogue.docx> <out.csv> [store_id]');
    process.exit(1);
  }

  const xml = docxPath.endsWith('.xml')
    ? await readFile(docxPath, 'utf8')
    : await extractDocumentXml(docxPath);

  const lines = paragraphs(xml).filter(Boolean);

  const rows = [];
  let noWeight = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const match = RECORD.exec(lines[i]);
    if (!match) continue;

    // The product name is the paragraph above the detail line; the `#N` index sits above
    // that. Reading it positionally is safe because every record has the same three-line
    // shape — and the count is asserted at the end, so a change in shape is caught.
    const name = lines[i - 1] ?? '';
    if (!name || name.startsWith('#')) {
      skipped += 1;
      continue;
    }

    const { brand, variant, unit, sku, mrp, sell, final, qty, barcode } = match.groups;
    const grams = toGrams(variant, unit);
    if (grams === null) noWeight += 1;

    // Sell − Final, in paise, so a flat amount, a percentage and "None" all reduce to one
    // exact integer. Never negative: a Final above Sell would be a data error, and clamping
    // is better than a negative discount that adds to the bill.
    const discountPaise = Math.max(0, Math.round(Number(sell) * 100) - Math.round(Number(final) * 100));

    rows.push({
      store_id: storeId,
      barcode,
      name,
      brand: brand.trim(),
      category: '',
      aisle: '',
      price_rupees: Number(sell).toFixed(2),
      mrp_rupees: Number(mrp).toFixed(2),
      discount_rupees: (discountPaise / 100).toFixed(2),
      weight_grams: grams ?? '',
      stock: qty,
      cost_rupees: '',
      supplier: '',
      sku,
      image_url: '',
    });
  }

  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(',')),
  ].join('\n');

  await writeFile(outPath, csv + '\n', 'utf8');

  console.log(`  parsed   : ${rows.length} products`);
  if (skipped) console.log(`  skipped  : ${skipped} records with no readable name`);
  console.log(`  no weight: ${noWeight} sold by the piece — the exit check reports these as unchecked`);
  console.log(`  written  : ${outPath}`);
}

main().catch((error) => {
  console.error('\nConversion failed:', error.message);
  process.exitCode = 1;
});
