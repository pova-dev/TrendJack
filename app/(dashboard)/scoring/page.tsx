import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg, listTrends } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { WeightTuner } from '@/components/scoring/WeightTuner';

export default async function ScoringPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);
  const trends = await listTrends(brand.id, { limit: 50 });

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={trends.length}
        postNowCount={trends.filter(t => t.recommendation === 'POST_NOW').length}
      />
      <div className="flex-1 overflow-y-auto p-6 max-w-6xl">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-ink-100">Scoring · {brand.name}</h1>
          <p className="text-sm text-ink-300">Tune what TrendJack rewards. Changes broadcast to every teammate live.</p>
        </header>
        <WeightTuner brand={brand} trends={trends} />
      </div>
    </>
  );
}
