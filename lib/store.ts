// Tenant-scoped store. Every read/write is keyed by brandId; pages and routes
// must resolve the active brandId from session before calling these.
//
// Hydrates Brand → BrandProfile (untyped JSON columns get parsed) and Trend
// rows → typed Trend objects. Writes accept either patches or full objects.

import { prisma } from './db';
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
import { score, type RawSignal } from '@/lib/scoring/engine';

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

  const [priorityRows, recentRows] = await Promise.all([
    prisma.trend.findMany({
      where: { ...where, OR: [{ brandKeywordHit: true }, { pinned: true }] },
      orderBy: { firstSeenAt: 'desc' },
      // Hard cap to prevent runaway result sizes if a brand somehow has
      // thousands of brand-keyword hits or pinned items.
      take: 500,
    }),
    prisma.trend.findMany({
      where,
      take: limit,
      orderBy: { firstSeenAt: 'desc' },
    }),
  ]);

  const seen = new Set<string>();
  const merged: typeof priorityRows = [];
  for (const r of [...priorityRows, ...recentRows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  const rows = merged;

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

export async function recordAction(trendId: string, type: ActionType, actor = 'user_demo', payload?: unknown) {
  await prisma.trendAction.create({
    data: { trendId, type, actor, payload: payload ? JSON.stringify(payload) : null },
  });
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

export async function getBoard(boardId: string): Promise<BoardConfig | null> {
  const row = await prisma.board.findUnique({ where: { id: boardId } });
  return row ? rowToBoard(row) : null;
}

export async function saveBoard(b: BoardConfig & { brandId: string; ownerId: string }): Promise<BoardConfig> {
  const existing = await prisma.board.findUnique({ where: { id: b.id } });
  if (existing) {
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

export async function listDrafts(trendId?: string): Promise<Draft[]> {
  const rows = await prisma.draft.findMany({
    where: trendId ? { trendId } : undefined,
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
    name: b.name,
    category: b.category,
    markets: parseJSON(b.markets, [] as string[]),
    audience: parseJSON(b.audience, { primary: [], age: '', psychographics: [] }) as BrandProfile['audience'],
    tone: parseJSON(b.tone, { voice: '', tagline: '', bannedPhrases: [], allowedJokes: [], forbiddenStyles: [] }) as BrandProfile['tone'],
    bannedTopics: parseJSON(b.bannedTopics, [] as string[]),
    brandKeywords: parseJSON(b.brandKeywords ?? '[]', [] as string[]),
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
