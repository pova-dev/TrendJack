// Standalone cron worker. Run with `pnpm worker` (or `npm run worker`).
// In production, replace this with a managed scheduler (Vercel Cron, BullMQ).
//
// What it does: posts to /api/cron/poll/[source] on the configured cadence.
// Each poll endpoint runs the connector for that source and ingests new
// signals. Mock connectors are no-ops; live connectors mutate the store.

import cron from 'node-cron';

const BASE = process.env.TRENDJACK_BASE_URL ?? 'http://localhost:3000';

async function poll(source: string) {
  try {
    const res = await fetch(`${BASE}/api/cron/poll/${source}`, { method: 'POST' });
    const json = await res.json();
    console.log(`[poll:${source}] ok=${res.ok}`, json);
  } catch (e) {
    console.error(`[poll:${source}] error`, e);
  }
}

// Tiered cadences chosen for half-life realities of each platform.
cron.schedule('* * * * *',           () => poll('x'));            // 60s
cron.schedule('*/5 * * * *',         () => poll('reddit'));       // 5m
cron.schedule('*/5 * * * *',         () => poll('news'));         // 5m
cron.schedule('*/15 * * * *',        () => poll('tiktok'));       // 15m
cron.schedule('*/30 * * * *',        () => poll('youtube'));      // 30m
cron.schedule('0 * * * *',           () => poll('google_trends'));// 60m

console.log('[trendjack] worker started — tiered polling active');
