import { type NextRequest } from 'next/server';
import { forwardAuth, readJson } from '@/server/authProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return forwardAuth(request, `/api/staff/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: (await readJson(request)) ?? {},
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return forwardAuth(request, `/api/staff/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
