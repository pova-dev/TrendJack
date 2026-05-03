import type { ColumnConfig, Trend, ColumnType, ColumnFilters } from '@/types';

// ──────────────────────────────────────────────────────────────────────
// Cross-column claim priority.
//
// The OPERATOR'S COLUMN ORDER is the priority. Whatever they put first
// claims first. Drag a column left → it claims earlier. This matches how
// kanban-style boards work everywhere: the leftmost lane is the most-
// specific bucket.
//
// Observer columns (Alerts / Risk / Decay / Compliance / Crisis) are
// excluded from the claim phase — they tap the stream and show their
// filtered view independently. Without this, an Alerts column with an
// empty filter (`{}`) would claim everything.
//
// Pinned Watchlist (filters.pinnedOnly) ALSO opts out of being
// claimed-against (a pinned trend always shows there) but it DOES still
// claim from the pool — we don't want a pinned trend to also appear in
// some other column.
// ──────────────────────────────────────────────────────────────────────

// Three tiers:
//   PRIMARY:    columns that EXCLUSIVELY claim a trend (Brand Matches,
//               Competitor Activity, Pinned, Google Trends, any column
//               with a sources/brandKeyword/competitorClaimed/pinnedOnly
//               filter). A trend lands in exactly one primary.
//   SECONDARY:  catch-all "views" (Rising Trends, High Velocity Posts,
//               First-Mover Window). They show their full filtered view
//               but EXCLUDE trends already claimed by a primary lane —
//               so a Samsung article in Competitor Activity doesn't
//               also clutter Rising Trends.
//   OBSERVER:   warning lanes (Alerts, Risk, Decay, Compliance, Crisis).
//               Full filtered view, no exclusion. They tap everything.
const OBSERVER_TYPES = new Set<ColumnType>([
  'alerts', 'risk_watch', 'decay_watch', 'compliance_hold', 'crisis_watch',
]);
const SECONDARY_TYPES = new Set<ColumnType>([
  'rising_trends', 'high_velocity', 'first_mover_window',
  'emerging_memes', 'creator_signals', 'localization_queue',
]);
function isPrimary(col: { type: ColumnType; filters: ColumnFilters }): boolean {
  if (OBSERVER_TYPES.has(col.type) || SECONDARY_TYPES.has(col.type)) return false;
  // Any column with a strong specificity filter qualifies as primary.
  return !!(
    col.filters.brandKeywordOnly ||
    col.filters.competitorClaimed ||
    col.filters.pinnedOnly ||
    (col.filters.sources?.length ?? 0) > 0
  );
}

/**
 * Order columns for the claim phase. Two-tier sort:
 *
 *   1. Source-restricted columns (filters.sources or source-specific
 *      type like Google Trends) claim FIRST. These represent explicit
 *      operator intent — "I want this lane to show ONLY this source" —
 *      and should never be starved by broader catch-alls (Rising
 *      Trends, First-Mover) running earlier in the user-facing order.
 *
 *   2. Within the same specificity tier, preserve the operator's
 *      column ordering as the tiebreaker.
 *
 * Observer types (Alerts / Risk / Decay / Compliance / Crisis) are
 * filtered out — they tap the stream without claiming.
 */
/** Specificity score — lower means more specific, claims earlier.
 *  We count "narrowing" filter knobs and weight them. A column with a
 *  source restriction wins over one with just a velocity threshold;
 *  a column with both reach AND velocity thresholds wins over one
 *  with just velocity. */
function specificityScore(filters: ColumnFilters): number {
  let score = 0;
  if ((filters.sources?.length ?? 0) > 0)        score -= 100;
  if (filters.brandKeywordOnly)                  score -= 60;
  if (filters.competitorClaimed === true)        score -= 60;
  if (filters.firstMoverOnly)                    score -= 50;
  if (filters.pinnedOnly)                        score -= 40;
  if (typeof filters.minReach === 'number')      score -= 15;
  if (typeof filters.minVelocity === 'number')   score -= 15;
  if (typeof filters.minOpportunity === 'number') score -= 10;
  if (typeof filters.maxRisk === 'number')       score -= 5;
  if (typeof filters.maxCringe === 'number')     score -= 5;
  // Stack: minReach + minVelocity together is genuinely narrower than
  // either alone — extra penalty to push High-Velocity-Posts above
  // Rising-Trends in claim order.
  if (typeof filters.minReach === 'number' && typeof filters.minVelocity === 'number') {
    score -= 20;
  }
  return score;
}

