import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { calibrationSnapshot } from '@/src/agents/calibration';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/calibration/snapshot — returns the per-(axis × bucket) bucket
// table for the operator's brand. Used by the Brand-page Calibration
// Panel so operators can see what the system has learned from their
// behavior.

export async function GET() {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const buckets = calibrationSnapshot(auth.brand.id);
  // Sample count = total events for this brand
  const totalEvents = await prisma.feedbackEvent.count({ where: { brandId: auth.brand.id } });
  const negativeEvents = await prisma.feedbackEvent.count({ where: { brandId: auth.brand.id, polarity: -1 } });
  const positiveEvents = await prisma.feedbackEvent.count({ where: { brandId: auth.brand.id, polarity: 1 } });

  // Round each multiplier to 2 dp for display
  return NextResponse.json({
    brandId: auth.brand.id,
    totalEvents,
    positiveEvents,
    negativeEvents,
    buckets,
  });
}
