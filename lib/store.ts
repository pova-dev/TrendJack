// Tenant-scoped store. Every read/write is keyed by brandId; pages and routes
// must resolve the active brandId from session before calling these.
//
// Hydrates Brand → BrandProfile (untyped JSON columns get parsed) and Trend
// rows → typed Trend objects. Writes accept either patches or full objects.

import 'server-only';
import { prisma } from './db';
import { publishBrandTrend } from './realtime/bus';
import type { ScoreResult } from '@/src/core/scoring';
import type {
  ActionType,
  BoardConfig,
  BrandProfile,
  ColumnConfig,
  Draft,
  Recommendation,
  ScoringWeights,
  SourceId,
  Trend,
} from '@/types';
import { DEFAULT_WEIGHTS } from '@/types';
import { score, type RawSignal } from '@/src/core/scoring';
import { forecastPeak } from '@/src/core/scoring/cascade';

// -----------------------------------------------------------------------------
// Brand
// -----------------------------------------------------------------------------

export async function getBrand(brandId: string): Promise<BrandProfile | null> {
  const b = await prisma.brand.findUnique({ where: { id: brandId } });
  return b ? rowToBrand(b) : null;
}

export async function listBrandsForOrg(orgId: string): Promise<BrandProfile[]> {
  const rows = await prisma.brand.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
  return rows.map(rowToBrand);
}

export type BrandPatch = Partial<Omit<BrandProfile, 'id'>>;

export async function updateBrand(brandId: string, patch: BrandPatch): Promise<BrandProfile> {
  const data: Record<string, unknown> = {};
  if ('name' in patch) data.name = patch.name;
  if ('category' in patch) data.category = patch.category;
  if ('contentGoal' in patch) data.contentGoal = patch.contentGoal;
  if ('riskTolerance' in patch) data.riskTolerance = patch.riskTolerance;
  if ('approvalMode' in patch) data.approvalMode = patch.approvalMode;
  if ('crisisMode' in patch) data.crisisMode = patch.crisisMode;
  if ('markets' in patch) data.markets = JSON.stringify(patch.markets ?? []);
  if ('audience' in patch) data.audience = JSON.stringify(patch.audience ?? {});
  if ('tone' in patch) data.tone = JSON.stringify(patch.tone ?? {});
  if ('bannedTopics' in patch) data.bannedTopics = JSON.stringify(patch.bannedTopics ?? []);
  if ('brandKeywords' in patch) data.brandKeywords = JSON.stringify(patch.brandKeywords ?? []);
  if ('gtrendsCategories' in patch) data.gtrendsCategories = JSON.stringify(patch.gtrendsCategories ?? []);
  if ('geoSubregion' in patch) data.geoSubregion = patch.geoSubregion ?? '';
  if ('competitorPageIds' in patch) data.competitorPageIds = JSON.stringify(patch.competitorPageIds ?? {});
  if ('safeThemes' in patch) data.safeThemes = JSON.stringify(patch.safeThemes ?? []);
  if ('competitors' in patch) data.competitors = JSON.stringify(patch.competitors ?? []);
  if ('priorityPlatforms' in patch) data.priorityPlatforms = JSON.stringify(patch.priorityPlatforms ?? []);
  if ('scoringWeights' in patch) data.scoringWeights = JSON.stringify(patch.scoringWeights ?? DEFAULT_WEIGHTS);

  const updated = await prisma.brand.update({ where: { id: brandId }, data });
  // If anything that affects scoring changed, rescore the trends.
  if (
    'tone' in patch || 'bannedTopics' in patch || 'safeThemes' in patch ||
    'brandKeywords' in patch || 'competitors' in patch || 'audience' in patch ||
    'scoringWeights' in patch || 'riskTolerance' in patch ||
    'approvalMode' in patch || 'crisisMode' in patch
  ) {
    await rescoreBrandTrends(brandId);
  }
  return rowToBrand(updated);
}

// -----------------------------------------------------------------------------
// Trends
// -----------------------------------------------------------------------------