export function priorityOrderedColumns<T extends { id: string; type: ColumnType; filters: ColumnFilters }>(cols: T[]): T[] {
  // Only PRIMARY columns participate in the claim phase. Secondary +
  // observer columns are handled separately by assignTrendsToColumns.
  const eligible = cols
    .map((c, idx) => ({ c, idx, score: specificityScore(c.filters) }))
    .filter(({ c }) => isPrimary(c));

  return eligible
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score; // more specific first
      return a.idx - b.idx;                              // tiebreaker: user order
    })
    .map(x => x.c);
}

/**
 * Compute exclusive trend-to-column assignment. Each trend lands in its
 * highest-priority matching CLAIMING column. Observer columns
 * (Alerts / Risk Watch / Decay Watch / Compliance / Crisis) get the
 * full unclaimed view via legacy applyColumnFilter without claimedIds.
 */
export function assignTrendsToColumns(
  cols: ColumnConfig[],
  trends: Trend[],
): Map<string, Trend[]> {
  const claimed = new Set<string>();
  const result = new Map<string, Trend[]>();

  // Phase 1: PRIMARY columns claim exclusively in specificity order.
  for (const col of priorityOrderedColumns(cols)) {
    let matches = applyColumnFilter(col, trends, claimed);
    if (col.filters.clusterSimilar) matches = clusterByBrandKeyword(matches);
    result.set(col.id, matches);
    for (const t of matches) claimed.add(t.id);
  }

  // Phase 2: SECONDARY columns. Each excludes trends already claimed
  // by a primary lane AND by earlier secondaries — so First-Mover
  // Window and Rising Trends don't show the same 3 cards. Order by
  // specificity (more specific claims first):
  //   high_velocity      — minReach + minVelocity (most specific)
  //   first_mover_window — firstMoverOnly + maybe minReach
  //   rising_trends      — just minVelocity (broadest)
  const secondaryCols = cols
    .map((c, idx) => ({ c, idx, score: specificityScore(c.filters) }))
    .filter(({ c }) => SECONDARY_TYPES.has(c.type))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.idx - b.idx;
    });
  for (const { c: col } of secondaryCols) {
    let matches = applyColumnFilter(col, trends, claimed);
    if (col.filters.clusterSimilar) matches = clusterByBrandKeyword(matches);
    result.set(col.id, matches);
    for (const t of matches) claimed.add(t.id);
  }

  // Phase 3: OBSERVER columns (Alerts / Risk / Decay / Compliance /
  // Crisis) — full unfiltered tap, see EVERYTHING matching their filter.
  for (const col of cols) {
    if (!OBSERVER_TYPES.has(col.type)) continue;
    let matches = applyColumnFilter(col, trends);
    if (col.filters.clusterSimilar) matches = clusterByBrandKeyword(matches);
    result.set(col.id, matches);
  }

  return result;
}

