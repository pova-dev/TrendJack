import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { requireRole, ROLES_CAN_EDIT_BRAND, AuthorizationError } from '@/lib/auth/roles';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/calibration/reset — wipe the brand's bucket estimator and
// FeedbackEvent log. Operator-initiated nuclear option; logged in
// AuditLog for compliance. Only owner / admin can reset.

export async function POST() {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org || !auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    await requireRole(auth.org.id, auth.user.id, ROLES_CAN_EDIT_BRAND);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: 'forbidden', reason: err.reason }, { status: 403 });
    }
    throw err;
  }

  const [feedbackDeleted, bucketsDeleted] = await Promise.all([
    prisma.feedbackEvent.deleteMany({ where: { brandId: auth.brand.id } }),
    prisma.operatorFeedbackBucket.deleteMany({ where: { brandId: auth.brand.id } }),
  ]);
  await prisma.auditLog.create({
    data: {
      orgId: auth.org.id,
      userId: auth.user.id,
      action: 'calibration.reset',
      target: auth.brand.id,
      meta: JSON.stringify({ feedbackDeleted: feedbackDeleted.count, bucketsDeleted: bucketsDeleted.count }),
    },
  });
  return NextResponse.json({ ok: true, feedbackDeleted: feedbackDeleted.count, bucketsDeleted: bucketsDeleted.count });
}
