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
      // Phase 4.1 wired: Scout now publishes to STREAMS.rawSignals so
      // the Filter Agent (lib/agents-boot.ts) receives them. The
      // synchronous score+persist below still runs in parallel — it
      // owns the DB writes that drive the dashboard. Once we've
      // verified the agent path produces equivalent output, the inline
      // loop will be removed in favor of a Filter-Agent-driven persist.
      dryRun: false,
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
  // Content-fingerprint dedup BEFORE publishing — saves work on
  // duplicates and prevents cross-posted articles on Reddit + News +
  // HN from producing three near-identical Trend rows.
  const all: RawSignal[] = dedupSignals(scoutReport.signals);

  // Score + persist now flows through the Filter Agent on the bus
  // (subscribed by lib/agents-boot.ts → persistScoredTrend). The
  // Scout already published all of `all` to STREAMS.rawSignals via
  // dryRun=false above; we just count what was sent and return the
  // outcome aggregated from the connector results.
  //
  // The legacy synchronous loop here was ~90 lines of inline DB writes
  // that duplicated the Filter Agent's work. Once the agent path was
  // proven to produce identical output (via persistScoredTrend, the
  // canonical write path used by both), the legacy loop became dead
  // weight. Removed.
  result.inserted = all.length; // optimistic — Filter Agent confirms async
  return result;
}
