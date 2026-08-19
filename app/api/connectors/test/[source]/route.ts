import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getConnector } from '@/lib/connectors';
import { getOrgCredentials } from '@/lib/credentials';
import { getBrand } from '@/lib/store';
import type { SourceId } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/connectors/test/[source] — invoke a single connector once and
// return the raw signal count + a sample of titles. Lets users verify a
// source is actually live before hitting the global Refresh button.

export async function POST(_req: Request, ctx: { params: Promise<{ source: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand || !auth.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { source } = await ctx.params;
  // Audit 2026-05-29 B4 — IG/FB were missing here even though the registry
  // exposes them. The TestButton on those rows now returns the unconfigured
  // state instead of "invalid_source".
  const valid: SourceId[] = ['x', 'reddit', 'youtube', 'tiktok', 'instagram', 'facebook', 'google_trends', 'news', 'custom'];
  if (!valid.includes(source as SourceId)) {
    return NextResponse.json({ error: 'invalid_source' }, { status: 400 });
  }
  const brand = await getBrand(auth.brand.id);
  if (!brand) return NextResponse.json({ error: 'brand_missing' }, { status: 400 });

  const credentials = await getOrgCredentials(auth.org.id);
  const conn = getConnector(source as SourceId);
  if (!conn) {
    return NextResponse.json({
      ok: false, source, mode: 'unconfigured', ms: 0,
      reason: 'This source requires configuration. Add the required env keys to enable it.',
      connectorId: 'unconfigured',
    });
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = Date.now();
  const result = await conn.poll({
    since,
    brandKeywords: [brand.name, ...brand.safeThemes].slice(0, 5),
    competitors: brand.competitors,
    limit: 10,
    credentials,
    emitAll: true,
  });
  const ms = Date.now() - start;

  if (!result.ok) {
    return NextResponse.json({
      ok: false, source, mode: result.mode, ms, reason: result.reason,
      connectorId: conn.id,
    });
  }
  return NextResponse.json({
    ok: true,
    source,
    connectorId: conn.id,
    mode: result.mode,
    ms,
    count: result.signals.length,
    sample: result.signals.slice(0, 5).map(s => ({
      title: s.title,
      url: s.url,
      firstSeenAt: s.firstSeenAt,
      velocity: Math.round(s.velocity),
    })),
  });
}
