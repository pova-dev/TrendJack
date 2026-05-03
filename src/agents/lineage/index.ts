// Lineage Agent.
//
// Two responsibilities:
//   1. Trace each trend back to its "Patient Zero" — the earliest
//      sibling across all sources where the same content first appeared.
//      This lets brands join conversations in their purest form, before
//      they become corporate and saturated.
//   2. Compute competitor share-of-voice within a trend's lineage. When
//      a trend's siblings are dominated by competitor mentions (>40%
//      threshold from the audit), the trend is flagged "Dilutive" — the
//      Filter Agent uses this to push SAT high.
//
// The Lineage Agent observes scored trends in batches (it needs cross-
// trend context to detect siblings). Architect (Phase 8) calls it on
// the periodic tick rather than per-trend in the bus loop.

import type { Trend, SourceId } from '@/types';
import { contentFingerprint } from '@/src/agents/scout/dedup';

export interface PatientZero {
  source: SourceId;
  url: string;
  publishedAt: Date;
  excerpt: string;
}

export interface LineageReport {
  trendId: string;
  patientZero: PatientZero;
  siblings: Array<{ source: SourceId; url: string; firstSeenAt: Date }>;
  competitorShareOfVoice: number;
  competitorClaimants: string[];
  isDilutive: boolean;
}

const DILUTIVE_THRESHOLD = 0.40;

/**
 * Group a set of trends by content fingerprint and emit a LineageReport
 * for each group with ≥1 trend. Single-trend groups still produce a
 * report — the trend is its own Patient Zero with no siblings.
 */
export function buildLineageReports(trends: Trend[]): LineageReport[] {
  const byFp = new Map<string, Trend[]>();
  for (const t of trends) {
    const fp = contentFingerprint({ title: t.title });
    if (!fp) continue;
    const list = byFp.get(fp) ?? [];
    list.push(t);
    byFp.set(fp, list);
  }

  const reports: LineageReport[] = [];
  for (const [, group] of byFp) {
    // Earliest by firstSeenAt = Patient Zero
    const sorted = [...group].sort(
      (a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime(),
    );
    const zero = sorted[0];

    // Competitor share-of-voice across the group's competitorClaimants.
    const totalClaimSlots = sorted.length;
    const claimedCount = sorted.filter(t => t.competitorClaimants.length > 0).length;
    const sov = totalClaimSlots === 0 ? 0 : claimedCount / totalClaimSlots;

    // Union of all competitor names mentioned across the group.
    const claimants = Array.from(new Set(
      sorted.flatMap(t => t.competitorClaimants),
    ));

    const patientZero: PatientZero = {
      source: zero.source,
      url: zero.url ?? '',
      publishedAt: new Date(zero.firstSeenAt),
      excerpt: (zero.summary ?? zero.title).slice(0, 200),
    };

    for (const t of sorted) {
      reports.push({
        trendId: t.id,
        patientZero,
        siblings: sorted
          .filter(s => s.id !== t.id)
          .map(s => ({
            source: s.source,
            url: s.url ?? '',
            firstSeenAt: new Date(s.firstSeenAt),
          })),
        competitorShareOfVoice: sov,
        competitorClaimants: claimants,
        isDilutive: sov >= DILUTIVE_THRESHOLD,
      });
    }
  }
  return reports;
}

/** Convenience: build a lookup map for the Filter Agent's enrichSignal hook. */
export function buildLineageLookup(trends: Trend[]): Map<string, LineageReport> {
  const out = new Map<string, LineageReport>();
  for (const r of buildLineageReports(trends)) {
    out.set(r.trendId, r);
  }
  return out;
}
