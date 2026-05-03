'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

// Calibration Panel — Feature D Phase 2 surface.
//
// Shows the operator what the system has learned from their behavior:
// for each (axis × bucket) pair, how many positive and negative actions
// fed into the estimator, and the resulting multiplier (>1 boosts the
// axis-bucket; <1 drags it). Includes a reset action for owner/admin.

interface Bucket {
  axis: string;
  bucket: string;
  pos: number;
  neg: number;
  multiplier: number;
}
interface Snapshot {
  brandId: string;
  totalEvents: number;
  positiveEvents: number;
  negativeEvents: number;
  buckets: Bucket[];
}

export function CalibrationPanel() {
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [resetting, setResetting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/calibration/snapshot')
      .then(r => r.json())
      .then(j => { if (j && !j.error) setSnap(j); else setErr(j?.error ?? 'fetch_failed'); })
      .catch(e => setErr((e as Error).message));
  }, []);

  async function reset() {
    if (!confirm('Reset the calibration? This deletes every learned correction. Cannot be undone.')) return;
    setResetting(true);
    try {
      const r = await fetch('/api/calibration/reset', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error ?? 'reset_failed'); return; }
      // Refetch
      const s = await fetch('/api/calibration/snapshot').then(x => x.json());
      if (s && !s.error) setSnap(s);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink-100">Calibration (learned from your actions)</h2>
        <Button size="sm" variant="outline" onClick={reset} disabled={resetting || !snap || snap.totalEvents === 0}>
          {resetting ? '… resetting' : '↻ Reset'}
        </Button>
      </div>
      <p className="text-2xs text-ink-300 mb-3">
        Every save / dismiss / approve / reject teaches the system which trends to surface vs hide.
        Multipliers above 1.0 mean the axis-bucket is BOOSTED for you; below 1.0 means DRAGGED. CVS / Jacking Score is
        never affected — only ranking. Boosts are clamped to <span className="font-mono">[0.5, 1.5]</span> and require
        ≥5 observations before they activate.
      </p>

      {err && <p className="text-2xs text-bad-400 mb-2">⚠ {err}</p>}

      {!snap ? (
        <p className="text-2xs text-ink-400 italic">Loading…</p>
      ) : snap.totalEvents === 0 ? (
        <p className="text-2xs text-ink-400">
          No actions yet. As you save / dismiss trends, the system will start learning your preferences.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3 text-2xs text-ink-300">
            <span><span className="font-mono text-ink-100">{snap.totalEvents}</span> events</span>
            <span className="text-good-400">✓ {snap.positiveEvents}</span>
            <span className="text-bad-400">✗ {snap.negativeEvents}</span>
          </div>

          {snap.buckets.length === 0 ? (
            <p className="text-2xs text-ink-400 italic">
              Buckets are still building — need at least 5 observations per (axis × bucket) before multipliers activate.
            </p>
          ) : (
            <table className="w-full text-2xs">
              <thead className="text-ink-400">
                <tr>
                  <th className="text-left py-1">axis</th>
                  <th className="text-left py-1">bucket</th>
                  <th className="text-right py-1">+/-</th>
                  <th className="text-right py-1">×</th>
                </tr>
              </thead>
              <tbody>
                {snap.buckets.map(b => (
                  <tr key={`${b.axis}:${b.bucket}`} className="border-t border-ink-800">
                    <td className="py-1 font-mono text-ink-200">{b.axis}</td>
                    <td className="py-1 text-ink-200">{b.bucket}</td>
                    <td className="py-1 text-right font-mono">
                      <span className="text-good-400">{b.pos}</span>
                      <span className="text-ink-500">/</span>
                      <span className="text-bad-400">{b.neg}</span>
                    </td>
                    <td className="py-1 text-right font-mono">
                      <Chip
                        tone={b.multiplier > 1.05 ? 'good' : b.multiplier < 0.95 ? 'bad' : 'neutral'}
                        className="!text-2xs !px-1.5"
                      >
                        {b.multiplier.toFixed(2)}×
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