// Apply a column's filter+sort against a flat trend list. Used both
// server-side (when seeding the page) and client-side (when refreshing).
//
// `claimedIds` (optional): trends already assigned to a higher-priority
// column. When provided, this column won't show them. Pinned Watchlist
// (filters.pinnedOnly) opts out — pinned trends always show in their
// dedicated lane regardless.
export function applyColumnFilter(
  col: ColumnConfig,
  trends: Trend[],
  claimedIds?: Set<string>,
): Trend[] {
  const f = col.filters;
  const now = Date.now();

  let items = trends.filter(t => {
    if (claimedIds?.has(t.id) && !f.pinnedOnly) return false;
    if (f.sources?.length && !f.sources.includes(t.source)) return false;
    if (f.recommendations?.length && !f.recommendations.includes(t.recommendation)) return false;
    if (typeof f.minOpportunity === 'number' && t.scores.opportunity < f.minOpportunity) return false;
    if (typeof f.maxRisk === 'number' && t.scores.risk > f.maxRisk) return false;
    if (typeof f.maxCringe === 'number' && t.scores.cringe > f.maxCringe) return false;
    if (typeof f.competitorClaimed === 'boolean' && t.competitorClaimed !== f.competitorClaimed) return false;
    if (f.firstMoverOnly && (t.scores.firstMover < 0.6 || t.competitorClaimed)) return false;
    if (f.bannedTopicSafe && t.scores.topicalFit === 0) return false;
    if (f.decay) {
      const peak = t.peakWindowEnd ? new Date(t.peakWindowEnd).getTime() : 0;
      const start = new Date(t.firstSeenAt).getTime();
      const ratio = (now - start) / Math.max(peak - start, 1);
      if (ratio <= 0.7) return false;
    }
    if (f.search) {
      const q = f.search.toLowerCase();
      const blob = (t.title + ' ' + t.summary + ' ' + t.hashtags.join(' ')).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (f.keywordInclude?.length || f.keywordExclude?.length) {
      const blob = (t.title + ' ' + t.summary + ' ' + t.lineage + ' ' + t.hashtags.join(' ')).toLowerCase();
      if (f.keywordInclude?.length) {
        const any = f.keywordInclude.some(k => blob.includes(k.toLowerCase()));
        if (!any) return false;
      }
      if (f.keywordExclude?.length) {
        const hit = f.keywordExclude.some(k => blob.includes(k.toLowerCase()));
        if (hit) return false;
      }
    }
    if (f.hashtags?.length) {
      const has = f.hashtags.some(h => t.hashtags.map(x => x.toLowerCase()).includes(h.toLowerCase()));
      if (!has) return false;
    }
    if (f.subreddits?.length && t.source === 'reddit') {
      const blob = t.lineage.toLowerCase();
      const has = f.subreddits.some(s => blob.includes('r/' + s.toLowerCase()));
      if (!has) return false;
    }
    if (typeof f.windowHours === 'number') {
      const ageHours = (Date.now() - new Date(t.firstSeenAt).getTime()) / 3_600_000;
      if (ageHours > f.windowHours) return false;
    }
    if (typeof f.windowDays === 'number') {
      const ageDays = (Date.now() - new Date(t.firstSeenAt).getTime()) / (24 * 3_600_000);
      if (ageDays > f.windowDays) return false;
    }
    if (typeof f.minVelocity === 'number' && t.velocity < f.minVelocity) return false;
    if (typeof f.minReach === 'number' && t.reach < f.minReach) return false;
    // Brand-keyword gate: a trend's title/summary must mention one of the
    // brand's tracked keywords. This is what makes "Brand Matches" actually
    // about the BRAND, not just any topical-fit signal.
    if (f.brandKeywordOnly && !t.brandKeywordHit) return false;
    // Pinned trends belong EXCLUSIVELY to the dedicated Pinned Watchlist
    // column. Pinning a trend moves it there — the original column it
    // came from no longer shows it (no duplication across the board).
    if (f.pinnedOnly && !t.pinned) return false;
    if (!f.pinnedOnly && t.pinned) return false;
    if (f.newsAllow?.length && t.source === 'news' && t.url) {
      try {
        const host = new URL(t.url).hostname.toLowerCase();
        if (!f.newsAllow.some(d => host.includes(d.toLowerCase()))) return false;
      } catch { /* skip */ }
    }
    if (f.newsDeny?.length && t.source === 'news' && t.url) {
      try {
        const host = new URL(t.url).hostname.toLowerCase();
        if (f.newsDeny.some(d => host.includes(d.toLowerCase()))) return false;
      } catch { /* skip */ }
    }
    // Column-type-specific implicit filters. Thresholds are deliberately
    // permissive — a niche brand sees fewer perfect-match trends, so we
    // err on showing more rather than empty columns. Users can tighten
    // via the column builder.
    if (col.type === 'risk_watch' && t.scores.risk < 0.5) return false;
    if (col.type === 'high_velocity' && t.velocity < 100) return false;       // was 200
    if (col.type === 'brand_matches' && t.scores.brandFit < 0.40) return false; // was 0.55
    if (col.type === 'competitor_activity' && !t.competitorClaimed) return false;

    // ─── Auto-quarantine ────────────────────────────────────────────────
    // Only TOXIC signals get quarantined — election stories, banned
    // topics, cringe traps, competitor-doubled trends. Plain "off-brand
    // but harmless" trends (IGNORE due to low brand-fit alone) still
    // show in Rising / High Velocity / etc. for peripheral awareness.
    //
    // Quarantine columns (risk_watch, compliance_hold, crisis_watch,
    // alerts) opt out of this rule and see everything.
    const QUARANTINE_COLUMN_TYPES = new Set([
      'risk_watch', 'compliance_hold', 'crisis_watch', 'alerts',
    ]);
    if (!QUARANTINE_COLUMN_TYPES.has(col.type)) {
      // ESCALATE always quarantined — needs human review.
      if (t.recommendation === 'ESCALATE')        return false;
      // Hard risk floor — election rally et al.
      if (t.scores.risk >= 0.7)                   return false;
      // Banned-topic hits — engine zeros topicalFit.
      if (t.scores.topicalFit === 0)              return false;
      // Cringe trap — engine flags as IGNORE; we hide it from main lanes.
      if (t.scores.cringe > 0.7)                  return false;
      // Already claimed by 2+ competitors — dilutive to chase.
      if (t.competitorClaimants.length >= 2)      return false;
      // NOTE: plain IGNORE due to low brand-fit IS shown in main columns.
      // Operators want peripheral awareness — they may pivot a low-fit
      // trend or just enjoy seeing the broader landscape. Brand Matches
      // applies its own brand-fit floor below.
    }

    // ─── Decay auto-move ────────────────────────────────────────────────
    // Trends past 70% of their estimated peak life are hidden from every
    // column EXCEPT decay_watch (or columns that explicitly opted in via
    // filters.decay). Keeps main columns fresh.
    //
    // Pinned trends and the dedicated Pinned Watchlist column are exempt:
    // pinning means "I want to track this long-term", which is the whole
    // point of opting out of decay-decay.
    if (col.type !== 'decay_watch' && !f.decay && !f.pinnedOnly && !t.pinned) {
      const peak = t.peakWindowEnd ? new Date(t.peakWindowEnd).getTime() : 0;
      const start = new Date(t.firstSeenAt).getTime();
      const ratio = (now - start) / Math.max(peak - start, 1);
      if (ratio > 0.7) return false;
    }
    return true;
  });

  const k = col.sort.key;
  items.sort((a, b) => {
    // Note: we used to bubble pinned trends to the top of every column,
    // but pin now MOVES the trend to the Pinned Watchlist column
    // exclusively. So a non-watchlist column will never contain a pinned
    // item, and the watchlist column shows only pinned items — no
    // bubble-to-top tiebreak needed.
    const av = pick(a, k);
    const bv = pick(b, k);
    return col.sort.dir === 'desc' ? bv - av : av - bv;
  });

  return items;
}

function pick(t: Trend, k: ColumnConfig['sort']['key']): number {
  if (k === 'velocity') return t.velocity;
  if (k === 'firstSeenAt') return new Date(t.firstSeenAt).getTime();
  if (k === 'reach') return Number(t.reach);
  // numeric Scores key
  return (t.scores[k as keyof typeof t.scores] as number) ?? 0;
}

// ──────────────────────────────────────────────────────────────────────
// Clustering — collapse trends that share the same matchedBrandKeywords
// AND fall within the same 24h bucket into one canonical card.
//
// Rationale: if "Tecno POVA Curve 2 launches" gets covered by 4 news
// outlets within a day, the operator wants to see one card with "+3
// more" not 4 separate cards. The canonical = highest engagement
// (velocity*reach combined). The merged Trend keeps the canonical row
// but exposes `_clusterCount` and `_clusterMembers` (UI uses these to
// render the +N chip and a sub-list).
//
// Used only when ColumnFilters.clusterSimilar=true (Brand Matches).
// ──────────────────────────────────────────────────────────────────────

export type ClusteredTrend = Trend & {
  _clusterCount?: number;
  _clusterMembers?: Trend[];
};

export function clusterByBrandKeyword(trends: Trend[]): ClusteredTrend[] {
  if (trends.length === 0) return [];
  const buckets = new Map<string, Trend[]>();

  for (const t of trends) {
    // Cluster key: normalized brand-keyword set + day bucket.
    // Trends sharing keywords "pova,curve" within the same calendar day
    // all collapse into one cluster.
    const kw = (t.matchedBrandKeywords ?? []).slice().sort().join('|');
    if (!kw) {
      // No matched keywords (legacy row or noise) — render as-is, no cluster.
      buckets.set(`solo:${t.id}`, [t]);
      continue;
    }
    const dayBucket = Math.floor(new Date(t.firstSeenAt).getTime() / (24 * 3_600_000));
    const key = `${kw}:${dayBucket}`;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }

  const out: ClusteredTrend[] = [];
  for (const list of buckets.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    // Pick canonical: highest velocity × reach signal. Ties broken by
    // newest firstSeenAt.
    const sorted = [...list].sort((a, b) => {
      const aScore = a.velocity * (Number(a.reach) || 1);
      const bScore = b.velocity * (Number(b.reach) || 1);
      if (bScore !== aScore) return bScore - aScore;
      return new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime();
    });
    const canonical = sorted[0];
    const others = sorted.slice(1);
    out.push({
      ...canonical,
      _clusterCount: others.length,
      _clusterMembers: others,
    });
  }
  return out;
}

export function columnFiltersToQuery(col: ColumnConfig): string {
  const sp = new URLSearchParams();
  const f = col.filters;
  if (typeof f.minOpportunity === 'number') sp.set('minOpp', String(f.minOpportunity));
  if (typeof f.maxRisk === 'number') sp.set('maxRisk', String(f.maxRisk));
  if (typeof f.maxCringe === 'number') sp.set('maxCringe', String(f.maxCringe));
  if (f.firstMoverOnly) sp.set('firstMoverOnly', 'true');
  if (f.bannedTopicSafe) sp.set('bannedTopicSafe', 'true');
  if (f.decay) sp.set('decay', 'true');
  if (typeof f.competitorClaimed === 'boolean') sp.set('competitorClaimed', String(f.competitorClaimed));
  sp.set('sortBy', col.sort.key);
  sp.set('sortDir', col.sort.dir);
  return sp.toString();
}
