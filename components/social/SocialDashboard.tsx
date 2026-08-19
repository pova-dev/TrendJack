'use client';
import * as React from 'react';
import type { AccountView } from '@/lib/social/store';
import { Chip } from '@/components/ui/Chip';
import { Sparkline } from './Sparkline';
import { LiveCounter, compact } from './LiveCounter';
import { AddAccountForm } from './AddAccountForm';
import { PlatformGlyph, platformLabel } from './PlatformGlyph';

/** Refresh cadence for the counters. Matches the server poll interval — no
 *  point asking more often than the data can change. */
const REFRESH_MS = 60_000;

export function SocialDashboard({
  initial,
  configured,
}: {
  initial: AccountView[];
  configured: { apify: boolean; youtube: boolean; meta: boolean };
}) {
  const [accounts, setAccounts] = React.useState(initial);
  // `null` until mounted — SSR and first client render must agree.
  const [lastSync, setLastSync] = React.useState<number | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/social/accounts', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json() as { items: AccountView[] };
      setAccounts(json.items);
      setLastSync(Date.now());
    } catch { /* keep showing the last good data */ }
  }, []);

  React.useEffect(() => {
    setLastSync(Date.now());
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const own = accounts.filter(a => a.isOwn);
  const rivals = accounts.filter(a => !a.isOwn);

  if (accounts.length === 0) {
    return <EmptyState configured={configured} onAdded={refresh} />;
  }

  return (
    <div className="space-y-8">
      <SummaryRow own={own} rivals={rivals} lastSync={lastSync} />

      <Section
        title="Your channels"
        note={own.length === 0 ? 'None added yet.' : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {own.map(a => <AccountCard key={a.id} a={a} onChange={refresh} />)}
        </div>
      </Section>

      <Section
        title="Competitors"
        note={rivals.length === 0 ? 'None added yet.' : `${rivals.length} tracked`}
      >
        <CompetitorTable rows={rivals} own={own} />
      </Section>

      <Section title="Add a channel">
        <AddAccountForm onAdded={refresh} />
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- summary */

function SummaryRow({
  own, rivals, lastSync,
}: { own: AccountView[]; rivals: AccountView[]; lastSync: number | null }) {
  const totalOwn = sum(own.map(a => a.followers));
  const deltaOwn = sum(own.map(a => a.followersDelta));
  const awaiting = [...own, ...rivals].filter(a => a.followers == null).length;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Your followers" hint="across all your channels">
        <LiveCounter value={totalOwn} className="text-2xl font-semibold text-ink-100" />
      </Tile>
      <Tile label="Change since last reading" hint="sum across your channels">
        <DeltaText delta={deltaOwn} big />
      </Tile>
      <Tile label="Channels tracked" hint={`${own.length} yours · ${rivals.length} competitors`}>
        <span className="text-2xl font-semibold text-ink-100 tabular-nums">{own.length + rivals.length}</span>
      </Tile>
      <Tile
        label="Data freshness"
        hint={awaiting > 0 ? `${awaiting} awaiting first reading` : 'counters refresh every 15 min'}
      >
        <span className="text-sm font-mono text-ink-200">
          {lastSync == null ? '—' : `synced ${relTimeShort(lastSync)}`}
        </span>
      </Tile>
    </div>
  );
}

function Tile({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-400 mb-2">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-2xs text-ink-400">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- card */

function AccountCard({ a, onChange }: { a: AccountView; onChange: () => void }) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformGlyph platform={a.platform} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink-100 truncate">
              {a.displayName || a.competitorName || a.handle}
            </div>
            <div className="text-2xs font-mono text-ink-400 truncate">@{a.handle}</div>
          </div>
        </div>
        <RemoveButton id={a.id} onRemoved={onChange} />
      </div>

      {a.lastError ? (
        <div className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 px-2.5 py-2 text-2xs text-signal-amber">
          {a.lastError}
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <div>
          <LiveCounter value={a.followers} className="text-2xl font-semibold text-ink-100" />
          <div className="mt-1 flex items-center gap-2">
            <span className="text-2xs font-mono uppercase tracking-wider text-ink-400">followers</span>
            <DeltaText delta={a.followersDelta} />
          </div>
        </div>
        <Sparkline points={a.history.map(h => h.followers)} />
      </div>

      <div className="border-t border-ink-800 pt-3">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-400 mb-2">Latest post</div>
        {a.latestPost ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Likes" value={a.latestPost.likes} />
              <Stat label="Views" value={a.latestPost.views} />
              <Stat label="Comments" value={a.latestPost.commentCount} />
            </div>
            {a.latestPost.caption && (
              <p className="mt-2 text-2xs text-ink-300 line-clamp-2">{a.latestPost.caption}</p>
            )}
          </>
        ) : (
          <p className="text-2xs text-ink-400">
            {a.followers == null ? 'Awaiting first reading.' : 'No post data yet.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** A metric. 0 renders as an em-dash because several platforms genuinely do
 *  not report it (Instagram gives no view count on image posts) — showing
 *  "0 views" would read as a real zero. CLAUDE.md hard-rule 1. */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-sm font-medium text-ink-100 tabular-nums">
        {value > 0 ? compact(value) : '—'}
      </div>
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-400">{label}</div>
    </div>
  );
}

function DeltaText({ delta, big }: { delta: number | null; big?: boolean }) {
  const size = big ? 'text-2xl font-semibold' : 'text-2xs font-mono';
  if (delta == null) return <span className={`${size} text-ink-400`}>—</span>;
  if (delta === 0) return <span className={`${size} text-ink-400`}>no change</span>;
  const up = delta > 0;
  return (
    <span className={`${size} tabular-nums ${up ? 'text-signal-green' : 'text-signal-red'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta).toLocaleString('en-US')}
    </span>
  );
}

/* ------------------------------------------------------------ competitors */

function CompetitorTable({ rows, own }: { rows: AccountView[]; own: AccountView[] }) {
  // Rank everything together so "where do we sit" is answerable at a glance.
  const all = [...rows, ...own]
    .filter(a => a.followers != null)
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));

  if (all.length === 0) {
    return <p className="text-sm text-ink-400">No readings yet — competitors appear here after the first poll.</p>;
  }

  return (
    <div className="rounded-md border border-ink-700 overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-ink-800 text-2xs uppercase tracking-wider text-ink-300">
          <tr>
            <th className="text-left px-3 py-2 w-8">#</th>
            <th className="text-left px-3 py-2">Channel</th>
            <th className="text-left px-3 py-2">Platform</th>
            <th className="text-right px-3 py-2">Followers</th>
            <th className="text-right px-3 py-2">Change</th>
            <th className="text-left px-3 py-2">Trend</th>
            <th className="text-right px-3 py-2">Last post</th>
          </tr>
        </thead>
        <tbody>
          {all.map((a, i) => (
            <tr
              key={a.id}
              className={`border-t border-ink-800 ${a.isOwn ? 'bg-flare-500/5' : ''}`}
            >
              <td className="px-3 py-2 text-2xs font-mono text-ink-400 tabular-nums">{i + 1}</td>
              <td className="px-3 py-2">
                <span className="text-ink-100">{a.competitorName || a.displayName || a.handle}</span>
                {a.isOwn && <Chip tone="flare" className="ml-2">You</Chip>}
              </td>
              <td className="px-3 py-2 text-ink-300 text-2xs">{platformLabel(a.platform)}</td>
              <td className="px-3 py-2 text-right text-ink-100 tabular-nums">
                {a.followers?.toLocaleString('en-US') ?? '—'}
              </td>
              <td className="px-3 py-2 text-right"><DeltaText delta={a.followersDelta} /></td>
              <td className="px-3 py-2"><Sparkline points={a.history.map(h => h.followers)} width={80} height={20} /></td>
              <td className="px-3 py-2 text-right text-2xs text-ink-300 tabular-nums">
                {a.latestPost ? `${compact(a.latestPost.likes)} likes` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------------- empty / util */

function EmptyState({
  configured, onAdded,
}: { configured: { apify: boolean; youtube: boolean; meta: boolean }; onAdded: () => void }) {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-md border border-ink-700 bg-ink-900 p-6">
        <h2 className="text-base font-semibold text-ink-100 mb-1">No channels tracked yet</h2>
        <p className="text-sm text-ink-300 mb-4">
          Add your Instagram, Facebook and YouTube accounts plus the competitors you
          want to watch. Counters refresh every 15 minutes; comments load when you
          ask for them, so they cost nothing to leave running.
        </p>
        <div className="space-y-2">
          <ReadyRow
            ok={configured.youtube}
            label="YouTube"
            okText="Ready — works for your channel and competitors, free."
            missingText="Add YOUTUBE_API_KEY in Settings → Connectors. Free, 10k requests/day."
          />
          <ReadyRow
            ok={configured.meta}
            label="Your Instagram + Facebook"
            okText="Ready — reading your own accounts through the official API."
            missingText="Add META_ACCESS_TOKEN in Settings → Connectors for exact, free data on accounts you own."
          />
          <ReadyRow
            ok={configured.apify}
            label="Competitor Instagram + Facebook"
            okText="Ready — competitor pages will be polled through Apify."
            missingText="Add APIFY_TOKEN and the actor ids in Settings → Connectors. Billed per result."
          />
        </div>
      </div>
      <div className="rounded-md border border-ink-700 bg-ink-900 p-6">
        <h2 className="text-base font-semibold text-ink-100 mb-3">Add your first channel</h2>
        <AddAccountForm onAdded={onAdded} />
      </div>
    </div>
  );
}

function ReadyRow({ ok, label, okText, missingText }: {
  ok: boolean; label: string; okText: string; missingText: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-signal-green' : 'bg-ink-500'}`} />
      <div>
        <span className="text-ink-100">{label}</span>
        <span className="text-ink-400"> — {ok ? okText : missingText}</span>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {note && <span className="text-2xs font-mono text-ink-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function RemoveButton({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/social/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        setBusy(false);
        onRemoved();
      }}
      aria-label="Stop tracking this channel"
      className="text-2xs font-mono text-ink-500 hover:text-signal-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded px-1 disabled:opacity-50"
    >
      remove
    </button>
  );
}

function sum(xs: (number | null)[]): number | null {
  const nums = xs.filter((n): n is number => n != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function relTimeShort(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
