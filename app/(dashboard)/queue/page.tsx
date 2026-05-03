import * as React from 'react';
import { getBrand, listBrandsForOrg, listTrends } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { RecommendationBadge } from '@/components/trend/RecommendationBadge';
import { ScoreChip } from '@/components/trend/ScoreChip';
import { Chip } from '@/components/ui/Chip';
import { sourceLabel } from '@/components/trend/SourceIcon';
import { relTime, timeUntil } from '@/lib/utils';
import { requireBrand } from '@/lib/auth';

export default async function QueuePage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);

  const all = await listTrends(brand.id, {});
  const candidates = all
    .filter(t => t.recommendation === 'POST_NOW' || t.recommendation === 'PREP_1H' || t.recommendation === 'ESCALATE')
    .sort((a, b) => b.scores.opportunity - a.scores.opportunity);

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={candidates.length}
        postNowCount={candidates.filter(t => t.recommendation === 'POST_NOW').length}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-semibold text-ink-100 mb-1">Draft queue</h1>
        <p className="text-sm text-ink-300 mb-6">
          {candidates.length} trend(s) waiting on action. Approval mode is <Chip tone="warn">{brand.approvalMode}</Chip>.
        </p>
        <div className="rounded-md border border-ink-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-2xs uppercase tracking-wider text-ink-300">
              <tr>
                <th className="text-left px-3 py-2">Trend</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Opp</th>
                <th className="text-left px-3 py-2">Recommendation</th>
                <th className="text-left px-3 py-2">Window</th>
                <th className="text-left px-3 py-2">Age</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(t => {
                const peak = timeUntil(t.peakWindowEnd);
                return (
                  <tr key={t.id} className="border-t border-ink-700 hover:bg-ink-800/40">
                    <td className="px-3 py-2 text-ink-100 max-w-md truncate">{t.title}</td>
                    <td className="px-3 py-2 text-ink-300 font-mono text-2xs uppercase">{sourceLabel(t.source)}</td>
                    <td className="px-3 py-2"><ScoreChip axis="opp" value={t.scores.opportunity} /></td>
                    <td className="px-3 py-2"><RecommendationBadge rec={t.recommendation} /></td>
                    <td className="px-3 py-2 font-mono text-2xs text-ink-300">{peak.label}</td>
                    <td className="px-3 py-2 text-ink-400 font-mono text-2xs">{relTime(t.firstSeenAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
