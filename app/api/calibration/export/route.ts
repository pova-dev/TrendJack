import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/calibration/export — returns the brand's full FeedbackEvent
// log as CSV. Headers + rows are stable for offline analysis (load into
// pandas / sheets / etc).
//
// Schema:
//   created_at, trend_id, action, polarity, fit, velocity,
//   first_mover, risk, cringe, saturation, cascade_phase,
//   brand_keyword_hit, recommendation, opportunity, reason
//
// `features` is the JSON snapshot from the moment of action — re-read
// here so re-bucketing later doesn't lose history. Numbers are
// floor-to-3-decimal so the CSV stays compact. Strings are CSV-escaped
// (quote + double-up internal quotes).

export async function GET() {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const events = await prisma.feedbackEvent.findMany({
    where: { brandId: auth.brand.id },
    orderBy: { createdAt: 'asc' },
  });

  const headers = [
    'created_at',
    'trend_id',
    'action',
    'polarity',
    'fit',
    'velocity',
    'first_mover',
    'risk',
    'cringe',
    'saturation',
    'cascade_phase',
    'brand_keyword_hit',
    'recommendation',
    'opportunity',
    'reason',
  ];

  const rows: string[] = [headers.join(',')];
  for (const e of events) {
    const f = safeJsonParse(e.features) ?? {};
    rows.push([
      e.createdAt.toISOString(),
      e.trendId,
      e.action,
      String(e.polarity),
      num3(f, 'fit'),
      num3(f, 'velocity'),
      num3(f, 'firstMover'),
      num3(f, 'risk'),
      num3(f, 'cringe'),
      num3(f, 'saturation'),
      csvField(strField(f, 'cascadePhase')),
      String(boolField(f, 'brandKeywordHit')),
      csvField(strField(f, 'recommendation')),
      num3(f, 'opportunity'),
      csvField(e.reason ?? ''),
    ].join(','));
  }

  const body = rows.join('\n') + '\n';
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="trendjack-calibration-${auth.brand.id}-${Date.now()}.csv"`,
    },
  });
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}
function num3(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return v.toFixed(3);
}
function strField(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === 'string' ? v : '';
}
function boolField(o: Record<string, unknown>, k: string): boolean {
  return o[k] === true;
}
function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
