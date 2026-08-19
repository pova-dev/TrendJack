import * as React from 'react';
import { listTrends, getDefaultBoard, getBrand, listBrandsForOrg } from '@/lib/store';
import { listConnectors, listConnectorOverview } from '@/lib/connectors';
import { Board } from '@/components/board/Board';
import { TopBar } from '@/components/shell/TopBar';
import { ConnectorStatusBar } from '@/components/shell/ConnectorStatusBar';
import { AiSetupBanner } from '@/components/shell/AiSetupBanner';
import { requireBrand } from '@/lib/auth';
import { AddColumnButton } from '@/components/shell/AddColumnButton';
import { GuidedTour } from '@/components/shell/GuidedTour';
import { PendingPlansToast } from '@/components/shell/PendingPlansToast';
import { getOrgCredentials } from '@/lib/credentials';
import { aiHealth } from '@/lib/ai/provider';
import { getCronStatus } from '@/lib/cron';

export default async function DashboardPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;

  const [board, brands, trends, creds] = await Promise.all([
    getDefaultBoard(brand.id, ctx.user.id),
    listBrandsForOrg(ctx.org!.id),
    listTrends(brand.id, { excludeDismissed: true, limit: 200 }),
    getOrgCredentials(ctx.org!.id),
  ]);
  if (!board) return null;
  const aiConfigured = Object.values(aiHealth(creds)).some(Boolean);

  const postNowCount = trends.filter(t => t.recommendation === 'POST_NOW').length;

  // Audit 2026-05-29 U3 — was hardcoding `ok: true, lastRunAt: now` for
  // every connector regardless of actual state. Now derives status from:
  //   - registry (configured vs. unconfigured)
  //   - getCronStatus() for the last successful ingest tick
  //   - cron lastResult.bySource — if a source returned 0 signals AND has
  //     errors in lastResult, mark it not-ok.
  const cronStatus = getCronStatus();
  const cronLastRunAt = cronStatus.lastRunAt ?? undefined;
  const cronErrors = cronStatus.lastResult?.errors ?? [];
  const overview = listConnectorOverview();
  const overviewBySource = new Map(overview.map(o => [o.source, o] as const));

  const canonicalStatuses = listConnectors().map(c => {
    const ov = overviewBySource.get(c.source);
    const configured = ov && !('unconfigured' in ov.active && ov.active.unconfigured);
    const errored = cronErrors.some(e => e.toLowerCase().includes(c.source));
    return {
      source: c.source,
      mode: c.mode,
      ok: !!configured && !errored,
      lastRunAt: cronLastRunAt,
    };
  });

  // Auxiliary connectors (Meta Ad Library, X-Trending24) — flagged as
  // unknown when we have no cron stats yet, since the canonical cron
  // doesn't yet track them by id.
  const auxStatuses = [
    {
      id: 'x_trending',
      source: 'x' as const,
      label: 'X Trending',
      mode: 'live' as const,
      ok: !!cronLastRunAt,
      lastRunAt: cronLastRunAt,
    },
    {
      id: 'meta_ads_lib',
      source: 'custom' as const,
      label: 'Meta Ads',
      mode: 'live' as const,
      ok: !!cronLastRunAt,
      lastRunAt: cronLastRunAt,
    },
  ];

  const connectorStatuses = [...canonicalStatuses, ...auxStatuses];

  return (
    <>
      <AddColumnButton
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={trends.length}
        postNowCount={postNowCount}
      />
      <AiSetupBanner configured={aiConfigured} />
      <Board initialBoard={board} initialTrends={trends} brandId={brand.id} />
      <ConnectorStatusBar statuses={connectorStatuses} />
      <PendingPlansToast />
      <GuidedTour />
    </>
  );
}
