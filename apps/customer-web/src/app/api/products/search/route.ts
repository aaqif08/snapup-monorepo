import { NextResponse, type NextRequest } from 'next/server';
import { guardProductRequest } from '@/server/apiAuth';
import { productRepository, toPublicProduct } from '@/server/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 20;
/**
 * Hard ceiling on page_size. Without it, `?page_size=100000` is a bulk export endpoint
 * wearing a pagination costume — which Requirement 2 explicitly forbids.
 */
const MAX_PAGE_SIZE = 50;

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

/** Paginated, store-scoped, projected product search (R4). */
export async function GET(request: NextRequest) {
  const startedAt = performance.now();

  const guard = guardProductRequest(request);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const query = (params.get('q') ?? '').slice(0, 64);
  const page = parsePositiveInt(params.get('page'), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = parsePositiveInt(params.get('page_size'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const { items, meta } = await productRepository.search(guard.session.sid, query, page, pageSize);

  const lookupMs = Math.round((performance.now() - startedAt) * 100) / 100;

  return NextResponse.json(
    { items: items.map(toPublicProduct), page: meta, lookup_ms: lookupMs },
    {
      status: 200,
      headers: {
        'cache-control': 'private, max-age=30',
        'server-timing': `lookup;dur=${lookupMs}`,
      },
    }
  );
}
