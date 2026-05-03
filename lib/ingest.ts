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

  const connectors = [
    new RedditLiveConnector(),
    new HackerNewsConnector(),
    new GoogleNewsConnector(),
    new NitterConnector(),
    new InvidiousConnector(),
    new RsshubConnector(),
    new GoogleTrendsConnector(),
  ];

  const result: IngestResult = { inserted: 0, updated: 0, bySource: {}, errors: [] };
  const all: RawSignal[] = [];

  for (const c of connectors) {
    try {
      const r = await c.poll({ since, brandKeywords, competitors, themes, limit: 50, credentials });
      if (!r.ok) {
        result.errors.push(`${c.id}: ${r.reason}`);
        continue;
      }
      all.push(...r.signals);
      result.bySource[c.id] = r.signals.length;
    } catch (e) {
      result.errors.push(`${c.id}: ${(e as Error).message}`);
    }
  }

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
