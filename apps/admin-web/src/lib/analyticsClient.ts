'use client';

/**
 * Browser-side client for the store analytics read model.
 *
 * Calls this app's own `/api/analytics` proxy, so no credential is needed here — the same
 * arrangement as `storesClient.ts`.
 */

export type AnalyticsWindow = 'today' | '7d' | '30d';

export interface TopProduct {
  productId: string;
  name: string;
  scans: number;
  unitsSold: number;
  revenuePaise: number;
}

export interface AisleTraffic {
  aisle: string;
  scans: number;
  sessions: number;
}

export interface HourBucket {
  hour: number;
  scans: number;
  sessionsStarted: number;
  ordersPlaced: number;
  revenuePaise: number;
}

export interface DayBucket {
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
  productsScanned: number;
  unitsSold: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  conversionRatePct: number | null;
  averageShoppingMinutes: number | null;
  medianShoppingMinutes: number | null;
  completedSessionSampleSize: number;
  topProducts: TopProduct[];
  aisleTraffic: AisleTraffic[];
  hourly: HourBucket[];
  daily: DayBucket[];
  missedScans: MissedScan[];
  revenue: {
    grossPaise: number;
    grossProfitPaise: number;
    ordersPlaced: number;
    averageOrderValuePaise: number | null;
    platformFeePaise: number;
  };
}

export interface AnalyticsResponse {
  store: { id: string; name: string };
  window: AnalyticsWindow;
  analytics: StoreAnalytics;
  /** Epoch ms of the oldest retained event, or null when nothing has been recorded. */
  data_since: number | null;
}

export class AnalyticsError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

export async function fetchAnalytics(
  storeId: string,
  window: AnalyticsWindow
): Promise<AnalyticsResponse> {
  const query = new URLSearchParams({ store_id: storeId, window });
  const response = await fetch(`/api/analytics?${query}`, { cache: 'no-store' });

  if (!response.ok) {
    try {
      const body = await response.json();
      if (body?.error?.code) {
        throw new AnalyticsError(body.error.code, body.error.message, response.status);
      }
    } catch (parseError) {
      if (parseError instanceof AnalyticsError) throw parseError;
    }
    throw new AnalyticsError(
      'request_failed',
      `Could not load analytics (${response.status}).`,
      response.status
    );
  }

  return (await response.json()) as AnalyticsResponse;
}

/** Paise -> "₹1,234.50". Formatting lives here so every panel renders money identically. */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
