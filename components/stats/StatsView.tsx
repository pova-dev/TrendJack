'use client';
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Intelligence, SourceYield } from '@/lib/intelligence';

// Where signal comes from, who is taking the space, and what the funnel loses.
//
// The rule this page follows: no figure appears without what it means. A table
// of rates is data; naming which source converts two orders of magnitude better
// than another is a finding, and a strategy page that only produces the former
// gets read once.

export function StatsView({
  intel, verdict, brandName,
}: {
  intel: Intelligence;
  verdict: { best: SourceYield; worst: SourceYield; ratio: number } | null;
  brandName: string;
}) {
  return (
    <div className="flex-1 overflow-y-auto tj-scroll">
      <div className="tj-stagger mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 pb-28 sm:pb-10">
        <header>
          <p className="text-2xs font-mono uppercase tracking-widest text-ink-400">Intelligence</p>
          <h1 className="mt-1 text-xl sm:text-2xl font-semibold text-ink-100">
            What the data says about {brandName}
          </h1>
          <p className="mt-1.5 text-sm text-ink-400">
            Computed from {intel.totalSignals.toLocaleString('en-US')} signals collected so far. No estimates.
          </p>
        </header>

        {verdict && <Verdict verdict={verdict} />}

        <Section
          title="Where useful signal comes from"
          caption="Volume and yield are different things. The column that matters is how often a source produces something worth acting on."
        >
          <SourceTable sources={intel.sources} />
        </Section>

        <Section
          title="Who owns the conversation"
          caption="How often each rival is named in signals your brand is tracking. Share of mentions, not share of market."
        >
          <RivalBars rivals={intel.rivals} />
        </Section>

        <Section
          title="What your keywords actually catch"
          caption="Configured terms, ranked by how often they matched. A term that never matches is either worded wrong or nobody is saying it."
        >
          <Keywords keywords={intel.keywords} />
        </Section>

        <Section
          title="What the funnel loses"
          caption="Every stage from collection to a recorded result. The drop between two stages is where attention is going missing. Stages marked cumulative count all time, so they can exceed a stage above that judges only the present."
        >
          <FunnelChart funnel={intel.funnel} />
        </Section>

        <Section
          title={`When signal arrives (${intel.timezone.label})`}
          caption="Local hour of first sighting. Useful for deciding when someone should be watching."
        >
          <HourChart data={intel.arrivalByHour} tz={intel.timezone.label} />
        </Section>
      </div>
    </div>
  );
}

/** The headline finding, stated as a sentence rather than left in a table. */
function Verdict({ verdict }: { verdict: { best: SourceYield; worst: SourceYield; ratio: number } }) {
  const { best, worst, ratio } = verdict;
  const multiple = Number.isFinite(ratio) ? `${Math.round(ratio)}×` : 'far';

  return (
    <div className="mt-6 rounded-lg border border-flare-500/30 bg-flare-500/[0.06] p-4 sm:p-5">
      <p className="text-2xs font-mono uppercase tracking-widest text-flare-400">Headline</p>
      <p className="mt-2 text-sm sm:text-base text-ink-100 leading-relaxed text-balance">
        <span className="font-mono">{best.source}</span> produces something worth acting on{' '}
        <span className="font-semibold text-flare-400">{multiple} more often</span> than{' '}
        <span className="font-mono">{worst.source}</span>
        {best.confident ? '' : ', though on a small sample so far'}.
      </p>
      <p className="mt-2 text-xs text-ink-400 leading-relaxed max-w-prose">
        {worst.source} is {pct(worst.intakeShare)} of everything collected and converts at{' '}
        {pct(worst.actionableRate, 2)}. {best.source} is {pct(best.intakeShare)} of intake and converts at{' '}
        {pct(best.actionableRate, 2)}.{' '}
        {best.signals < 100
          ? `Only ${best.signals} signals have come from it, so the obvious move is to feed it more and see whether the rate holds.`
          : 'Weighting collection toward it would raise the yield of everything downstream.'}
      </p>
    </div>
  );
}

