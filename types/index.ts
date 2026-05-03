// TrendJack core domain types.
// These mirror the Prisma schema but are usable across server and client.

export type SourceId =
  | 'x'
  | 'reddit'
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'google_trends'
  | 'news'
  | 'custom';

export type Recommendation =
  | 'POST_NOW'
  | 'PREP_1H'
  | 'MONITOR'
  | 'IGNORE'
  | 'ESCALATE'
  /** SAFE_PIVOT — high brand-fit + clean tone but high topical risk.
   *  Engine flags trends like this for a non-direct angle: acknowledge
   *  without engaging the controversy. The recommendationReason carries
   *  a structured pivot suggestion (celebratory / positional / meta). */
  | 'SAFE_PIVOT';

export type ConnectorMode = 'live' | 'mock' | 'sim';

export type DraftStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'shipped';

export type ColumnType =
  | 'brand_matches'
  | 'rising_trends'
  | 'competitor_activity'
  | 'emerging_memes'
  | 'high_velocity'
  | 'risk_watch'
  | 'creator_signals'
  | 'approved_opportunities'
  | 'draft_ideas'
  | 'alerts'
  | 'first_mover_window'
  | 'decay_watch'
  | 'compliance_hold'
  | 'localization_queue'
  | 'crisis_watch'
  | 'custom';

export interface ScoringWeights {
  virality: number;
  brandFit: number;
  timing: number;
  firstMover: number;
  saturation: number; // negative weight, stored as positive magnitude
  risk: number;       // negative weight magnitude
  cringe: number;     // negative weight magnitude
  formatFatigue: number; // negative weight magnitude
  effort: number;     // negative weight magnitude
}

// Weight rebalance per audit recommendation: "FM should be weighted higher
// than Total Reach because borrowing momentum is only possible before the
// trend becomes saturated noise."
//
// Previously: virality 0.28 (×0.30 reach component = 0.084 effective weight
// for reach), firstMover 0.10. FM was already marginally higher than the
// reach contribution — but the gap was negligible.
//
// Now: virality 0.22 (still the heavy hitter), firstMover 0.16 (+60%),
// brandFit 0.20 (slightly down), timing 0.14 (unchanged). FM contribution
// is now ~2.4x the effective reach contribution. Saturation/risk/cringe
// drag stays the same.
export const DEFAULT_WEIGHTS: ScoringWeights = {
  virality: 0.22,
  brandFit: 0.20,
  timing: 0.14,
  firstMover: 0.16,   // bumped from 0.10 — first-mover advantage emphasized
  saturation: 0.08,
  risk: 0.10,
  cringe: 0.06,
  formatFatigue: 0.02,
  effort: 0.02,
};

export interface BrandProfile {
  id: string;
  /** Owning org id. Optional for legacy fixtures that pre-date the
   *  multi-tenant migration; runtime-loaded brands always set it. The
   *  Filter Agent uses it to attach orgId to ScoredTrendMessage so
   *  downstream LLM calls can be budget-gated per org. */
  orgId?: string;
  name: string;
  category: string;
  markets: string[];
  audience: {
    primary: string[];
    age: string;
    psychographics: string[];
  };
  tone: {
    voice: string;
    tagline: string;
    bannedPhrases: string[];
    allowedJokes: string[];
    forbiddenStyles: string[];
  };
  bannedTopics: string[];
  /** Brand-specific keywords + product names. A trend qualifies as a
   *  Brand Match only when it mentions one of these (case-insensitive
   *  substring match). Examples for POVA: ['pova', 'tecno pova',
   *  'pova curve', 'pova 7', 'tecno']. */
  brandKeywords: string[];
  /** Google Trends category ids the brand wants ingested. Drives per-
   *  category fan-out in the Google Trends connector. Empty = top stories
   *  (legacy default). See prisma/schema.prisma comment for the id table. */
  gtrendsCategories?: string[];
  safeThemes: string[];
  competitors: string[];
  priorityPlatforms: SourceId[] | string[];
  contentGoal: string;
  riskTolerance: 'low' | 'medium' | 'high';
  approvalMode: 'strict' | 'moderate' | 'fast';
  crisisMode: boolean;
  scoringWeights: ScoringWeights;
}

