// Multi-Platform Spillover detector.
//
// Premise: a trend that's rising on Reddit AND X AND TikTok simultaneously
// is structurally more valuable than one stuck on a single platform —
// it's diversified across audiences and lasts longer than 24h.
//
// We track how many distinct sources have surfaced near-identical content
// (matched via the contentFingerprint from src/agents/scout/dedup.ts) within
// a rolling 24h window. The count drives the Sp multiplier in CVS:
//
//     1 source   → Sp = 1.0  (no boost)
//     2 sources  → Sp = 1.15
//     3 sources  → Sp = 1.30
//     4+ sources → Sp = 1.50
//
// The Filter Agent computes this per-tick by grouping recent trends by
// fingerprint and counting unique sources. Output flows into CVS via the
// `crossSourceCount` input on computeJackingScore.

import type { Trend, SourceId } from '@/types';
import { contentFingerprint } from '@/src/agents/scout/dedup';

export interface SpilloverGroup {
  fingerprint: string;
  sources: SourceId[];
  trendIds: string[];
  /** Count for direct use in computeJackingScore({crossSourceCount}) */
  crossSourceCount: number;
}

/**
 * Group a list of trends by content fingerprint and return only those
 * groups that span 2+ distinct sources. Single-source groups are
 * dropped — the caller treats them as crossSourceCount=1 implicitly.
 */
export function detectSpillover(trends: Trend[]): SpilloverGroup[] {
  const byFp = new Map<string, { sources: Set<SourceId>; trendIds: string[] }>();

  for (const t of trends) {
    const fp = contentFingerprint({ title: t.title });
    if (!fp) continue;
    const entry = byFp.get(fp) ?? { sources: new Set<SourceId>(), trendIds: [] };
    entry.sources.add(t.source);
    entry.trendIds.push(t.id);
    byFp.set(fp, entry);
  }

  const groups: SpilloverGroup[] = [];
  for (const [fingerprint, { sources, trendIds }] of byFp) {
    if (sources.size < 2) continue;
    groups.push({
      fingerprint,
      sources: Array.from(sources),
      trendIds,
      crossSourceCount: sources.size,
    });
  }
  return groups;
}

/**
 * Build a lookup map: trendId → crossSourceCount. Trends not in the map
 * have crossSourceCount=1 (single-source, no spillover bonus).
 *
 * The Filter Agent calls this once per tick, then passes the lookup into
 * each per-trend re-score call.
 */
export function buildSpilloverLookup(trends: Trend[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const group of detectSpillover(trends)) {
    for (const id of group.trendIds) {
      out.set(id, group.crossSourceCount);
    }
  }
  return out;
}
