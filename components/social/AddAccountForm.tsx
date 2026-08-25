'use client';
import * as React from 'react';
import type { SocialPlatform } from '@/lib/social/types';

const PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'youtube'];

export function AddAccountForm({ onAdded }: { onAdded: () => void }) {
  const [platform, setPlatform] = React.useState<SocialPlatform>('instagram');
  const [handle, setHandle] = React.useState('');
  const [isOwn, setIsOwn] = React.useState(true);
  const [competitorName, setCompetitorName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/social/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, handle, isOwn, competitorName }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? 'Could not add that channel.');
        return;
      }
      setHandle('');
      setCompetitorName('');
      onAdded();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            aria-pressed={platform === p}
            className={`px-3 h-9 sm:h-8 rounded-md border text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 ${
              platform === p
                ? 'border-flare-500 bg-flare-500/10 text-flare-400'
                : 'border-ink-700 bg-ink-800 text-ink-300 hover:text-ink-100'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-[220px]">
          <span className="sr-only">Handle or profile URL</span>
          <input
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder={
              platform === 'youtube' ? '@channel or channel URL'
              : platform === 'facebook' ? 'page name or URL'
              : '@username or profile URL'
            }
            className="w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400"
          />
        </label>

        {!isOwn && (
          <label className="flex-1 min-w-[160px]">
            <span className="sr-only">Competitor name</span>
            <input
              value={competitorName}
              onChange={e => setCompetitorName(e.target.value)}
              placeholder="Label, e.g. iQOO"
              className="w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 placeholder:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400"
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !handle.trim()}
          className="h-9 px-3.5 rounded-md bg-flare-500 text-ink-950 text-sm font-medium disabled:opacity-40 hover:bg-flare-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
        >
          {busy ? 'Adding…' : 'Add channel'}
        </button>
      </div>

      <div className="flex gap-2 text-xs text-ink-300">
        <label className="flex items-center gap-2 cursor-pointer py-2 pr-3 rounded-md min-h-[36px] hover:text-ink-100 transition-colors">
          <input
            type="radio" name="ownership" checked={isOwn} onChange={() => setIsOwn(true)}
            className="accent-flare-500 w-4 h-4"
          />
          Ours
        </label>
        <label className="flex items-center gap-2 cursor-pointer py-2 pr-3 rounded-md min-h-[36px] hover:text-ink-100 transition-colors">
          <input
            type="radio" name="ownership" checked={!isOwn} onChange={() => setIsOwn(false)}
            className="accent-flare-500 w-4 h-4"
          />
          Competitor
        </label>
      </div>

      {error && <p className="text-xs text-signal-red">{error}</p>}
    </form>
  );
}
