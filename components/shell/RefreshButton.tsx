'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [last, setLast] = React.useState<{ inserted: number; updated: number; bySource: Record<string, number>; errors: string[] } | null>(null);
  const [showResult, setShowResult] = React.useState(false);

  async function refresh() {
    setBusy(true);
    setLast(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const json = await res.json();
      setLast(json);
      setShowResult(true);
      setTimeout(() => setShowResult(false), 7000);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={refresh} disabled={busy} title="Pull fresh signals from live connectors">
        {busy ? '⟳ Refreshing…' : '⟳ Refresh from web'}
      </Button>
      {showResult && last && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-md bg-ink-800 border border-ink-700 shadow-pop p-3 text-2xs">
          <div className="flex items-center gap-2 mb-2">
            <Chip tone="good">+{last.inserted} new</Chip>
            <Chip tone="info">↻{last.updated} updated</Chip>
          </div>
          {Object.keys(last.bySource).length > 0 && (
            <ul className="space-y-0.5 mb-2 font-mono text-ink-300">
              {Object.entries(last.bySource).map(([k, v]) => (
                <li key={k}>{k}: {v} signal(s)</li>
              ))}
            </ul>
          )}
          {last.errors.length > 0 && (
            <details className="mt-2">
              <summary className="text-signal-amber cursor-pointer">{last.errors.length} connector(s) failed</summary>
              <ul className="mt-1 text-ink-300">{last.errors.map((e, i) => <li key={i} className="font-mono text-[10px]">{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
