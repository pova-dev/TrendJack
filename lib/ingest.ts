// Ingest pipeline: pull from all live connectors, score, persist, broadcast.
// Dedupes by `externalId` so polling the same hour doesn't double-insert.
//
// Velocity-delta is captured: if we've seen this trend before, store the
// delta vs prior poll so the UI can render a ▲/▼ chip.

import { prisma } from './db';
import { score, type RawSignal } from '@/lib/scoring/engine';
import { getBrand } from './store';
import { getOrgCredentials } from './credentials';
import { RedditLiveConnector } from './connectors/reddit';
import { HackerNewsConnector } from './connectors/hackernews';
import { GoogleNewsConnector } from './connectors/googlenews';
import { NitterConnector } from './connectors/nitter';
import { InvidiousConnector } from './connectors/invidious';
import { RsshubConnector } from './connectors/rsshub';
import { GoogleTrendsConnector } from './connectors/googletrends';
import { publishBrandTrend } from './realtime/bus';
import { runScout, fromConnector } from '@/src/agents/scout/runner';
import { dedupSignals } from '@/src/agents/scout/dedup';

interface IngestResult {
  inserted: number;
  updated: number;
  bySource: Record<string, number>;
  errors: string[];
}

export async function ingestForBrand(brandId: string, orgId?: string): Promise<IngestResult> {
  const brand = await getBrand(brandId);
  if (!brand) throw new Error('brand_not_found');
  // Per-org credentials are merged into every connector poll.
  const credentials = orgId ? await getOrgCredentials(orgId) : {};

  // Three separate query lists — connectors use them as primary fan-out,
  // competitor fan-out, and theme fan-out respectively. Conflating these
  // (the previous "everything in brandKeywords" approach) caused 99% of
  // ingested content to come back as off-topic news because we were
  // searching Google News for generic words like "battery life" and
  // "gaming" instead of specific product terms like "tecno pova".
  const brandKeywords = (brand.brandKeywords && brand.brandKeywords.length > 0
    ? brand.brandKeywords
    : [brand.name]
  ).filter(Boolean).map(s => String(s));
  const competitors = brand.competitors;
  // Themes feed secondary queries — kept short so we don't blow up the
  // request budget. Connectors that support a `themes` opt will fan out;
  // others will ignore it.
  const themes = (brand.safeThemes ?? []).filter(Boolean).slice(0, 6).map(s => String(s));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Phase-3 path: parallel poll via Scout agent + content-fingerprint dedup.
  // The Scout returns RawSignals already deduplicated within a single tick;
  // the persistence loop below still uses externalId-based DB dedup so
  // historical entries (from prior ticks) don't get duplicated either.
  const scoutReport = await runScout(
    {
      brandId,
      brandName: brand.name,
      brandKeywords,
      competitors,
      themes,
      since,
      credentials,
    },
    {
      connectors: [
        fromConnector(new RedditLiveConnector()),
        fromConnector(new HackerNewsConnector()),
        fromConnector(new GoogleNewsConnector()),
        fromConnector(new NitterConnector()),
        fromConnector(new InvidiousConnector()),
        fromConnector(new RsshubConnector()),
        fromConnector(new GoogleTrendsConnector()),
      ],
      perPollTimeoutMs: 15_000,
      // Don't publish to STREAMS.rawSignals yet — the Filter Agent that
      // would consume it lands in Phase 4. Until then we score+persist
      // synchronously here. Keeps behavior identical for the dashboard.
      dryRun: true,
    },
  );

  const result: IngestResult = { inserted: 0, updated: 0, bySource: {}, errors: [] };
  for (const o of scoutReport.outcomes) {
    if (o.ok) {
      result.bySource[o.connectorId] = o.signals.length;
    } else {
      result.errors.push(`${o.connectorId}: ${o.reason}`);
    }
  }
  // Content-fingerprint dedup BEFORE scoring — saves work on duplicates,
  // and means a cross-posted article on Reddit + News + HN ends up as one
  // canonical Trend instead of three near-identical cards.
  const all: RawSignal[] = dedupSignals(scoutReport.signals);

  // Score + persist with dedupe.
  for (const s of all) {
    const sig = await score(s, { brand });
    const externalKey = s.externalId ?? `${s.source}:${s.url}`;

    const existing = await prisma.trend.findFirst({
      where: { brandId, sourceRef: externalKey },
    });

    if (existing) {
      const prevVel = existing.velocity;
      const delta = prevVel > 0 ? (s.velocity - prevVel) / prevVel : 0;
      await prisma.trend.update({
        where: { id: existing.id },
        data: {
          title: s.title,
          summary: s.summary,
          velocity: s.velocity,
          velocityPrev: prevVel,
          velocityDelta: delta,
          reach: BigInt(Math.max(0, Math.round(s.reach))),
          sentiment: s.sentiment,
          scores: JSON.stringify(sig.scores),
          rationale: JSON.stringify(sig.rationale),
          recommendation: sig.recommendation,
          recommendationReason: sig.recommendationReason,
          peakWindowEnd: sig.peakWindowEnd,
          competitorClaimed: s.competitorClaimants.length > 0,
          competitorClaimants: JSON.stringify(s.competitorClaimants),
          brandKeywordHit: sig.brandKeywordHit,
          matchedBrandKeywords: JSON.stringify(sig.matchedBrandKeywords),
          url: s.url ?? existing.url,
        },
      });
      // Time-series snapshot for long-term monitoring.
      await prisma.trendSample.create({
        data: {
          trendId: existing.id,
          velocity: s.velocity,
          reach: BigInt(Math.max(0, Math.round(s.reach))),
          sentiment: s.sentiment,
          opportunity: sig.scores.opportunity,
          source: s.source,
        },
      });
      result.updated++;
      publishBrandTrend(brandId, { type: 'trend.updated', brandId, trendId: existing.id, reason: 'refresh' });
    } else {
      const created = await prisma.trend.create({
        data: {
          brandId,
          source: s.source,
          sourceRef: externalKey,
          title: s.title,
          summary: s.summary,
          hashtags: JSON.stringify(s.hashtags),
          lineage: s.lineage,
          catalyst: s.catalyst,
          firstSeenAt: s.firstSeenAt,
          peakWindowEnd: sig.peakWindowEnd,
          velocity: s.velocity,
          reach: BigInt(Math.max(0, Math.round(s.reach))),
          sentiment: s.sentiment,
          audienceOverlap: sig.scores.audienceOverlap,
          scores: JSON.stringify(sig.scores),
          rationale: JSON.stringify(sig.rationale),
          recommendation: sig.recommendation,
          recommendationReason: sig.recommendationReason,
          competitorClaimed: s.competitorClaimants.length > 0,
          competitorClaimants: JSON.stringify(s.competitorClaimants),
          brandKeywordHit: sig.brandKeywordHit,
          matchedBrandKeywords: JSON.stringify(sig.matchedBrandKeywords),
          formatFatigue: s.formatFatigue,
          examples: JSON.stringify(s.examples ?? []),
          url: s.url,
        },
      });
      // Initial sample for the time series.
      await prisma.trendSample.create({
        data: {
          trendId: created.id,
          velocity: s.velocity,
          reach: BigInt(Math.max(0, Math.round(s.reach))),
          sentiment: s.sentiment,
          opportunity: sig.scores.opportunity,
          source: s.source,
        },
      });
      result.inserted++;
      publishBrandTrend(brandId, { type: 'trend.created', brandId, trendId: created.id });
    }
  }

  return result;
}
