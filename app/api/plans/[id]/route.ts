import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_APPROVE, AuthorizationError } from '@/lib/auth/roles';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/plans/[id] — fetch single plan
// PATCH /api/plans/[id] — approve | reject | ship | edit
//   body: { action: 'approve' | 'reject' | 'ship', reason? }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const plan = await prisma.shipItPlan.findUnique({ where: { id } });
  if (!plan || plan.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ...plan, payload: JSON.parse(plan.payload) });
}

interface PatchBody { action?: 'approve' | 'reject' | 'ship'; reason?: string; postUrl?: string }

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await requireRole(auth.org.id, auth.user.id, ROLES_CAN_APPROVE);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: 'forbidden', reason: err.reason }, { status: 403 });
    }
    throw err;
  }

  const { id } = await ctx.params;
  const data = (await req.json().catch(() => null)) as PatchBody | null;
  if (!data?.action) return NextResponse.json({ error: 'missing_action' }, { status: 400 });

  const plan = await prisma.shipItPlan.findUnique({ where: { id } });
  if (!plan || plan.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Expiry check on action — past peakWindowEnd, plan is unsalvageable.
  if (plan.expiresAt < new Date() && data.action !== 'reject') {
    await prisma.shipItPlan.update({
      where: { id },
      data: { status: 'expired' },
    });
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  const statusMap: Record<string, string> = {
    approve: 'approved',
    reject: 'rejected',
    ship: 'shipped',
  };
  const nextStatus = statusMap[data.action];
  if (!nextStatus) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const updated = await prisma.shipItPlan.update({
    where: { id },
    data: {
      status: nextStatus,
      decidedAt: new Date(),
      decidedBy: auth.user.id,
      decisionReason: (data.reason ?? '').slice(0, 500),
      ...(data.action === 'ship' && data.postUrl ? { shippedAt: new Date(), postUrl: data.postUrl } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: auth.org.id,
      userId: auth.user.id,
      action: `plan.${data.action}`,
      target: id,
      meta: JSON.stringify({ reason: data.reason }),
    },
  });

  return NextResponse.json({ ...updated, payload: JSON.parse(updated.payload) });
}