function SourceTable({ sources }: { sources: SourceYield[] }) {
  const maxAct = Math.max(...sources.map(s => s.actionableRate), 0.0001);

  return (
    <div className="overflow-x-auto tj-scroll rounded-lg border border-ink-700 bg-ink-850">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-2xs font-mono uppercase tracking-wider text-ink-500 border-b border-ink-700">
            <th className="text-left font-normal px-3 py-2">Source</th>
            <th className="text-right font-normal px-3 py-2">Signals</th>
            <th className="text-right font-normal px-3 py-2">Avg score</th>
            <th className="text-right font-normal px-3 py-2">Brand hits</th>
            <th className="text-left font-normal px-3 py-2 w-[30%]">Actionable</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {sources.map(s => (
            <tr key={s.source} className="hover:bg-ink-800/50 motion-safe:transition-colors">
              <td className="px-3 py-2.5">
                <span className="font-mono text-xs text-ink-100">{s.source}</span>
                {!s.confident && (
                  <span className="ml-2 text-[10px] font-mono text-ink-600" title="Too few signals to be confident">
                    thin
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-ink-300">
                {s.signals.toLocaleString('en-US')}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-ink-300">
                {s.avgOpportunity.toFixed(0)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-ink-300">
                {pct(s.brandRelevantRate)}
              </td>
              <td className="px-3 py-2.5">
                {/* Bar scaled to the best performer, not to 100%. At these
                    rates a 0–100 scale renders every row as an empty track. */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-flare-500 motion-safe:transition-[width] duration-500"
                      style={{ width: `${Math.max(2, (s.actionableRate / maxAct) * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono tabular-nums text-xs text-ink-200 w-12 text-right">
                    {pct(s.actionableRate, 2)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RivalBars({ rivals }: { rivals: Intelligence['rivals'] }) {
  if (rivals.length === 0) {
    return <p className="text-xs text-ink-500">No competitor mentions detected yet.</p>;
  }
  const top = rivals.slice(0, 10);
  const max = top[0].mentions;

  return (
    <ul className="space-y-2">
      {top.map(r => (
        <li key={r.name} className="flex items-center gap-3">
          <span className="w-20 sm:w-24 shrink-0 text-xs text-ink-200 truncate capitalize">{r.name}</span>
          <div className="flex-1 h-5 rounded bg-ink-800 overflow-hidden relative">
            <div
              className="h-full bg-ink-600 motion-safe:transition-[width] duration-500"
              style={{ width: `${(r.mentions / max) * 100}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right font-mono tabular-nums text-xs text-ink-300">
            {r.mentions.toLocaleString('en-US')}
            <span className="text-ink-600 ml-1.5">{pct(r.share)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Keywords({ keywords }: { keywords: Intelligence['keywords'] }) {
  const { hitting, silent } = keywords;
  const max = hitting[0]?.hits ?? 1;

  return (
    <div className="space-y-4">
      {hitting.length === 0 ? (
        <p className="text-xs text-ink-500">No keyword has matched anything yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {hitting.map(k => (
            <li
              key={k.keyword}
              className="flex items-baseline gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5"
              // Weight the border by frequency so the ones carrying the brand
              // are visible without reading every number.
              style={{ borderColor: k.hits / max > 0.5 ? 'rgb(255 106 26 / 0.4)' : undefined }}
            >
              <span className="text-xs font-mono text-ink-100">{k.keyword}</span>
              <span className="text-2xs font-mono tabular-nums text-ink-500">{k.hits}</span>
            </li>
          ))}
        </ul>
      )}

      {silent.length > 0 && (
        <div className="rounded-md border border-ink-700 bg-ink-850 p-3">
          <p className="text-2xs font-mono uppercase tracking-wider text-ink-500">Never matched</p>
          <p className="mt-1.5 text-xs text-ink-300">{silent.join(' · ')}</p>
          <p className="mt-2 text-2xs text-ink-500 leading-relaxed">
            Each of these costs nothing to keep, but a term nobody uses will never surface a trend.
            Worth checking the spelling matches how people actually write it.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The funnel, drawn so the losses are the visible part.
 *
 * Stages are rendered proportional to the widest, which at these ratios means
 * everything after the first is a sliver. That is the honest picture: the
 * collapse between collection and action is the finding.
 */
function FunnelChart({ funnel }: { funnel: Intelligence['funnel'] }) {
  const stages = [
    { label: 'Collected', value: funnel.scanned, note: 'everything ingested' },
    { label: 'Brand relevant', value: funnel.brandRelevant, note: 'mentions a keyword' },
    { label: 'Worth acting on', value: funnel.actionable, note: 'engine says do something' },
    { label: 'Drafted', value: funnel.drafted, note: 'copy written' },
    { label: 'Acted on', value: funnel.actedOn, note: 'a human did something' },
    { label: 'Result recorded', value: funnel.outcomesRecorded, note: 'fed back into scoring' },
  ];
  const max = Math.max(...stages.map(s => s.value), 1);

  return (
    <ul className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const dropped = prev != null && prev > 0 ? 1 - s.value / prev : null;
        return (
          <li key={s.label}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs text-ink-200 w-32 shrink-0">{s.label}</span>
              <span className="font-mono tabular-nums text-sm text-ink-100">
                {s.value.toLocaleString('en-US')}
              </span>
              <span className="text-2xs text-ink-600">{s.note}</span>
              {dropped != null && dropped > 0 && (
                <span className={cn(
                  'ml-auto text-2xs font-mono',
                  dropped > 0.95 ? 'text-signal-amber' : 'text-ink-500',
                )}>
                  −{pct(dropped)}
                </span>
              )}
              {/* A stage can exceed the one above it, and it looks like a bug
                  unless said out loud. Drafts accumulate over the corpus while
                  "worth acting on" is a judgement about right now, so a trend
                  drafted last week that has since decayed still counts here
                  and no longer counts above. */}
              {dropped != null && dropped < 0 && (
                <span className="ml-auto text-2xs font-mono text-ink-600" title="Counted over all time, while the stage above is a judgement about the present">
                  cumulative
                </span>
              )}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-ink-800 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full motion-safe:transition-[width] duration-500',
                  s.value === 0 ? 'bg-signal-amber' : 'bg-ink-500',
                )}
                style={{ width: `${Math.max(s.value === 0 ? 1 : 2, (s.value / max) * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function HourChart({ data, tz }: { data: { hour: number; count: number }[]; tz: string }) {
  const max = Math.max(...data.map(d => d.count), 1);
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);

  return (
    <div>
      <div className="flex items-end gap-[3px] h-24">
        {data.map(d => (
          <div key={d.hour} className="flex-1 flex flex-col justify-end h-full group relative">
            <div
              className={cn(
                'w-full rounded-sm motion-safe:transition-colors',
                d.hour === peak.hour ? 'bg-flare-500' : 'bg-ink-600 group-hover:bg-ink-500',
              )}
              style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
              title={`${String(d.hour).padStart(2, '0')}:00 ${tz} — ${d.count} signals`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-mono text-ink-600">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
      </div>
      <p className="mt-2 text-xs text-ink-400">
        Busiest hour is <span className="font-mono text-ink-200">{String(peak.hour).padStart(2, '0')}:00 {tz}</span>,
        with {peak.count.toLocaleString('en-US')} first sightings.
      </p>
    </div>
  );
}

function Section({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      <p className="mt-0.5 text-2xs text-ink-500 max-w-prose leading-relaxed">{caption}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Rates here span four orders of magnitude, so a fixed precision either
 *  rounds the interesting ones to 0% or gives the large ones false detail. */
function pct(v: number, decimals?: number): string {
  const p = v * 100;
  if (decimals != null) return `${p.toFixed(p < 1 ? 2 : decimals)}%`;
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}
