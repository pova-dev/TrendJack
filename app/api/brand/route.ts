import { NextRequest, NextResponse } from 'next/server';
import { getBrand, updateBrand, logAudit, type BrandPatch } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';
import { publishBrandProfile, publishBrandWeights, publishBrandTrend } from '@/lib/realtime/bus';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export async function GET() {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const brand = await getBrand(ctx.brand.id);
  return NextResponse.json(brand);
}

export async function PUT(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('brand:edit'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.brand || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const patch = (await req.json()) as BrandPatch;

  const before = await getBrand(ctx.brand.id);
  const after = await updateBrand(ctx.brand.id, patch);

  const fields = Object.keys(patch);
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'brand.update', target: ctx.brand.id, meta: { fields } });

  publishBrandProfile(ctx.brand.id, {
    type: 'brand.profile_changed',
    brandId: ctx.brand.id,
    fields,
  });
  if ('scoringWeights' in patch) publishBrandWeights(ctx.brand.id);
  if ('crisisMode' in patch && before?.crisisMode !== after.crisisMode) {
    publishBrandProfile(ctx.brand.id, { type: 'brand.crisis_toggle', brandId: ctx.brand.id, on: after.crisisMode });
  }
  // Trends are rescored on profile change → tell the board to refetch.
  publishBrandTrend(ctx.brand.id, { type: 'trend.updated', brandId: ctx.brand.id, trendId: '*', reason: 'rescore' });

  return NextResponse.json(after);
}
