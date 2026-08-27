import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentContext } from '@/lib/auth';
import { logAudit } from '@/lib/store';
import { publishBrandTrend } from '@/lib/realtime/bus';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Single source of truth for the default column set. Used both here (when
// the user resets) and on first board creation in lib/auth/actions.ts.
// Thresholds are intentionally permissive — empty columns destroy trust.
function defaultColumns() {
  // Layout: Pinned Watchlist (long-running tracked items) → Brand Matches
  // (strict — must mention brand keywords) → First-Mover → Rising →
  // Competitor → Google Trends → High Velocity → Risk → Decay → Alerts.
  // Reach floors prevent niche subreddits with 50 upvotes from being
  // labelled "trending" alongside truly viral content.
  return [
    { id: 'col_pinned',        type: 'custom',              title: '📌 Pinned Watchlist', refreshSec:  60, filters: { pinnedOnly: true },                                                          sort: { key: 'firstSeenAt', dir: 'desc' } },
    { id: 'col_brand_matches', type: 'brand_matches',       title: 'Brand Matches',       refreshSec:  60, filters: { brandKeywordOnly: true, bannedTopicSafe: true, maxRisk: 0.6, clusterSimilar: true, windowDays: 30 },             sort: { key: 'opportunity', dir: 'desc' } },
    { id: 'col_first_mover',   type: 'first_mover_window',  title: 'First-Mover Window',  refreshSec:  60, filters: { firstMoverOnly: true, minOpportunity: 20, minReach: 2000 },                 sort: { key: 'firstSeenAt', dir: 'desc' } },
    // Rising = peripheral awareness lane. Light velocity floor only —
    // reach is hard to compare across sources (Reddit upvotes vs YouTube
    // views vs news pageviews) so we don't gate on it here.
    { id: 'col_rising',        type: 'rising_trends',       title: 'Rising Trends',       refreshSec:  60, filters: { minVelocity: 30 },                                                          sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_competitors',   type: 'competitor_activity', title: 'Competitor Activity', refreshSec: 120, filters: { competitorClaimed: true },                                                  sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_gtrends',       type: 'custom',              title: 'Google Trends',       refreshSec: 300, filters: { sources: ['google_trends'], minOpportunity: 18 },                           sort: { key: 'velocity',    dir: 'desc' } },
    // High Velocity = the actually-fast lane. Reach floor scaled to what
    // niche brands realistically see (5k for a smartphone-India brand is
    // a real signal). Bump to 20k+ for mass-market consumer brands.
    { id: 'col_high_velocity', type: 'high_velocity',       title: 'High Velocity Posts', refreshSec:  60, filters: { minReach: 5000, minVelocity: 100 },                                         sort: { key: 'velocity',    dir: 'desc' } },
    { id: 'col_risk_watch',    type: 'risk_watch',          title: 'Trend Risk Watch',    refreshSec:  90, filters: {},                                                                          sort: { key: 'risk',        dir: 'desc' } },
    { id: 'col_decay',         type: 'decay_watch',         title: 'Decay Watch',         refreshSec: 300, filters: { decay: true },                                                              sort: { key: 'firstSeenAt', dir: 'asc'  } },
    { id: 'col_alerts',        type: 'alerts',              title: 'Alerts',              refreshSec:  30, filters: {},                                                                          sort: { key: 'firstSeenAt', dir: 'desc' } },
  ];
}

// POST /api/boards/reset — overwrite the user's primary board for the
// active brand with the current default column set. Used when scoring
// thresholds change and existing boards have stale tight filters that
// produce empty columns.
export async function POST() {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('board:edit'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.brand || !ctx.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Find the user's primary board (or first shared) for the active brand.
  let board = await prisma.board.findFirst({
    where: { brandId: ctx.brand.id, OR: [{ ownerId: ctx.user.id }, { shared: true }] },
    orderBy: { createdAt: 'asc' },
  });

  const cols = JSON.stringify(defaultColumns());
  if (board) {
    board = await prisma.board.update({
      where: { id: board.id },
      data: { columns: cols },
    });
  } else {
    board = await prisma.board.create({
      data: {
        brandId: ctx.brand.id,
        ownerId: ctx.user.id,
        name: 'War Room',
        shared: true,
        columns: cols,
      },
    });
  }

  await logAudit({
    orgId: ctx.org.id, userId: ctx.user.id,
    action: 'board.reset', target: board.id,
  });
  // Force every connected tab to refetch the board.
  publishBrandTrend(ctx.brand.id, {
    type: 'trend.updated', brandId: ctx.brand.id, trendId: '*', reason: 'board_reset',
  });

  return NextResponse.json({
    ok: true,
    boardId: board.id,
    columns: defaultColumns().length,
  });
}
