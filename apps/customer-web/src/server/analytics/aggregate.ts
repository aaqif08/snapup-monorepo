import 'server-only';
import type { StoreEvent } from './types';

/**
 * The read model behind the store dashboard.
 *
 * Every field here is computed from real recorded events. Where a number cannot honestly
 * be produced yet it is `null` rather than zero, and the dashboard says so — a zero and an
 * "unknown" look identical on a tile but mean opposite things to an owner deciding
 * staffing. The previous admin dashboard was removed for showing invented figures; this
 * one must not reintroduce them under a nicer name.
 */

export interface TopProduct {
  productId: string;
  name: string;
  /** Distinct server-side lookups. See the note on `productsScanned`. */
  scans: number;
  unitsSold: number;
  revenuePaise: number;
}

export interface AisleTraffic {
  aisle: string;
  scans: number;
  /** Sessions with at least one scan in this aisle — footfall, not scan volume. */
  sessions: number;
}

export interface HourBucket {
  /** 0-23, store-local. */
  hour: number;
  scans: number;
  sessionsStarted: number;
  ordersPlaced: number;
  revenuePaise: number;
}

export interface DayBucket {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  ordersPlaced: number;
  revenuePaise: number;
  grossProfitPaise: number;
}

export interface MissedScan {
  barcode: string;
  attempts: number;
  sessions: number;
}

export interface StoreAnalytics {
  storeId: string;
  window: { fromMs: number; toMs: number };

  /**
   * Distinct product lookups that reached the server.
   *
   * Named precisely because the client caches lookups for 5 minutes (see `productCache` in
   * lib/api.ts), so a customer scanning three identical yoghurts produces one event, not
   * three. This is the honest count of "items customers looked at". For "how many units
   * left the shop", use `unitsSold`, which comes from priced order lines.
   */
  productsScanned: number;
  unitsSold: number;

  sessionsStarted: number;
  sessionsCompleted: number;
  /** Sessions that reached a paid order, over sessions started. Null before any session. */
  conversionRatePct: number | null;

  /** Null until at least one session has both a start and an end in the window. */
  averageShoppingMinutes: number | null;
  /** Median resists the long tail of a shopper who forgot to close the app. */
  medianShoppingMinutes: number | null;
  completedSessionSampleSize: number;

  topProducts: TopProduct[];
  aisleTraffic: AisleTraffic[];
  hourly: HourBucket[];
  daily: DayBucket[];
  missedScans: MissedScan[];

  revenue: {
    grossPaise: number;
    /** Gross minus cost of goods. Available because cost_price is already on the product. */
    grossProfitPaise: number;
    ordersPlaced: number;
    averageOrderValuePaise: number | null;
    /** What SnapUp invoices the merchant for this window, under the phase-1 model. */
    platformFeePaise: number;
  };
}

/**
 * Sessions that started inside the window but never ended inside it are excluded from
 * duration stats rather than being counted as zero or clamped to the window edge. A
 * customer still shopping at the cut-off has no duration yet; inventing one would drag the
 * average down exactly when the store is busiest, which is when the number gets used.
 */
