import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ingestForBrand } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Cron deadline is 60s for free tier; 5min for paid.
export const maxDuration = 60;

// Serverless-safe ingest cron entrypoint. Vercel's cron config in
// vercel.json hits this every 2 min. Ping it manually with curl in dev
// or self-host setups where the in-process cron isn't running.
//
// Auth model:
//   1. Vercel Cron sends an `Authorization: Bearer <CRON_SECRET>` header
//      automatically when CRON_SECRET is set in the project. We accept it.
//   2. Self-host: set TJ_CRON_TOKEN and call with `?token=<value>`.
//   3. Open access only when both env vars are unset (dev convenience).

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  const vercelSecret = process.env.CRON_SECRET;
  const tjToken      = process.env.TJ_CRON_TOKEN;
  if (vercelSecret) {
    const got = req.headers.get('authorization');
    if (got !== `Bearer ${vercelSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else if (tjToken) {
    const got = req.nextUrl.searchParams.get('token');
    if (got !== tjToken) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const t0 = Date.now();
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  let totalInserted = 0, totalUpdated = 0;
  const bySource: Record<string, number> = {};
  const errors: string[] = [];

  for (const b of brands) {
    try {
      const r = await ingestForBrand(b.id);
      totalInserted += r.inserted;
      totalUpdated += r.updated;
      for (const [k, v] of Object.entries(r.bySource)) {
        bySource[k] = (bySource[k] ?? 0) + v;
      }
      errors.push(...r.errors.map(e => `${b.name}: ${e}`));
    } catch (e) {
      errors.push(`${b.name}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    brands: brands.length,
    inserted: totalInserted,
    updated: totalUpdated,
    bySource,
    errors,
    durationMs: Date.now() - t0,
  });
}
