import * as React from 'react';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { Chip } from '@/components/ui/Chip';
import { requireBrand } from '@/lib/auth';

const SAMPLE_RULES = [
  { name: 'POST NOW window opens',           condition: 'recommendation = POST_NOW',                       channel: 'Slack #trendjack-drafts', priority: 'P1' },
  { name: 'Risk spike',                       condition: 'risk > 0.7',                                      channel: 'Slack DM brand-lead',     priority: 'P1' },
  { name: 'Competitor claims our angle',      condition: 'competitorClaimed AND brandFit > 0.7',            channel: 'Slack #competitors',      priority: 'P2' },
  { name: 'Crisis mode trigger',              condition: 'brand_sentiment < -0.5 over 30m',                 channel: 'Slack #crisis',           priority: 'P0' },
];

export default async function AlertsPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={0}
        postNowCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl">
        <h1 className="text-xl font-semibold text-ink-100 mb-1">Alert rules</h1>
        <p className="text-sm text-ink-300 mb-6">Threshold-based. Prioritized P0–P3. Phase 3 ships the rule editor and history feed.</p>
        <div className="rounded-md border border-ink-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-2xs uppercase tracking-wider text-ink-300">
              <tr>
                <th className="text-left px-3 py-2">Priority</th>
                <th className="text-left px-3 py-2">Rule</th>
                <th className="text-left px-3 py-2">Condition</th>
                <th className="text-left px-3 py-2">Channel</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_RULES.map(r => (
                <tr key={r.name} className="border-t border-ink-700">
                  <td className="px-3 py-2"><Chip tone={r.priority === 'P0' ? 'bad' : r.priority === 'P1' ? 'warn' : 'info'}>{r.priority}</Chip></td>
                  <td className="px-3 py-2 text-ink-100">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-2xs text-ink-300">{r.condition}</td>
                  <td className="px-3 py-2 text-ink-200">{r.channel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