export interface Scores {
  virality: number;        // 0..1
  topicalFit: number;      // 0..1
  tonalFit: number;        // 0..1
  audienceOverlap: number; // 0..1
  brandFit: number;        // derived from above
  timing: number;          // 0..1
  firstMover: number;      // 0..1
  saturation: number;      // 0..1
  risk: number;            // 0..1
  cringe: number;          // 0..1
  formatFatigue: number;   // 0..1
  assetEffort: number;     // 0..1
  approvalEffort: number;  // 0..1
  productionEffort: number;// 0..1
  effort: number;          // derived
  opportunity: number;     // 0..100
  /** CVS / Jacking Score / S_max — the canonical "should we act" signal.
   *  0..1 scale. Computed via computeJackingScore(); stored alongside the
   *  other scores in the per-trend JSON blob so no schema migration is
   *  needed. Optional for backward-compat with rows persisted before
   *  this field existed (rowToTrend defaults to 0). */
  jackingScore?: number;   // 0..1
}

export interface ScoreRationale {
  axis: keyof Scores;
  value: number;
  reasons: string[];
}

export interface Trend {
  id: string;
  brandId: string;
  source: SourceId;
  sourceRef: string;
  title: string;
  summary: string;
  hashtags: string[];
  lineage: string;
  catalyst?: string;
  firstSeenAt: string;
  peakAt?: string;
  peakWindowEnd?: string;
  /** Predictive Virality (Phase 1). When the cascade has ≥3 TrendSamples,
   *  forecastPeak() fits a logistic curve and emits the predicted peak
   *  time + confidence. UI renders as a phase pill on the TrendCard
   *  ("growing 60%", "peaking 80%", etc.) with a stable `now`-state
   *  gating so SSR doesn't drift from client. */
  predictedPeakAt?: string;
  predictedPeakConfidence?: number;
  /** 'pre-launch' | 'fast-growing-initial' | 'peaking' | 'decaying' */
  cascadePhase?: string;
  /** Calibration multiplier baked into opportunity at score time
   *  (Feature D). 1.0 means no nudge yet. UI threshold for the
   *  ↑/↓ glyph is `Math.abs(boost - 1) > 0.05`. */
  calibrationBoost?: number;
  velocity: number;       // posts/hour or %change
  reach: number;
  sentiment: number;      // -1..1
  audienceOverlap: number;
  scores: Scores;
  /** CVS / Jacking Score — the canonical "should we act" signal computed
   *  from FIT × VEL × FM × Sp / max(0.05, RISK + CRINGE + SAT_eff).
   *  Drives Creative Agent's go/no-go (≥0.35 default) and Verifier
   *  auto-fire (≥0.70 default). Rendered as a chip on every TrendCard. */
  jackingScore?: number;
  rationale: ScoreRationale[];
  recommendation: Recommendation;
  recommendationReason: string;
  competitorClaimed: boolean;
  competitorClaimants: string[];
  /** True iff the trend's text mentions one of the brand's brandKeywords.
   *  This is what the Brand Matches column filters on — distinct from
   *  brandFit (a composite score). A "POVA Curve 2 review" article hits
   *  brandKeywordHit=true; an "OnePlus Buds Ace 3" article does not (it
   *  would land in Competitor Activity instead). */
  brandKeywordHit?: boolean;
  /** Which of the brand's keywords matched (when brandKeywordHit). */
  matchedBrandKeywords?: string[];
  formatFatigue: number;
  examples?: TrendExample[];
  url?: string;          // canonical link to the original post / source
  pinned?: boolean;      // pinned trends sit above sort order in their column
  velocityDelta?: number;// % change since previous refresh, for diff chip
  createdAt: string;
  updatedAt: string;
}

export interface TrendExample {
  platform: string;
  author: string;
  text: string;
  engagement: number;
  url?: string;
}

export interface Draft {
  id: string;
  trendId: string;
  brandId: string;
  variant: 'safe' | 'bold' | 'meme' | 'reel' | 'carousel' | 'poll';
  platform: string;
  hook: string;
  body: string;
  cta?: string;
  visualBrief?: string;
  whyItWorks?: string;
  whatNotToSay?: string;
  cringeScore: number;
  status: DraftStatus;
  assignee?: string;
  createdAt: string;
}

