import 'server-only';
import { db } from '../db/client';
import type { StoreDraft, StoreRecord, StoreRepository } from './types';

/**
 * The store registry, durable.
 *
 * This is the repository whose in-memory version was the most quietly dangerous. Products
 * and orders losing state is obvious the moment someone looks; a store registry losing
 * state means a network range an operator registered this morning is gone after a deploy,
 * and every shopper at that store is refused with `presence_not_verified` — a failure that
 * looks like a bug in presence verification rather than like missing data.
 *
 * `findById` is on the authentication hot path: every product request re-reads the store to
 * re-check its authorized ranges. That is deliberate — it means deactivating a store or
 * correcting its CIDR takes effect on sessions already in flight, instead of waiting up to
 * thirty minutes for them to expire. It also means one round trip per API call, which is
 * the obvious thing to cache. It is not cached here, and that is a considered omission:
 * caching store config would reintroduce exactly the staleness this design is buying, and
 * the correct fix is a short TTL with explicit invalidation on write rather than something
 * bolted on now and reasoned about later.
 */

/**
 * Postgres `text[]` interpolated without ambiguity.
 *
 * Passing a JavaScript array straight into the template relies on the driver's array
 * serialisation, which differs between drivers and silently produces a one-element array
 * containing a literal `{a,b}` string when it goes wrong. Round-tripping through jsonb has
 * one interpretation and no such failure mode.
 */
function textArray(values: string[]): string {
  return JSON.stringify(values);
}

/**
 * Reads a `text[]` column back defensively.
 *
 * The driver normally hands back a JavaScript array. The string branch covers a driver or
 * proxy that returns the raw Postgres array literal instead — cheap insurance against a
 * store's entire authorized network silently parsing as one nonsense entry, which fails
 * closed but would be baffling to debug.
 */
function readTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string') return [];

  const inner = value.replace(/^\{|\}$/g, '').trim();
  if (inner.length === 0) return [];
  return inner.split(',').map((entry) => entry.replace(/^"|"$/g, ''));
}

type StoreRow = Record<string, unknown>;

/**
 * A nullable coordinate column, read without inventing a value.
 *
 * `Number(null)` is `0`, which is the specific accident this guards against: an
 * unsurveyed branch would come back sitting at Null Island, 600 km off the coast of
 * Ghana, and sort roughly 2 000 km from every customer in Tamil Nadu while looking like
 * a perfectly well-formed reading. `NaN` is filtered for the same reason — a column
 * containing junk should read as "unknown", not as a coordinate that poisons the
 * haversine downstream.
 */
function readCoordinate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecord(row: StoreRow): StoreRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    address: row.address as string,
    latitude: readCoordinate(row.latitude),
    longitude: readCoordinate(row.longitude),
    authorizedEgressCidrs: readTextArray(row.authorized_egress_cidrs),
    advertisedSsid: row.advertised_ssid as string,
    merchantVpa: (row.merchant_vpa as string | null) ?? null,
    merchantDisplayName: (row.merchant_display_name as string | null) ?? null,
    apiBaseUrl: (row.api_base_url as string | null) ?? null,
    apiKeyRef: (row.api_key_ref as string | null) ?? null,
    isActive: row.is_active as boolean,
    isOpen: row.is_open as boolean,
  };
}

class PostgresStoreRepository implements StoreRepository {
  async findById(id: string): Promise<StoreRecord | null> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM stores WHERE id = ${id}
    `) as StoreRow[];

    // Returns inactive stores too. The auth path checks `isActive` itself, so that "this
    // store does not exist" and "this store is switched off" stay distinguishable in logs
    // rather than collapsing into one indistinguishable failure.
    return rows.length > 0 ? toRecord(rows[0]) : null;
  }

  async listActive(): Promise<StoreRecord[]> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM stores WHERE is_active = true ORDER BY created_at, id
    `) as StoreRow[];

    // Registration order, matching the in-memory insertion order the directory falls back
    // to when the customer has declined location access.
    return rows.map(toRecord);
  }

  async listAll(): Promise<StoreRecord[]> {
    const sql = db();
    const rows = (await sql`
      SELECT * FROM stores ORDER BY created_at, id
    `) as StoreRow[];
    return rows.map(toRecord);
  }

  async create(draft: StoreDraft): Promise<StoreRecord> {
    const sql = db();
    const rows = (await sql`
      INSERT INTO stores (
        id, name, address, latitude, longitude, authorized_egress_cidrs,
        advertised_ssid, merchant_vpa, merchant_display_name,
        api_base_url, api_key_ref, is_active, is_open
      ) VALUES (
        'store_' || nextval('store_id_seq'),
        ${draft.name},
        ${draft.address},
        ${draft.latitude},
        ${draft.longitude},
        ARRAY(SELECT jsonb_array_elements_text(${textArray(draft.authorizedEgressCidrs)}::jsonb)),
        ${draft.advertisedSsid},
        ${draft.merchantVpa},
        ${draft.merchantDisplayName},
        ${draft.apiBaseUrl},
        ${draft.apiKeyRef},
        ${draft.isActive},
        ${draft.isOpen}
      )
      RETURNING *
    `) as StoreRow[];

    return toRecord(rows[0]);
  }

  async update(id: string, patch: Partial<StoreDraft>): Promise<StoreRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    // Read-merge-write rather than a dynamically built SET clause.
    //
    // `Partial<StoreDraft>` distinguishes "absent, leave alone" from "present and null",
    // and `merchantVpa` genuinely takes null to mean "this shop has no UPI address yet".
    // A `COALESCE($1, column)` update cannot tell those apart and would make clearing a VPA
    // impossible. The cost is a lost-update window between the read and the write, which
    // two operators editing the same store in the same second could hit; the registry is
    // edited by hand at human pace, so that is an acceptable trade rather than an unnoticed
    // one.
    const merged: StoreRecord = {
      ...existing,
      ...patch,
      authorizedEgressCidrs: patch.authorizedEgressCidrs
        ? [...patch.authorizedEgressCidrs]
        : existing.authorizedEgressCidrs,
      id: existing.id,
    };

    const sql = db();
    const rows = (await sql`
      UPDATE stores SET
        name                    = ${merged.name},
        address                 = ${merged.address},
        latitude                = ${merged.latitude},
        longitude               = ${merged.longitude},
        authorized_egress_cidrs = ARRAY(SELECT jsonb_array_elements_text(${textArray(merged.authorizedEgressCidrs)}::jsonb)),
        advertised_ssid         = ${merged.advertisedSsid},
        merchant_vpa            = ${merged.merchantVpa},
        merchant_display_name   = ${merged.merchantDisplayName},
        api_base_url            = ${merged.apiBaseUrl},
        api_key_ref             = ${merged.apiKeyRef},
        is_active               = ${merged.isActive},
        is_open                 = ${merged.isOpen}
      WHERE id = ${id}
      RETURNING *
    `) as StoreRow[];

    return rows.length > 0 ? toRecord(rows[0]) : null;
  }
}

export const postgresStoreRepository: StoreRepository = new PostgresStoreRepository();
