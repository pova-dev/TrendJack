'use client';
import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/hooks/use-now';
import type { TodayBrief } from '@/lib/today';

// The landing view.
//
// Layout is mobile-first and driven by content rather than breakpoints where
// possible: the decision list is a single column at every width because it is
// read top to bottom, and the supporting cards are the only thing that gains
// columns on wider screens. Nothing is hidden on small screens; it reflows.

export function TodayView({ brief, brandName }: { brief: TodayBrief; brandName: string }) {
  const hasDecisions = brief.actNow.length > 0 || brief.closingSoon.length > 0;

  return (
    <div className="flex-1 overflow-y-auto tj-scroll">
      {/* pb-28 on mobile keeps the last card clear of the fixed co-pilot pill,
          which otherwise sits on top of it until the user scrolls.
          tj-stagger sequences the direct children in on load. */}
      <div className="tj-stagger mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 pb-28 sm:pb-10">
        <Greeting brandName={brandName} signals={brief.counts.totalSignals} />

        {hasDecisions ? (
          <div className="mt-6 sm:mt-8 space-y-6">
            {brief.actNow.length > 0 && (
              <Section
                title="Act on these now"
                caption={`${brief.actNow.length} of ${brief.counts.totalSignals} signals cleared the bar`}
                tone="urgent"
              >
                {brief.actNow.map((item, i) => (
                  <DecisionRow key={item.trend.id} item={item} rank={i + 1} />
                ))}
              </Section>
            )}

            {brief.closingSoon.length > 0 && (
              <Section
                title="Window closing"
                caption="Lower ranked, but the moment passes within two hours"
                tone="warn"
              >
                {brief.closingSoon.map(item => (
                  <DecisionRow key={item.trend.id} item={item} />
                ))}
              </Section>
            )}
          </div>
        ) : (
          <EmptyDecisions brief={brief} />
        )}

        {/* Supporting cards. One column on a phone, two from tablet up. The
            decision list above deliberately never splits, because a ranked
            list read in order should not become two lists read in parallel. */}
        <div className="mt-6 sm:mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OutcomeCard brief={brief} />
          <CompetitorCard brief={brief} />
        </div>
      </div>
    </div>
  );
}

function Greeting({ brandName, signals }: { brandName: string; signals: number }) {
  const now = useNow();
  // Rendered only after hydration. A date formatted on the server in one
  // timezone and the client in another is the hydration mismatch that
  // CLAUDE.md rule 10 exists to prevent.
  const date = now == null
    ? ' '
    : new Date(now).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header>
      <p className="text-2xs font-mono uppercase tracking-widest text-ink-400 h-4">{date}</p>
      <h1 className="mt-1 text-xl sm:text-2xl font-semibold text-ink-100 text-balance">
        {brandName} today
      </h1>
      <p className="mt-1.5 text-sm text-ink-400">
        {signals.toLocaleString('en-US')} signals scanned since your last visit.
      </p>
    </header>
  );
}

