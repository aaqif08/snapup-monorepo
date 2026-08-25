import 'server-only';
import { STORE_API_TIMEOUT_MS } from './config';
import { platformConnection, type StoreApiConnection } from './connection';

/**
 * The single place SnapUp talks to the retailer's API.
 *
 * Everything about *how* we call them lives here — authentication, timeouts, retries and
 * error classification — so the repositories above it read as domain code rather than as
 * HTTP plumbing, and so a change to their auth scheme is one edit rather than four.
 */

export type StoreApiFailure =
  /** Our key was rejected. Not the customer's problem and never surfaced to them verbatim. */
  | 'unauthorized'
  /** The upstream genuinely has no such record. Distinct from an outage. */
  | 'not_found'
  /** We are being throttled by the retailer. */
  | 'rate_limited'
  /** Timeout, network failure, or 5xx. The retailer's system is unwell. */
  | 'unavailable'
  /** A 2xx whose body was not what the contract says it should be. */
  | 'bad_response'
  /** The upstream refused the write for a business reason, e.g. a duplicate barcode. */
  | 'conflict'
  /**
   * This branch has no resolvable endpoint or credential. Distinct from `unavailable`:
   * nothing is down, we were never told where to call or what to authenticate with, and
   * retrying will not help.
   */
  | 'not_configured';

export class StoreApiError extends Error {
  constructor(
    readonly failure: StoreApiFailure,
    readonly status: number | null,
    message: string,
    /** Upstream error code, when they supply one. Logged, never returned to a customer. */
    readonly upstreamCode?: string
  ) {
    super(message);
    this.name = 'StoreApiError';
  }
}

function classify(status: number): StoreApiFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

/**
 * Retried only where retrying is safe.
 *
 * A timed-out read can be repeated freely. A timed-out *write* cannot: the request may have
 * been applied and only the response lost, so retrying an order creation could book the
 * same basket twice. Writes therefore get one attempt and surface the failure, which is the
 * honest answer — "we do not know whether this landed" is information the caller needs, not
 * something to paper over with a retry.
 */
function isRetryable(failure: StoreApiFailure): boolean {
  return failure === 'unavailable' || failure === 'rate_limited';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
  /** Overrides the retry policy. Writes pass 1. */
  attempts?: number;
  query?: Record<string, string | number | undefined>;
  /**
   * Which branch's API to call. Omitted means the platform connection, which is what the
   * store registry uses and what a single-system retailer configures.
   *
   * Callers holding a `storeId` should resolve this via `connectionForStore` so a
   * branch running its own POS is reached at its own endpoint with its own credential.
   */
  connection?: StoreApiConnection | null;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Performs one authenticated call and returns the parsed body.
 *
 * Throws `StoreApiError` for everything that is not a successful, well-formed response, so
 * callers deal with one error type rather than with the union of fetch rejections, non-2xx
 * statuses and JSON parse failures.
 */
export async function storeApiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;
  const maxAttempts = options.attempts ?? (method === 'GET' ? 2 : 1);

  // `undefined` means "caller did not specify, use the platform connection"; an explicit
  // `null` means "caller tried to resolve one for this branch and could not", which is a
  // configuration error rather than a default worth silently filling in.
  const connection = options.connection === undefined ? platformConnection() : options.connection;
  if (!connection) {
    throw new StoreApiError(
      'not_configured',
      null,
      `Store API ${method} ${path} has no resolvable endpoint or credential for this store.`
    );
  }

  let lastError: StoreApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A fresh signal per attempt: an AbortSignal that has already fired stays fired, so
    // reusing one would make every retry abort instantly.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STORE_API_TIMEOUT_MS);

    try {
      const response = await fetch(buildUrl(connection.baseUrl, path, query), {
        method,
        signal: controller.signal,
        headers: {
          // Sent as a bearer credential. If the retailer expects a different scheme —
          // `X-Api-Key`, a query parameter, a signed header — this is the only line that
          // changes.
          authorization: `Bearer ${connection.key}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Never let Next.js cache an upstream response implicitly. Catalogue and order data
        // are scoped to a store and a session; a shared framework cache is the wrong place
        // to make that decision, and the explicit caches in this layer are auditable.
        cache: 'no-store',
      });

      if (!response.ok) {
        const failure = classify(response.status);
        const detail = await response.text().catch(() => '');
        lastError = new StoreApiError(
          failure,
          response.status,
          `Store API ${method} ${path} failed with ${response.status}.`,
          detail.slice(0, 200)
        );

        if (isRetryable(failure) && attempt < maxAttempts) continue;
        throw lastError;
      }

      // 204, or a body-less 200 on a write.
      if (response.status === 204) return undefined as T;

      const text = await response.text();
      if (text.length === 0) return undefined as T;

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new StoreApiError(
          'bad_response',
          response.status,
          `Store API ${method} ${path} returned a 2xx that was not JSON.`
        );
      }
    } catch (error) {
      if (error instanceof StoreApiError) {
        // Already classified above, and already decided not to retry.
        if (!isRetryable(error.failure) || attempt >= maxAttempts) throw error;
        lastError = error;
        continue;
      }

      // Abort (timeout) or a transport-level failure.
      const isAbort = error instanceof Error && error.name === 'AbortError';
      lastError = new StoreApiError(
        'unavailable',
        null,
        isAbort
          ? `Store API ${method} ${path} timed out after ${STORE_API_TIMEOUT_MS}ms.`
          : `Store API ${method} ${path} could not be reached: ${(error as Error).message}`
      );

      if (attempt >= maxAttempts) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new StoreApiError('unavailable', null, `Store API ${method} ${path} failed.`);
}

/**
 * For reads where "the record does not exist" is an ordinary answer rather than an error —
 * a barcode that is not in the catalogue, a store id that was never registered.
 *
 * Deliberately narrow: only `not_found` becomes null. An outage must **not** be collapsed
 * into "no such product", because that is how a failed upstream turns into a customer being
 * told an item does not exist and a shop appearing to have an empty catalogue.
 */
export async function storeApiFind<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T | null> {
  try {
    return await storeApiRequest<T>(path, options);
  } catch (error) {
    if (error instanceof StoreApiError && error.failure === 'not_found') return null;
    throw error;
  }
}
