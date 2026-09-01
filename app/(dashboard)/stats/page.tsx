import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand } from '@/lib/store';
import { buildIntelligence, sourceVerdict } from '@/lib/intelligence';
import { StatsView } from '@/components/stats/StatsView';

// Strategy intelligence over the whole corpus.
//
// The board answers "what is happening", the landing view answers "what do I
// do today". This answers the questions above both: which sources are worth
// collecting from, who is occupying the conversation, and where the funnel
// leaks. All of it is arithmetic over rows already stored, so it works with no
// API keys and cannot report a number nobody measured.

export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;

  const intel = await buildIntelligence(brand.id);

  return (
    <StatsView
      intel={intel}
      verdict={sourceVerdict(intel.sources)}
      brandName={brand.name}
    />
  );
}
