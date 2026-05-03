import * as React from 'react';
import { listTrends, getDefaultBoard, getBrand, listBrandsForOrg } from '@/lib/store';
import { listConnectors } from '@/lib/connectors';
import { Board } from '@/components/board/Board';
import { TopBar } from '@/components/shell/TopBar';
import { ConnectorStatusBar } from '@/components/shell/ConnectorStatusBar';
import { AiSetupBanner } from '@/components/shell/AiSetupBanner';
import { requireBrand } from '@/lib/auth';
import { AddColumnButton } from '@/components/shell/AddColumnButton';
import { GuidedTour } from '@/components/shell/GuidedTour';
import { getOrgCredentials } from '@/lib/credentials';
import { aiHealth } from '@/lib/ai/provider';

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

  const connectorStatuses = listConnectors().map(c => ({
    source: c.source,
    mode: c.mode,
    ok: true,
    lastRunAt: new Date().toISOString(),
  }));

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
      <GuidedTour />
    </>
  );
}
