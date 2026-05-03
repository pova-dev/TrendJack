import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/geo/snapshot?windowDays=7 — returns the brand's GEO panel
// data for the requested window. Aggregations happen here so the UI
// doesn't have to ship the raw sample table client-side.

export async function GET(req: NextRequest) {
  const auth = await getCurrentContext();
  if (!auth?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const windowDays = Math.max(1, Math.min(90, parseInt(req.nextUrl.searchParams.get('windowDays') ?? '7', 10) || 7));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const samples = await prisma.brandCitationSample.findMany({
    where: { brandId: auth.brand.id, runAt: { gte: since } },
    orderBy: { runAt: 'desc' },
    take: 500,
  });

  // Per-model citation rate
  const byModel = new Map<string, { runs: number; cited: number; avgPosition: number; positions: number[] }>();
  // Competitor leaderboard: name → mention count
  const competitorCounts = new Map<string, number>();
  // Daily citation rate timeline
  const byDay = new Map<string, { runs: number; cited: number }>();

  for (const s of samples) {
    if (s.runFailed) continue;
    const m = byModel.get(s.model) ?? { runs: 0, cited: 0, avgPosition: 0, positions: [] };
    m.runs++;
    if (s.cited) {
      m.cited++;
      if (s.position != null) m.positions.push(s.position);
    }
    byModel.set(s.model, m);

    const day = s.runAt.toISOString().slice(0, 10);
    const d = byDay.get(day) ?? { runs: 0, cited: 0 };
    d.runs++;
    if (s.cited) d.cited++;
    byDay.set(day, d);

    const competitors = JSON.parse(s.competitorsMentioned ?? '[]') as string[];
    for (const c of competitors) {
      competitorCounts.set(c, (competitorCounts.get(c) ?? 0) + 1);
    }
  }

  const modelPanel = Array.from(byModel.entries()).map(([model, v]) => ({
    model,
    runs: v.runs,
    cited: v.cited,
    citationRate: v.runs > 0 ? v.cited / v.runs : 0,
    avgPosition: v.positions.length ? v.positions.reduce((s, p) => s + p, 0) / v.positions.length : null,
  }));
  const competitorPanel = Array.from(competitorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, mentions: count }))
    .slice(0, 20);
  const timeline = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, runs: v.runs, cited: v.cited, citationRate: v.runs > 0 ? v.cited / v.runs : 0 }));

  // Latest 25 raw samples for drill-down
  const recent = samples.slice(0, 25).map(s => ({
    id: s.id,
    model: s.model,
    promptClass: s.promptClass,
    promptText: s.promptText,
    cited: s.cited,
    position: s.position,
    snippet: s.snippet,
    competitorsMentioned: JSON.parse(s.competitorsMentioned ?? '[]'),
    runAt: s.runAt,
    runFailed: s.runFailed,
    failureReason: s.failureReason,
  }));

  return NextResponse.json({
    windowDays,
    sampleCount: samples.length,
    runFailedCount: samples.filter(s => s.runFailed).length,
    byModel: modelPanel,
    competitors: competitorPanel,
    timeline,
    recent,
  });
}