function Section({
  title, caption, tone, children,
}: { title: string; caption: string; tone: 'urgent' | 'warn'; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          aria-hidden="true"
          className={cn('w-1 h-4 rounded-full shrink-0', tone === 'urgent' ? 'bg-flare-500' : 'bg-signal-amber')}
        />
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        <p className="text-2xs text-ink-500">{caption}</p>
      </div>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function DecisionRow({ item, rank }: { item: TodayBrief['actNow'][number]; rank?: number }) {
  const now = useNow();
  const left = closesIn(item.closesAt, now);

  return (
    <li>
      <Link
        href={`/board?trend=${item.trend.id}`}
        className={cn(
          'group relative flex gap-3 rounded-lg border border-ink-700 bg-ink-850 p-3 sm:p-4',
          // Lifts a hair on hover rather than only changing colour. The
          // displacement is what makes a row feel like an object worth
          // clicking; colour alone reads as a highlight.
          'motion-safe:transition-all duration-200 ease-out',
          'hover:border-ink-600 hover:bg-ink-800 hover:-translate-y-px hover:shadow-lg hover:shadow-black/5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400',
        )}
      >
        {rank != null && (
          <span className="shrink-0 w-6 h-6 rounded-full bg-flare-500/15 text-flare-400 text-2xs font-mono font-semibold flex items-center justify-center mt-0.5">
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {/* line-clamp rather than truncate: a headline is the one thing worth
              two lines on a narrow screen. */}
          <p className="text-sm text-ink-100 leading-snug line-clamp-2 group-hover:text-white">
            {item.trend.title}
          </p>
          <p className="mt-1 text-xs text-ink-400 line-clamp-1">{item.reason}</p>
          <div className="mt-2 flex items-center gap-3 flex-wrap text-2xs font-mono text-ink-500">
            <span className="uppercase tracking-wide">{item.trend.source}</span>
            {left && <span className={cn(left.urgent ? 'text-signal-amber' : 'text-ink-500')}>{left.label}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

/**
 * The ROI loop, stated as plainly as it deserves.
 *
 * The system already records post outcomes and learns from them, and not one
 * has ever been entered. Until that changes it is guessing which trends are
 * worth jacking when it could be reading its own history.
 */
function OutcomeCard({ brief }: { brief: TodayBrief }) {
  const { draftsTotal, outcomesRecorded } = brief.counts;
  const pending = brief.awaitingOutcome;

  return (
    <Card title="Did it work?">
      {outcomesRecorded === 0 ? (
        <>
          <p className="text-sm text-ink-300 leading-relaxed">
            {draftsTotal.toLocaleString('en-US')} drafts written.{' '}
            <span className="text-ink-100 font-medium">No results recorded yet.</span>
          </p>
          <p className="mt-2 text-xs text-ink-500 leading-relaxed">
            Scoring improves from what actually happened. Every post you log teaches it
            which calls were right. Nothing is learned from the ones you skip.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-300">
          <span className="text-ink-100 font-medium">{outcomesRecorded}</span> of{' '}
          {draftsTotal.toLocaleString('en-US')} recorded.
        </p>
      )}

      {pending.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-ink-700 pt-3">
          {pending.map(p => (
            <li key={p.draftId}>
              <Link
                href={`/board?trend=${p.trendId}`}
                className="flex items-baseline gap-2 text-xs text-ink-400 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded"
              >
                <span className="text-2xs font-mono uppercase text-ink-600 shrink-0">{p.platform}</span>
                <span className="truncate">{p.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Competitor standing, or an honest account of why there is none.
 *
 * Seven accounts are tracked and none has ever returned a sample, because no
 * Apify token is configured. Rendering that as "0 posts this week" would be a
 * fabricated comparison, which hard-rule 1 forbids.
 */
function CompetitorCard({ brief }: { brief: TodayBrief }) {
  const { tracked, withData, ownAccounts, paused } = brief.competitors;
  const total = tracked + ownAccounts;

  return (
    <Card title="Where you stand">
      {withData === 0 ? (
        <>
          <p className="text-sm text-ink-300 leading-relaxed">
            {total === 0
              ? 'No channels configured yet.'
              : <>{total} {total === 1 ? 'channel' : 'channels'} configured, {tracked} of them competitors.{' '}
                  <span className="text-ink-100 font-medium">
                    {paused === total ? 'All are switched off.' : 'None are returning data.'}
                  </span></>}
          </p>
          <p className="mt-2 text-xs text-ink-500 leading-relaxed">
            {paused === total && total > 0
              ? 'Switched-off channels collect nothing. Turning them on also needs an Apify token and the four actor ids.'
              : 'Collection needs an Apify token and the four actor ids. Until then this stays empty rather than showing numbers nobody measured.'}
          </p>
          <Link
            href="/connectors"
            className="mt-3 inline-block text-xs text-flare-400 hover:text-flare-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded"
          >
            Set up collection →
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-300">
            <span className="text-ink-100 font-medium">{withData}</span> of {total} channels reporting.
          </p>
          <Link href="/social" className="mt-3 inline-block text-xs text-flare-400 hover:text-flare-300">
            Full comparison →
          </Link>
        </>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-ink-700 bg-ink-850 p-4',
        // A hairline highlight along the top edge. It is the cheapest way to
        // give a flat panel a light source, and without one a page of
        // same-coloured rectangles reads as a wireframe.
        'relative overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-px',
        'before:bg-gradient-to-r before:from-transparent before:via-ink-600/60 before:to-transparent',
        'motion-safe:transition-shadow duration-200 hover:shadow-lg hover:shadow-black/5',
      )}
    >
      <h2 className="text-2xs font-mono uppercase tracking-widest text-ink-500">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/**
 * An empty state that diagnoses itself.
 *
 * "Nothing needs a decision" is true but useless: it looks identical whether
 * today was quiet or the ingest is pulling a category the brand does not sell
 * into. Showing how close anything came, and how much of the intake even
 * mentions the brand, is what lets the operator tell those apart. Only they
 * can, so the numbers go to them rather than being silently absorbed.
 */
function EmptyDecisions({ brief }: { brief: TodayBrief }) {
  const { actionableCount, bestOpportunity, floor, brandRelevantShare } = brief.nearMiss;
  const pct = Math.round(brandRelevantShare * 100);
  const offTarget = brandRelevantShare < 0.2;

  return (
    <div className="mt-6 sm:mt-8 rounded-lg border border-dashed border-ink-700 p-5 sm:p-8">
      <p className="text-sm text-ink-100">Nothing clears the bar for acting today.</p>

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <Stat label="scanned" value={brief.counts.totalSignals.toLocaleString('en-US')} />
        <Stat label="actionable" value={actionableCount.toLocaleString('en-US')} />
        <Stat label="best score" value={bestOpportunity == null ? '—' : String(bestOpportunity)} />
        <Stat label="needed" value={String(floor)} />
      </dl>

      <p className="mt-4 text-xs text-ink-500 leading-relaxed max-w-prose">
        {actionableCount === 0
          ? 'No signal was rated as needing action at all. On a quiet day that is the correct answer.'
          : <>{actionableCount} {actionableCount === 1 ? 'signal was' : 'signals were'} worth acting on in principle, but the strongest scored {bestOpportunity} against a bar of {floor}.</>}
      </p>

      {offTarget && (
        <p className="mt-3 text-xs text-signal-amber leading-relaxed max-w-prose">
          Worth checking: only {pct}% of what came in mentions a brand keyword. If most of
          the intake is unrelated news, the Google Trends categories or keyword list are
          pulling a wider net than the brand needs.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-4">
        <Link href="/board" className="text-xs text-flare-400 hover:text-flare-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded">
          Browse everything on the board →
        </Link>
        {offTarget && (
          <Link href="/brand" className="text-xs text-ink-400 hover:text-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded">
            Review keywords →
          </Link>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-mono uppercase tracking-wider text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-lg font-mono tabular-nums text-ink-100 leading-none">{value}</dd>
    </div>
  );
}

/** Time remaining, gated on the shared clock so SSR and the first client
 *  render agree. */
function closesIn(iso: string | undefined, now: number | null): { label: string; urgent: boolean } | null {
  if (!iso || now == null) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { label: 'window closed', urgent: false };
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return { label: `${mins}m left`, urgent: true };
  const hrs = Math.floor(mins / 60);
  return { label: `${hrs}h left`, urgent: hrs < 3 };
}
