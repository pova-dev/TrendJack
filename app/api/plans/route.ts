import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/plans?status=pending_approval&limit=20 — list Ship-It Plans
// for the operator's brand. Operator-visible Plans column reads this.

export async function GET(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') ?? undefined;
  const limit = Math.max(1, Math.min(100, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10) || 20));

  const where: Record<string, unknown> = { brandId: auth.brand.id };
  if (status) where.status = status;

  const plans = await prisma.shipItPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return NextResponse.json({
    plans: plans.map(p => ({
      id: p.id,
      trendId: p.trendId,
      status: p.status,
      chosenAngleRef: p.chosenAngleRef,
      payload: JSON.parse(p.payload),
      proposedScheduleAt: p.proposedScheduleAt,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt,
      decidedAt: p.decidedAt,
    })),
  });
}