export interface ListTrendOpts {
  source?: SourceId;
  recommendations?: Recommendation[];
  minOpportunity?: number;
  maxRisk?: number;
  maxCringe?: number;
  competitorClaimed?: boolean;
  decay?: boolean;
  firstMoverOnly?: boolean;
  bannedTopicSafe?: boolean;
  search?: string;
  excludeDismissed?: boolean;
  limit?: number;
  sortBy?: 'opportunity' | 'velocity' | 'risk' | 'firstSeenAt' | 'reach';
  sortDir?: 'asc' | 'desc';
}

export async function listTrends(brandId: string, opts: ListTrendOpts = {}): Promise<Trend[]> {
  const where: Record<string, unknown> = { brandId };
  if (opts.source) where.source = opts.source;
  if (opts.recommendations?.length) where.recommendation = { in: opts.recommendations };
  if (typeof opts.competitorClaimed === 'boolean') where.competitorClaimed = opts.competitorClaimed;

  // ──────────────────────────────────────────────────────────────────────
  // Priority unioning: brand-keyword hits + pinned trends are ALWAYS
  // included regardless of limit. Without this, dense news ingestion
  // (e.g. 60 news articles published in the last hour) pushes
  // high-importance trends out of the top-N-by-firstSeenAt window, and
  // the Brand Matches / Pinned Watchlist columns appear empty.
  //
  // The implementation: fetch the priority rows + the top-N-recent rows
  // separately, then dedupe by id.
  // ──────────────────────────────────────────────────────────────────────
  const limit = opts.limit ?? 200;

  // Audit 2026-05-29 — three-way priority union:
  //
  //   1. brandKeywordHit | pinned   — small set, ALWAYS included
  //   2. source='custom'            — deterministic competitor-tracking
  //                                   surfaces (Meta Ad Library,
  //                                   X-Trending). Tiny (25-100 rows),
  //                                   ALWAYS included with no cap.
  //   3. competitorClaimed=true     — huge set (every news article
  //                                   mentioning a competitor). Capped
  //                                   to top-N newest so it doesn't
  //                                   crowd out the rest.
  //   4. recentRows                 — top-N newest for general coverage
  //
  // Previously we lumped 1-3 under one OR with take:800. competitorClaimed
  // had 9,670 rows for the POVA brand, swamping the 800-row cap and
  // pushing the 25 custom rows (9 days old) clean out of the result.
  // Splitting gives custom a guaranteed slot.
  const [brandKwPinned, customRows, competitorRows, recentRows] = await Promise.all([
    prisma.trend.findMany({
      where: { ...where, OR: [{ brandKeywordHit: true }, { pinned: true }] },
      orderBy: { firstSeenAt: 'desc' },
      take: 500,
    }),
    prisma.trend.findMany({
      where: { ...where, source: 'custom' },
      orderBy: { firstSeenAt: 'desc' },
      // Source-custom is operator-explicit competitor tracking. Always
      // surface all of them; the connectors emit small fixed counts.
      take: 200,
    }),
    prisma.trend.findMany({
      where: { ...where, competitorClaimed: true },
      orderBy: { firstSeenAt: 'desc' },
      take: 400,
    }),
    prisma.trend.findMany({
      where,
      take: limit,
      orderBy: { firstSeenAt: 'desc' },
    }),
  ]);
  const priorityRows = [...brandKwPinned, ...customRows, ...competitorRows];

  const seen = new Set<string>();
  const merged: typeof priorityRows = [];
  for (const r of [...priorityRows, ...recentRows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }

  // ──────────────────────────────────────────────────────────────────────
  // UI-level dedup. Even after Phase-3's ingest-time dedup, the DB still
  // contains historical duplicates from before the fix landed (e.g. four
  // separate Reddit cross-posts of "POVA Curve 2 Battery Life is Insane"
  // each with its own Reddit post-id). We collapse them at read time so
  // the dashboard shows one canonical card per unique title-on-source.
  // The non-canonical rows stay in the DB — they continue to accumulate
  // sample data — they just don't render twice.
  //
  // Canonical = highest velocity (most engagement). Pinned wins
  // unconditionally so a user's pin is never collapsed away by a more
  // active duplicate.
  // ──────────────────────────────────────────────────────────────────────
  const fpKey = (r: { title: string; source: string; url: string | null }): string => {
    // Always use source+fingerprint. URL-based keys break for Reddit
    // cross-posts (4 different post-IDs → 4 different URLs → no merge),
    // which is exactly the scenario producing 4× POVA Curve cards on
    // the live dashboard.
    //
    // Cross-source dedup (same article on News + HN) still works because
    // both connectors normalize to the same title; the source prefix
    // means they don't collide ('reddit:foo' vs 'news:foo'), but that's
    // the correct call — they're legitimately different signals (Reddit
    // discussion ≠ news article) even if the underlying topic matches.
    const stripped = r.title
      .replace(/\s*[-–—]\s*([A-Z][A-Za-z0-9.]*(?:\s+[A-Z][A-Za-z0-9.]*){0,3})\s*$/, '')
      .toLowerCase()
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 120);
    return `${r.source}:${stripped}`;
  };

  const byFp = new Map<string, typeof priorityRows[number]>();
  for (const r of merged) {
    const key = fpKey(r);
    const existing = byFp.get(key);
    if (!existing) {
      byFp.set(key, r);
      continue;
    }
    // Pinned beats everything; otherwise highest-velocity wins.
    const winner =
      r.pinned && !existing.pinned ? r
      : existing.pinned && !r.pinned ? existing
      : r.velocity > existing.velocity ? r
      : existing;
    byFp.set(key, winner);
  }
  const rows = Array.from(byFp.values());

  // Apply filters not directly mapped to columns (we stored scores as JSON).
  let items = rows.map(rowToTrend);

  if (opts.excludeDismissed) {
    const dismissed = await prisma.trendAction.findMany({
      where: { type: 'dismiss', trend: { brandId } },
      select: { trendId: true },
    });
    const set = new Set(dismissed.map(d => d.trendId));
    items = items.filter(t => !set.has(t.id));
  }
  if (typeof opts.minOpportunity === 'number') items = items.filter(t => t.scores.opportunity >= opts.minOpportunity!);
  if (typeof opts.maxRisk === 'number') items = items.filter(t => t.scores.risk <= opts.maxRisk!);
  if (typeof opts.maxCringe === 'number') items = items.filter(t => t.scores.cringe <= opts.maxCringe!);
  if (opts.firstMoverOnly) items = items.filter(t => t.scores.firstMover >= 0.6 && !t.competitorClaimed);
  if (opts.bannedTopicSafe) items = items.filter(t => t.scores.topicalFit > 0);
  if (opts.decay) {
    const now = Date.now();
    items = items.filter(t => {
      const peak = t.peakWindowEnd ? new Date(t.peakWindowEnd).getTime() : 0;
      const start = new Date(t.firstSeenAt).getTime();
      const ratio = (now - start) / Math.max(peak - start, 1);
      return ratio > 0.7;
    });
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    items = items.filter(t => (t.title + ' ' + t.summary + ' ' + t.hashtags.join(' ')).toLowerCase().includes(q));
  }

  const k = opts.sortBy ?? 'opportunity';
  const dir = opts.sortDir ?? 'desc';
  items.sort((a, b) => {
    const av = pickSortVal(a, k);
    const bv = pickSortVal(b, k);
    return dir === 'desc' ? bv - av : av - bv;
  });

  return items;
}