export function aggregate(
  storeId: string,
  events: StoreEvent[],
  window: { fromMs: number; toMs: number },
  platformFeePaisePerOrder: number
): StoreAnalytics {
  const sessionStartedAt = new Map<string, number>();
  const sessionDurationsSec: number[] = [];
  const convertedSessions = new Set<string>();

  let productsScanned = 0;
  let unitsSold = 0;
  let sessionsStarted = 0;
  let sessionsCompleted = 0;
  let grossPaise = 0;
  let costPaise = 0;
  let ordersPlaced = 0;

  const products = new Map<string, TopProduct>();
  const aisles = new Map<string, { scans: number; sessions: Set<string> }>();
  const missed = new Map<string, { attempts: number; sessions: Set<string> }>();
  const hours = new Map<number, HourBucket>();
  const days = new Map<string, DayBucket>();

  const hourBucket = (at: number) => {
    const hour = new Date(at).getHours();
    let bucket = hours.get(hour);
    if (!bucket) {
      bucket = { hour, scans: 0, sessionsStarted: 0, ordersPlaced: 0, revenuePaise: 0 };
      hours.set(hour, bucket);
    }
    return bucket;
  };

  const dayBucket = (at: number) => {
    const date = toIsoDate(at);
    let bucket = days.get(date);
    if (!bucket) {
      bucket = { date, ordersPlaced: 0, revenuePaise: 0, grossProfitPaise: 0 };
      days.set(date, bucket);
    }
    return bucket;
  };

  for (const event of events) {
    switch (event.kind) {
      case 'session_started': {
        sessionsStarted += 1;
        sessionStartedAt.set(event.sessionId, event.occurredAt);
        hourBucket(event.occurredAt).sessionsStarted += 1;
        break;
      }

      case 'session_ended': {
        sessionsCompleted += 1;
        const startedAt = sessionStartedAt.get(event.sessionId);
        if (startedAt !== undefined) {
          sessionDurationsSec.push(Math.max(0, Math.round((event.occurredAt - startedAt) / 1000)));
        }
        break;
      }

      case 'product_scanned': {
        productsScanned += 1;
        hourBucket(event.occurredAt).scans += 1;

        if (event.productId) {
          const entry = products.get(event.productId) ?? {
            productId: event.productId,
            name: event.productName ?? event.productId,
            scans: 0,
            unitsSold: 0,
            revenuePaise: 0,
          };
          entry.scans += 1;
          products.set(event.productId, entry);
        }

        if (event.aisle) {
          const entry = aisles.get(event.aisle) ?? { scans: 0, sessions: new Set<string>() };
          entry.scans += 1;
          entry.sessions.add(event.sessionId);
          aisles.set(event.aisle, entry);
        }
        break;
      }

      case 'scan_missed': {
        if (event.barcode) {
          const entry = missed.get(event.barcode) ?? { attempts: 0, sessions: new Set<string>() };
          entry.attempts += 1;
          entry.sessions.add(event.sessionId);
          missed.set(event.barcode, entry);
        }
        break;
      }

      case 'order_placed': {
        ordersPlaced += 1;
        grossPaise += event.grossPaise ?? 0;
        costPaise += event.costPaise ?? 0;
        unitsSold += event.itemCount ?? 0;
        convertedSessions.add(event.sessionId);

        const hour = hourBucket(event.occurredAt);
        hour.ordersPlaced += 1;
        hour.revenuePaise += event.grossPaise ?? 0;

        const day = dayBucket(event.occurredAt);
        day.ordersPlaced += 1;
        day.revenuePaise += event.grossPaise ?? 0;
        day.grossProfitPaise += (event.grossPaise ?? 0) - (event.costPaise ?? 0);

        // Order lines ride on the event so the read model never has to join back to the
        // orders table for the top-products panel.
        for (const line of event.lines ?? []) {
          const entry = products.get(line.productId) ?? {
            productId: line.productId,
            name: line.name,
            scans: 0,
            unitsSold: 0,
            revenuePaise: 0,
          };
          entry.name = line.name;
          entry.unitsSold += line.quantity;
          entry.revenuePaise += line.linePaise;
          products.set(line.productId, entry);
        }
        break;
      }
    }
  }

  return {
    storeId,
    window,
    productsScanned,
    unitsSold,
    sessionsStarted,
    sessionsCompleted,
    conversionRatePct:
      sessionsStarted > 0
        ? Math.round((convertedSessions.size / sessionsStarted) * 1000) / 10
        : null,
    averageShoppingMinutes: toMinutes(mean(sessionDurationsSec)),
    medianShoppingMinutes: toMinutes(median(sessionDurationsSec)),
    completedSessionSampleSize: sessionDurationsSec.length,

    // Ranked by revenue, not scan count: the twenty items customers pick up most are
    // interesting, but the twenty that pay the rent are what a buyer reorders on.
    topProducts: [...products.values()]
      .sort((a, b) => b.revenuePaise - a.revenuePaise || b.scans - a.scans)
      .slice(0, 20),

    aisleTraffic: [...aisles.entries()]
      .map(([aisle, entry]) => ({ aisle, scans: entry.scans, sessions: entry.sessions.size }))
      .sort((a, b) => b.sessions - a.sessions || b.scans - a.scans),

    hourly: [...hours.values()].sort((a, b) => a.hour - b.hour),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),

    missedScans: [...missed.entries()]
      .map(([barcode, entry]) => ({
        barcode,
        attempts: entry.attempts,
        sessions: entry.sessions.size,
      }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 10),

    revenue: {
      grossPaise,
      grossProfitPaise: grossPaise - costPaise,
      ordersPlaced,
      averageOrderValuePaise: ordersPlaced > 0 ? Math.round(grossPaise / ordersPlaced) : null,
      platformFeePaise: ordersPlaced * platformFeePaisePerOrder,
    },
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toMinutes(seconds: number | null): number | null {
  return seconds === null ? null : Math.round((seconds / 60) * 10) / 10;
}

function toIsoDate(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
