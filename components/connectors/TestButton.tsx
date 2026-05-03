'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

interface Sample { title: string; url?: string; velocity: number }
interface OkResult { ok: true; mode: string; ms: number; count: number; sample: Sample[]; connectorId: string }
interface ErrResult { ok: false; mode: string; ms?: number; reason: string; connectorId: string }
type Result = OkResult | ErrResult;

export function TestButton({ source }: { source: string }) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/connectors/test/${source}`, { method: 'POST' });
      setResult(await res.json());
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <Button size="xs" variant="outline" onClick={run} disabled={busy}>
        {busy ? 'Pinging…' : '⟳ Test live'}
      </Button>
      {result && (
        <div className="rounded-md border border-ink-700 bg-ink-950 p-2 text-2xs space-y-1">
          {result.ok ? (
            <>
              <div className="flex items-center gap-2">
                <Chip tone="good">live ok</Chip>
                <span className="font-mono text-ink-300">{result.connectorId}</span>
                <span className="font-mono text-ink-300">{result.ms}ms · {result.count} signal(s)</span>
              </div>
              {result.sample.length > 0 ? (
                <ul className="space-y-0.5">
                  {result.sample.map((s, i) => (
                    <li key={i} className="text-ink-200 truncate">
                      ▲{s.velocity}/h ·{' '}
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-flare-400 hover:underline">{s.title}</a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-400">Connector responded but returned 0 signals (no matches for your brand keywords in the last 24h).</p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Chip tone="bad">failed</Chip>
              <span className="font-mono text-ink-300">{result.connectorId}</span>
              <span className="font-mono text-ink-200">{result.reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
