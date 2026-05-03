// Server-side ingest cron. Boots once per Node process and runs every
// 90 seconds for every brand in the DB. The first run kicks off ~15s
// after boot to avoid stampeding all connectors at startup.
//
// 90s cadence is a deliberate trade-off — fast enough that the dashboard
// feels alive (you'll see something change within ~2 min of opening it)
// without hammering free public endpoints (Reddit, HN, GoogleNews) past
// their soft rate limits.
//
// In production, run this from a worker process (workers/cron.ts) or a
// scheduled Vercel Cron. In dev, importing this module from the dashboard
// layout is enough — Next.js shares the Node process across requests, so
// the timer survives.

import 'server-only';
import { prisma } from './db';
import { ingestForBrand } from './ingest';

const TICK_MS = 90 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __tj_cron_started: boolean | undefined;
  // eslint-disable-next-line no-var
  var __tj_cron_lastRunAt: Date | undefined;
  // eslint-disable-next-line no-var
  var __tj_cron_lastResult: { inserted: number; updated: number; bySource: Record<string, number>; errors: string[] } | null | undefined;
}

export function startIngestCron() {
  if (global.__tj_cron_started) return;
  global.__tj_cron_started = true;

  console.log('[ingest-cron] started — first tick in 15s, then every 90s');

  setTimeout(runOnce, 15_000);
  setInterval(runOnce, TICK_MS);
}

export function getCronStatus() {
  return {
    started: !!global.__tj_cron_started,
    lastRunAt: global.__tj_cron_lastRunAt?.toISOString() ?? null,
    lastResult: global.__tj_cron_lastResult ?? null,
  };
}

async function runOnce() {
  try {
    const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
    let totalInserted = 0;
    let totalUpdated = 0;
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
    global.__tj_cron_lastRunAt = new Date();
    global.__tj_cron_lastResult = { inserted: totalInserted, updated: totalUpdated, bySource, errors };
    console.log(`[ingest-cron] tick · ${brands.length} brand(s) · +${totalInserted} new · ↻${totalUpdated} updated`);
  } catch (e) {
    console.error('[ingest-cron] failed', e);
  }
}
