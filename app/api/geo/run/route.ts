import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { runGeoTickForBrand } from '@/src/agents/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/geo/run — run a fresh GEO tick for the current brand.
// Premium-tier cost; budget-gated via runChat's per-org tracker.
// Operator-triggered (manual). The scheduled cadence path will land
// when Phase 2 ships a cron-tick runner.

export async function POST() {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runGeoTickForBrand(auth.brand.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
