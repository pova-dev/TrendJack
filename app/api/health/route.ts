import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCronStatus } from '@/lib/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Liveness + readiness probe. Returns 200 only when the DB is reachable.
// Cron status is included as informational metadata — useful for ops
// dashboards but doesn't affect the HTTP code (cron may not have started
// its first tick yet on a fresh boot).
export async function GET() {
  const t0 = Date.now();
  try {
    // Cheap query — confirms the Prisma client + database file are alive.
    await prisma.$queryRaw`SELECT 1`;
    const cron = getCronStatus();
    return NextResponse.json({
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      dbLatencyMs: Date.now() - t0,
      cron: {
        started: cron.started,
        lastRunAt: cron.lastRunAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 503 },
    );
  }
}
