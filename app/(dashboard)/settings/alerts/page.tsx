import * as React from 'react';
import { Chip } from '@/components/ui/Chip';

const SAMPLE_RULES = [
  { name: 'POST NOW window opens',           condition: 'recommendation = POST_NOW',                       channel: 'Slack #trendjack-drafts', priority: 'P1' },
  { name: 'Risk spike',                      condition: 'risk > 0.7',                                      channel: 'Slack DM brand-lead',     priority: 'P1' },
  { name: 'Competitor claims our angle',     condition: 'competitorClaimed AND brandFit > 0.7',            channel: 'Slack #competitors',      priority: 'P2' },
  { name: 'Crisis mode trigger',             condition: 'brand_sentiment < -0.5 over 30m',                 channel: 'Slack #crisis',           priority: 'P0' },
];

export default function AlertsSettings() {
  return (
    <div className="p-6 max-w-4xl">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink-100">Alert rules</h1>
        <p className="text-sm text-ink-300">Threshold-based, prioritized P0–P3. Editor + history feed ship in Phase 3.</p>
      </header>
      <div className="rounded-md border border-ink-700 overflow-hidden">
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
  );
}
