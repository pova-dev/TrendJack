import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listTrends } from '@/lib/store';
import { WeightTuner } from '@/components/scoring/WeightTuner';

export default async function ScoringSettings() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const trends = await listTrends(brand.id, { limit: 50 });
  return (
    <div className="p-6 max-w-6xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink-100">Scoring · {brand.name}</h1>
        <p className="text-sm text-ink-300">
          Tune what TrendJack rewards. Changes broadcast to every teammate live.
        </p>
      </header>
      <WeightTuner brand={brand} trends={trends} />
    </div>
  );
}
