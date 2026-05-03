import type { ColumnConfig, Trend } from '@/types';

// Apply a column's filter+sort against a flat trend list. Used both server-side
// (when seeding the page) and client-side (when refreshing in-place).
export function applyColumnFilter(col: ColumnConfig, trends: Trend[]): Trend[] {
  const f = col.filters;
  const now = Date.now();

  let items = trends.filter(t => {
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
