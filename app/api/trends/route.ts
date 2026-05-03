import { NextRequest, NextResponse } from 'next/server';
import { listTrends, type ListTrendOpts } from '@/lib/store';
import { getCurrentContext } from '@/lib/auth';
import type { Recommendation, SourceId } from '@/types';

export async function GET(req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const opts: ListTrendOpts = {
    source: (sp.get('source') as SourceId) ?? undefined,
    recommendations: sp.get('rec') ? (sp.get('rec')!.split(',') as Recommendation[]) : undefined,
    minOpportunity: numOrUndef(sp.get('minOpp')),
    maxRisk: numOrUndef(sp.get('maxRisk')),
    maxCringe: numOrUndef(sp.get('maxCringe')),
    competitorClaimed: boolOrUndef(sp.get('competitorClaimed')),
    decay: boolOrUndef(sp.get('decay')),
    firstMoverOnly: boolOrUndef(sp.get('firstMoverOnly')),
    bannedTopicSafe: boolOrUndef(sp.get('bannedTopicSafe')),
    search: sp.get('search') ?? undefined,
    excludeDismissed: sp.get('excludeDismissed') !== 'false',
    limit: numOrUndef(sp.get('limit')),
    sortBy: (sp.get('sortBy') as ListTrendOpts['sortBy']) ?? undefined,
    sortDir: (sp.get('sortDir') as ListTrendOpts['sortDir']) ?? undefined,
  };
  const items = await listTrends(ctx.brand.id, opts);
  return NextResponse.json({ items, count: items.length });
}

function numOrUndef(v: string | null) { return v == null ? undefined : Number(v); }
function boolOrUndef(v: string | null) {
  if (v == null) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}