export interface ColumnConfig {
  id: string;
  type: ColumnType;
  title: string;
  icon?: string;
  refreshSec: number;
  filters: ColumnFilters;
  sort: { key: keyof Scores | 'velocity' | 'firstSeenAt' | 'reach'; dir: 'asc' | 'desc' };
  width?: number;
}

export interface ColumnFilters {
  sources?: SourceId[];
  recommendations?: Recommendation[];
  minOpportunity?: number;
  maxRisk?: number;
  maxCringe?: number;
  competitorClaimed?: boolean;
  decay?: boolean;          // include decaying trends
  firstMoverOnly?: boolean;  // <2 brand posts seen
  bannedTopicSafe?: boolean; // exclude banned-topic hits
  search?: string;
  /** Comma-separated keyword include list — match if any of these appear */
  keywordInclude?: string[];
  /** Keyword exclude list — drop if any appear */
  keywordExclude?: string[];
  /** Time window in hours (default unlimited) */
  windowHours?: number;
  /** Time window in DAYS — used by the Brand Matches column's
   *  Today/7d/15d/30d selector. The operator-facing window for
   *  longitudinal "what's happened with our brand" review. When set,
   *  trends with firstSeenAt older than `windowDays` are excluded;
   *  trends within the window but older than 7 days get the LEGACY
   *  visual treatment on the card. */
  windowDays?: number;
  /** When true, cluster trends sharing the same matchedBrandKeywords
   *  within a 24h bucket — keep the canonical (highest-engagement)
   *  card and roll the rest into a "+N similar" badge. Only used by
   *  Brand Matches today; could extend to Competitor Activity. */
  clusterSimilar?: boolean;
  /** Subreddits when source includes 'reddit' */
  subreddits?: string[];
  /** Hashtags include */
  hashtags?: string[];
  /** Twitter trend locale, e.g. 'national:IN' or 'local:Delhi' */
  twitterLocale?: string;
  /** News domain allow / deny */
  newsAllow?: string[];
  newsDeny?: string[];
  /** Min velocity (posts/hour or %change) */
  minVelocity?: number;
  /** Min reach (impressions / views / upvotes-extrapolated). 1k for India
   *  is noise; legitimate "trending" usually starts at 5k–10k+. */
  minReach?: number;
  /** When true, only trends whose text mentions one of brand.brandKeywords
   *  qualify. Used by the Brand Matches column so it tracks YOUR brand
   *  signals, not competitor mentions or category-keyword false positives. */
  brandKeywordOnly?: boolean;
  /** When true, only trends with `pinned=true` show. Used by the
   *  Pinned Watchlist column for long-running tracked items. */
  pinnedOnly?: boolean;
  /** Google Trends category id filter (single). When set, only signals
   *  whose lineage starts with `[cat:<id>]` show. Use 'top' for top-stories,
   *  't' / 'b' / 'e' / 'm' / 'h' for the per-category fan-out. Defaults
   *  to undefined = no category filter, show all gtrends signals.
   *  Only meaningful when filters.sources includes 'google_trends'. */
  gtrendsCategory?: string;
  /** When true, this column TAPS the trend stream without participating in
   *  the cross-column claim phase — same behavior as Alerts / Risk Watch
   *  / Decay Watch / Crisis Watch / Compliance Hold. Use for "show me
   *  everything" catch-all panels (e.g. an all-categories Google Trends
   *  column alongside the specific category columns) where duplication
   *  with other lanes is acceptable because the operator wants the
   *  unfiltered view as a reference. */
  observerOnly?: boolean;
}

export interface BoardConfig {
  id: string;
  name: string;
  ownerId: string;
  columns: ColumnConfig[];
  shared: boolean;
}

export type ActionType =
  | 'save'
  | 'dismiss'
  | 'snooze'
  | 'follow'
  | 'assign'
  | 'export'
  | 'approve'
  | 'reject'
  | 'generate'
  | 'pin'
  | 'unpin';