function pickSortVal(t: Trend, key: NonNullable<ListTrendOpts['sortBy']>): number {
  switch (key) {
    case 'opportunity': return t.scores.opportunity;
    case 'velocity':    return t.velocity;
    case 'risk':        return t.scores.risk;
    case 'reach':       return Number(t.reach);
    case 'firstSeenAt': return new Date(t.firstSeenAt).getTime();
  }
}

export async function getTrend(trendId: string): Promise<Trend | null> {
  const row = await prisma.trend.findUnique({ where: { id: trendId } });
  return row ? rowToTrend(row) : null;
}

// Polarity table for operator feedback. CLAUDE-encoded:
//   save / approve / pin / generate    →  +1  (positive — operator endorsed)
//   dismiss / reject                    →  -1  (negative — operator rejected)
//   snooze / follow / assign / unpin    →   0  (neutral — logged, not training)
//   export                              →   0
const ACTION_POLARITY: Record<ActionType, -1 | 0 | 1> = {
  save:     1,
  approve:  1,
  pin:      1,
  generate: 1,
  dismiss: -1,
  reject:  -1,
  snooze:   0,
  follow:   0,
  assign:   0,
  export:   0,
  unpin:    0,
};

export async function recordAction(trendId: string, type: ActionType, actor = 'user_demo', payload?: unknown) {
  await prisma.trendAction.create({
    data: { trendId, type, actor, payload: payload ? JSON.stringify(payload) : null },
  });

  // Publish to STREAMS.operatorFeedback (Feature D — Calibration Engine).
  // Snapshots the trend's feature state at action-time so the
  // calibration agent has a labeled training pair. We do this AFTER the
  // TrendAction insert so the audit trail is durable even if the bus
  // fan-out fails. Bus errors are swallowed — calibration is non-
  // critical telemetry.
  try {
    const trendRow = await prisma.trend.findUnique({ where: { id: trendId } });
    if (!trendRow) return;
    const scores = parseJSON(trendRow.scores, {} as Record<string, number>);
    const polarity = ACTION_POLARITY[type] ?? 0;

    const { getBus } = await import('@/src/core/state');
    const { STREAMS } = await import('@/src/core/state/streams');
    // Reason chip from the dismiss modal (Feature D Phase 3) flows in
    // the action payload. Captured for the calibration audit trail —
    // Phase 4 will use it for finer-grained bucket math (per-reason
    // negative-polarity weighting).
    const reason = (payload && typeof payload === 'object' && payload !== null && 'reason' in (payload as Record<string, unknown>))
      ? String((payload as Record<string, unknown>).reason).slice(0, 200)
      : undefined;
    await getBus().publish(STREAMS.operatorFeedback, {
      brandId: trendRow.brandId,
      trendId,
      userId: actor,
      action: type,
      polarity,
      features: {
        fit: typeof scores.brandFit === 'number' ? scores.brandFit : 0,
        velocity: trendRow.velocity,
        firstMover: typeof scores.firstMover === 'number' ? scores.firstMover : 0,
        risk: typeof scores.risk === 'number' ? scores.risk : 0,
        cringe: typeof scores.cringe === 'number' ? scores.cringe : 0,
        saturation: typeof scores.saturation === 'number' ? scores.saturation : 0,
        cascadePhase: (trendRow.cascadePhase as 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying' | null) ?? null,
        brandKeywordHit: trendRow.brandKeywordHit ?? false,
        recommendation: trendRow.recommendation,
        opportunity: typeof scores.opportunity === 'number' ? scores.opportunity : 0,
      },
      reason,
      emittedAt: new Date(),
    });
  } catch {
    // Calibration is non-critical — never let a bus blip break action recording.
  }
}

// -----------------------------------------------------------------------------
// Boards
// -----------------------------------------------------------------------------

export async function listBoardsForBrand(brandId: string, ownerId: string): Promise<BoardConfig[]> {
  const rows = await prisma.board.findMany({
    where: { brandId, OR: [{ ownerId }, { shared: true }] },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(rowToBoard);
}

export async function getDefaultBoard(brandId: string, ownerId: string): Promise<BoardConfig | null> {
  const row = await prisma.board.findFirst({
    where: { brandId, OR: [{ ownerId }, { shared: true }] },
    orderBy: { createdAt: 'asc' },
  });
  return row ? rowToBoard(row) : null;
}

// SECURITY: brandId is REQUIRED. Without it, any logged-in user could read
// boards from other orgs via /api/boards?id=<arbitrary>. Audit 2026-05-29 B1.
export async function getBoard(boardId: string, brandId: string): Promise<BoardConfig | null> {
  const row = await prisma.board.findUnique({ where: { id: boardId } });
  if (!row || row.brandId !== brandId) return null;
  return rowToBoard(row);
}

// SECURITY: prevents cross-tenant board mutation. If a caller passes an id
// that already belongs to another brand, refuse the update and create a new
// row instead. Audit 2026-05-29 B2.
export async function saveBoard(b: BoardConfig & { brandId: string; ownerId: string }): Promise<BoardConfig> {
  const existing = await prisma.board.findUnique({ where: { id: b.id } });
  if (existing) {
    if (existing.brandId !== b.brandId) {
      throw new Error('board_id_collision_across_brands');
    }
    const updated = await prisma.board.update({
      where: { id: b.id },
      data: { name: b.name, columns: JSON.stringify(b.columns), shared: b.shared },
    });
    return rowToBoard(updated);
  }
  const created = await prisma.board.create({
    data: {
      id: b.id,
      brandId: b.brandId,
      ownerId: b.ownerId,
      name: b.name,
      shared: b.shared,
      columns: JSON.stringify(b.columns),
    },
  });
  return rowToBoard(created);
}

// -----------------------------------------------------------------------------
// Drafts
// -----------------------------------------------------------------------------

// SECURITY: brandId is REQUIRED. Audit 2026-05-29 S1 — copilot was leaking
// drafts across tenants. Pass trendId to scope further.
export async function listDrafts(brandId: string, trendId?: string): Promise<Draft[]> {
  const rows = await prisma.draft.findMany({
    where: { brandId, ...(trendId ? { trendId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(d => ({
    id: d.id,
    trendId: d.trendId,
    brandId: d.brandId,
    variant: d.variant as Draft['variant'],
    platform: d.platform,
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? undefined,
    visualBrief: d.visualBrief ?? undefined,
    whyItWorks: d.whyItWorks ?? undefined,
    whatNotToSay: d.whatNotToSay ?? undefined,
    cringeScore: d.cringeScore,
    status: d.status as Draft['status'],
    assignee: d.assignee ?? undefined,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function addDrafts(drafts: Draft[]) {
  if (!drafts.length) return;
  await prisma.draft.createMany({
    data: drafts.map(d => ({
      id: d.id,
      trendId: d.trendId,
      brandId: d.brandId,
      variant: d.variant,
      platform: d.platform,
      hook: d.hook,
      body: d.body,
      cta: d.cta,
      visualBrief: d.visualBrief,
      whyItWorks: d.whyItWorks,
      whatNotToSay: d.whatNotToSay,
      cringeScore: d.cringeScore,
      status: d.status,
      assignee: d.assignee,
    })),
  });
}

// -----------------------------------------------------------------------------
// Rescore — re-runs the scoring engine against all trends for a brand.
// Triggered when brand profile changes (weights, voice, banned topics, etc).
// -----------------------------------------------------------------------------

export async function rescoreBrandTrends(brandId: string) {
  const brand = await getBrand(brandId);
  if (!brand) return;
  const rows = await prisma.trend.findMany({ where: { brandId } });
  for (const r of rows) {
    const signal: RawSignal = {
      source: r.source as SourceId,
      title: r.title,
      summary: r.summary,
      hashtags: JSON.parse(r.hashtags) as string[],
      lineage: r.lineage,
      catalyst: r.catalyst ?? undefined,
      firstSeenAt: r.firstSeenAt,
      velocity: r.velocity,
      reach: Number(r.reach),
      sentiment: r.sentiment,
      competitorClaimants: JSON.parse(r.competitorClaimants) as string[],
      formatFatigue: r.formatFatigue,
    };
    const result = score(signal, { brand });
    await prisma.trend.update({
      where: { id: r.id },
      data: {
        scores: JSON.stringify(result.scores),
        rationale: JSON.stringify(result.rationale),
        recommendation: result.recommendation,
        recommendationReason: result.recommendationReason,
        peakWindowEnd: result.peakWindowEnd,
        audienceOverlap: result.scores.audienceOverlap,
        brandKeywordHit: result.brandKeywordHit,
        matchedBrandKeywords: JSON.stringify(result.matchedBrandKeywords),
      },
    });
  }
}

// -----------------------------------------------------------------------------
// Row → typed conversions
// -----------------------------------------------------------------------------

function rowToBrand(b: Awaited<ReturnType<typeof prisma.brand.findUnique>>): BrandProfile {
  if (!b) throw new Error('null brand row');
  return {
    id: b.id,
    orgId: b.orgId,
    name: b.name,
    category: b.category,
    markets: parseJSON(b.markets, [] as string[]),
    audience: parseJSON(b.audience, { primary: [], age: '', psychographics: [] }) as BrandProfile['audience'],
    tone: parseJSON(b.tone, { voice: '', tagline: '', bannedPhrases: [], allowedJokes: [], forbiddenStyles: [] }) as BrandProfile['tone'],
    bannedTopics: parseJSON(b.bannedTopics, [] as string[]),
    brandKeywords: parseJSON(b.brandKeywords ?? '[]', [] as string[]),
    gtrendsCategories: parseJSON(b.gtrendsCategories ?? '[]', [] as string[]),
    geoSubregion: b.geoSubregion || undefined,
    competitorPageIds: parseJSON(b.competitorPageIds ?? '{}', {} as Record<string, string>),
    safeThemes: parseJSON(b.safeThemes, [] as string[]),
    competitors: parseJSON(b.competitors, [] as string[]),
    priorityPlatforms: parseJSON(b.priorityPlatforms, [] as string[]),
    contentGoal: b.contentGoal,
    riskTolerance: b.riskTolerance as BrandProfile['riskTolerance'],
    approvalMode: b.approvalMode as BrandProfile['approvalMode'],
    crisisMode: b.crisisMode,
    scoringWeights: parseJSON(b.scoringWeights, DEFAULT_WEIGHTS) as ScoringWeights,
  };
}

function rowToTrend(r: Awaited<ReturnType<typeof prisma.trend.findUnique>>): Trend {
  if (!r) throw new Error('null trend row');
  return {
    id: r.id,
    brandId: r.brandId,
    source: r.source as SourceId,
    sourceRef: r.sourceRef,
    title: r.title,
    summary: r.summary,
    hashtags: parseJSON(r.hashtags, [] as string[]),
    lineage: r.lineage,
    catalyst: r.catalyst ?? undefined,
    firstSeenAt: r.firstSeenAt.toISOString(),
    peakAt: r.peakAt?.toISOString(),
    peakWindowEnd: r.peakWindowEnd?.toISOString(),
    predictedPeakAt: r.predictedPeakAt?.toISOString(),
    predictedPeakConfidence: r.predictedPeakConfidence ?? undefined,
    cascadePhase: r.cascadePhase ?? undefined,
    calibrationBoost: r.calibrationBoost ?? undefined,
    postEngagement: r.postEngagement != null ? Number(r.postEngagement) : undefined,
    performanceMultiple: r.performanceMultiple ?? undefined,
    velocity: r.velocity,
    reach: Number(r.reach),
    sentiment: r.sentiment,
    audienceOverlap: r.audienceOverlap,
    scores: parseJSON(r.scores, {} as Trend['scores']),
    rationale: parseJSON(r.rationale, [] as Trend['rationale']),
    recommendation: r.recommendation as Recommendation,
    recommendationReason: r.recommendationReason,
    competitorClaimed: r.competitorClaimed,
    competitorClaimants: parseJSON(r.competitorClaimants, [] as string[]),
    brandKeywordHit: (r as { brandKeywordHit?: boolean }).brandKeywordHit ?? false,
    matchedBrandKeywords: parseJSON((r as { matchedBrandKeywords?: string }).matchedBrandKeywords ?? '[]', [] as string[]),
    formatFatigue: r.formatFatigue,
    examples: r.examples ? parseJSON(r.examples, [] as Trend['examples']) : undefined,
    url: r.url ?? undefined,
    pinned: r.pinned ?? false,
    velocityDelta: r.velocityDelta ?? undefined,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function rowToBoard(b: Awaited<ReturnType<typeof prisma.board.findUnique>>): BoardConfig {
  if (!b) throw new Error('null board row');
  return {
    id: b.id,
    name: b.name,
    ownerId: b.ownerId,
    columns: parseJSON(b.columns, [] as ColumnConfig[]),
    shared: b.shared,
  };
}

function parseJSON<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

// -----------------------------------------------------------------------------
// Audit log
// -----------------------------------------------------------------------------

export async function logAudit(opts: { orgId: string; userId?: string; action: string; target?: string; meta?: unknown }) {
  await prisma.auditLog.create({
    data: {
      orgId: opts.orgId,
      userId: opts.userId,
      action: opts.action,
      target: opts.target,
      meta: opts.meta ? JSON.stringify(opts.meta) : null,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// persistScoredTrend: the canonical write path for a scored signal.
// Used by both lib/ingest.ts (legacy synchronous loop) and the Filter
// Agent (bus subscriber). Single source of truth — both paths produce
// identical DB output, which is what makes parallel-running safe.
//
// Returns 'inserted' | 'updated' so the caller can update its tally.
// ──────────────────────────────────────────────────────────────────────

export type PersistOutcome = 'inserted' | 'updated';

export async function persistScoredTrend(
  signal: RawSignal,
  scoreResult: ScoreResult,
  brandId: string,
): Promise<{ outcome: PersistOutcome; trendId: string }> {
  const externalKey = signal.externalId ?? `${signal.source}:${signal.url}`;

  const existing = await prisma.trend.findFirst({
    where: { brandId, sourceRef: externalKey },
  });

  if (existing) {
    const prevVel = existing.velocity;
    const delta = prevVel > 0 ? (signal.velocity - prevVel) / prevVel : 0;
    await prisma.trend.update({
      where: { id: existing.id },
      data: {
        title: signal.title,
        summary: signal.summary,
        velocity: signal.velocity,
        velocityPrev: prevVel,
        velocityDelta: delta,
        reach: BigInt(Math.max(0, Math.round(signal.reach))),
        sentiment: signal.sentiment,
        scores: JSON.stringify(scoreResult.scores),
        rationale: JSON.stringify(scoreResult.rationale),
        recommendation: scoreResult.recommendation,
        recommendationReason: scoreResult.recommendationReason,
        peakWindowEnd: scoreResult.peakWindowEnd,
        competitorClaimed: signal.competitorClaimants.length > 0,
        competitorClaimants: JSON.stringify(signal.competitorClaimants),
        brandKeywordHit: scoreResult.brandKeywordHit,
        matchedBrandKeywords: JSON.stringify(scoreResult.matchedBrandKeywords),
        calibrationBoost: scoreResult.calibrationBoost ?? 1.0,
        url: signal.url ?? existing.url,
      },
    });
    await prisma.trendSample.create({
      data: {
        trendId: existing.id,
        velocity: signal.velocity,
        reach: BigInt(Math.max(0, Math.round(signal.reach))),
        sentiment: signal.sentiment,
        opportunity: scoreResult.scores.opportunity,
        source: signal.source,
      },
    });
    // Predictive Virality (Phase 1): re-run forecastPeak now that a fresh
    // sample has been written. Only meaningful with ≥3 samples; below
    // that the function returns null + 0 confidence and we leave the
    // columns as-is (last-good wins).
    await maybeWriteForecast(existing.id);
    publishBrandTrend(brandId, { type: 'trend.updated', brandId, trendId: existing.id, reason: 'refresh' });
    return { outcome: 'updated', trendId: existing.id };
  }

  const created = await prisma.trend.create({
    data: {
      brandId,
      source: signal.source,
      sourceRef: externalKey,
      title: signal.title,
      summary: signal.summary,
      hashtags: JSON.stringify(signal.hashtags),
      lineage: signal.lineage,
      catalyst: signal.catalyst,
      firstSeenAt: signal.firstSeenAt,
      peakWindowEnd: scoreResult.peakWindowEnd,
      velocity: signal.velocity,
      reach: BigInt(Math.max(0, Math.round(signal.reach))),
      sentiment: signal.sentiment,
      audienceOverlap: scoreResult.scores.audienceOverlap,
      scores: JSON.stringify(scoreResult.scores),
      rationale: JSON.stringify(scoreResult.rationale),
      recommendation: scoreResult.recommendation,
      recommendationReason: scoreResult.recommendationReason,
      competitorClaimed: signal.competitorClaimants.length > 0,
      competitorClaimants: JSON.stringify(signal.competitorClaimants),
      brandKeywordHit: scoreResult.brandKeywordHit,
      matchedBrandKeywords: JSON.stringify(scoreResult.matchedBrandKeywords),
      calibrationBoost: scoreResult.calibrationBoost ?? 1.0,
      formatFatigue: signal.formatFatigue,
      examples: JSON.stringify(signal.examples ?? []),
      url: signal.url,
    },
  });
  await prisma.trendSample.create({
    data: {
      trendId: created.id,
      velocity: signal.velocity,
      reach: BigInt(Math.max(0, Math.round(signal.reach))),
      sentiment: signal.sentiment,
      opportunity: scoreResult.scores.opportunity,
      source: signal.source,
    },
  });
  // Brand-new trend: 1 sample → forecast returns 0-confidence pre-launch.
  // Worth running anyway so the cascadePhase column has a value rather than
  // null on first sight; it'll get refined on the second tick.
  await maybeWriteForecast(created.id);
  publishBrandTrend(brandId, { type: 'trend.created', brandId, trendId: created.id });
  return { outcome: 'inserted', trendId: created.id };
}

/** Re-run forecastPeak() against a trend's TrendSample series, persist
 *  the result, AND apply phase-aware recommendation downgrades.
 *
 *  Phase-aware rule (Phase B Phase 2 of Predictive Virality): when a
 *  trend is decaying with high confidence (≥0.60), the action window
 *  is closed — POST_NOW becomes a misleading recommendation. Downgrade
 *  to MONITOR with a reason that names the phase + confidence so the
 *  operator understands WHY the verdict moved.
 *
 *  Idempotent — safe to call on every persist tick. Returns silently
 *  when there isn't enough history to forecast. */
/** A Date that Prisma will actually accept. `new Date(NaN)` and dates past the
 *  ±8.64e15 ms limit are still Date instances, so `instanceof` proves nothing. */
function isUsableDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

async function maybeWriteForecast(trendId: string): Promise<void> {
  const samples = await prisma.trendSample.findMany({
    where: { trendId },
    orderBy: { sampledAt: 'asc' },
    take: 20,
    select: { sampledAt: true, velocity: true, reach: true },
  });
  if (samples.length < 3) {
    // Below the floor: leave columns as-is (preserves last-good when an
    // earlier tick had a forecast that's still a valid recent reading).
    return;
  }
  const f = forecastPeak(samples.map(s => ({
    sampledAt: s.sampledAt,
    velocity: s.velocity,
    reach: Number(s.reach),
  })));

  const updates: {
    predictedPeakAt: Date | null;
    predictedPeakConfidence: number | null;
    cascadePhase: string;
    recommendation?: string;
    recommendationReason?: string;
  } = {
    // Belt and braces on top of the range guard in cascade.ts. An Invalid Date
    // is still a Date object, so it passes type checks and only fails at the
    // Prisma boundary, taking the whole forecast write with it. Drop it to null
    // here rather than let one bad fit abort ingestion for that trend.
    predictedPeakAt: isUsableDate(f.predictedPeakAt) ? f.predictedPeakAt : null,
    predictedPeakConfidence: f.predictedPeakConfidence,
    cascadePhase: f.phase,
  };

  // Phase-aware downgrade. Only fires when:
  //   - phase = 'decaying' AND
  //   - confidence ≥ 0.60 (don't override based on a flaky 3-sample fit) AND
  //   - current recommendation is action-tier (POST_NOW or PREP_1H)
  if (f.phase === 'decaying' && f.predictedPeakConfidence >= 0.60) {
    const current = await prisma.trend.findUnique({
      where: { id: trendId },
      select: { recommendation: true },
    });
    if (current && (current.recommendation === 'POST_NOW' || current.recommendation === 'PREP_1H')) {
      updates.recommendation = 'MONITOR';
      updates.recommendationReason = `Cascade decaying (${Math.round(f.predictedPeakConfidence * 100)}% confidence) — action window closed; downgraded from ${current.recommendation}.`;
    }
  }

  await prisma.trend.update({ where: { id: trendId }, data: updates });
}
