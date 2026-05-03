import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { ingestForBrand } from '@/lib/ingest';
import { logAudit } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/refresh — pull fresh signals for the active brand from every
// available live connector, score, dedupe, persist, broadcast via SSE.
export async function POST() {
  const ctx = await getCurrentContext();
  if (!ctx?.brand || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const out = await ingestForBrand(ctx.brand.id, ctx.org.id);
    await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'refresh.run', target: ctx.brand.id, meta: out });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
