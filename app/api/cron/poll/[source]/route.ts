import { NextRequest, NextResponse } from 'next/server';
import { getConnector } from '@/lib/connectors';
import type { SourceId } from '@/types';

// POST /api/cron/poll/x — runs a single connector. In MVP this is a no-op
// because mock connectors don't mutate the store. Wired here so prod cron
// jobs (Vercel Cron / external scheduler) have a stable URL.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params;
  const valid: SourceId[] = ['x', 'reddit', 'youtube', 'tiktok', 'google_trends', 'news', 'custom'];
  if (!valid.includes(source as SourceId)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const connector = getConnector(source as SourceId);
  if (!connector) {
    return NextResponse.json({ error: 'connector_unconfigured', source }, { status: 503 });
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const result = await connector.poll({ since, limit: 50 });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, mode: result.mode }, { status: 502 });
  }
  return NextResponse.json({
    source,
    mode: result.mode,
    fetchedAt: result.fetchedAt.toISOString(),
    signalCount: result.signals.length,
  });
}
