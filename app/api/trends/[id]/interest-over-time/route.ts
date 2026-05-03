import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { getTrend } from '@/lib/store';
import { getInterestOverTime, type IotTimeRange } from '@/lib/gtrends-iot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/trends/[id]/interest-over-time?range=now+7-d
//
// Returns the real Google Trends interest-over-time series for a
// trend's title (the search term). Drives the drawer's "Trend Over
// Time" graph. Replaces the prior implementation which plotted
// TrendJack's own velocity samples — those started at 0 the moment we
// first saw the trend, so a 19-min-old trend showed a single rising
// dot, with no signal about whether the trend was actually rising or
// peaking.
//
// Cached server-side for 1 hour per (term × geo × range). Rate limits
// from Google are surfaced as HTTP 503 with reason "rate_limited" so
// the drawer can render a useful message instead of a broken chart.

const VALID_RANGES: ReadonlyArray<IotTimeRange> = ['now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m'];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const trend = await getTrend(id);
  if (!trend || trend.brandId !== auth.brand.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const rangeParam = req.nextUrl.searchParams.get('range') ?? 'now 7-d';
  const range = (VALID_RANGES as readonly string[]).includes(rangeParam)
    ? (rangeParam as IotTimeRange)
    : 'now 7-d';
  // Geo: lineage tags `Google Trends · IN ·` per connector — pull from
  // there so the IoT geo matches what we ingested. Fall back to brand's
  // primary market.
  const geoMatch = /Google Trends · ([A-Z]{2})\b/.exec(trend.lineage ?? '');
  const geo = geoMatch?.[1] ?? 'IN';

  try {
    const series = await getInterestOverTime(trend.title, { geo, timeRange: range });
    return NextResponse.json({
      term: series.term,
      geo: series.geo,
      timeRange: series.timeRange,
      points: series.points,
      peak: series.peak,
      fetchedAt: series.fetchedAt,
    });
  } catch (err) {
    const reason = (err as Error).message;
    if (reason === 'rate_limited') {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Google Trends rate-limited this IP. Try again in a few minutes.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
