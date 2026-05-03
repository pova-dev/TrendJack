'use client';
import * as React from 'react';
import type { BrandProfile } from '@/types';
import { WatchlistEditor } from '@/components/brand/WatchlistEditor';

// Watchlist page — operator-curated taxonomy that drives every connector
// query, brand-fit gate, and column filter. Phase 5 deliverable.
//
// Wire: same autosave path as the brand editor (PUT /api/brand). The
// SSE bus broadcasts and other tabs refetch.

export default function WatchlistPage() {
  const [brand, setBrand] = React.useState<BrandProfile | null>(null);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debouncer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(b => setBrand(b));

    const es = new EventSource('/api/brand/stream');
    const onChange = async () => {
      const r = await fetch('/api/brand', { cache: 'no-store' });
      if (r.ok) setBrand(await r.json());
    };
    es.addEventListener('brand.profile_changed', onChange);
    return () => es.close();
  }, []);

  function patchAndSave(patch: Partial<BrandProfile>) {
    if (!brand) return;
    setBrand({ ...brand, ...patch });
    setSaveState('saving');
    if (debouncer.current) clearTimeout(debouncer.current);
    debouncer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/brand', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1000);
      } catch {
        setSaveState('error');
      }
    }, 600);
  }

  if (!brand) {
    return <div className="p-6 text-sm text-ink-300">Loading watchlist…</div>;
  }

  return (
    <div className="p-6 max-w-3xl">
      <header className="mb-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-ink-100">Watchlist</h1>
          <span className="text-2xs font-mono uppercase tracking-wider text-ink-400">
            {saveState === 'idle' ? 'autosave on'
             : saveState === 'saving' ? 'saving…'
             : saveState === 'saved' ? '✓ saved'
             : '✗ save failed'}
          </span>
        </div>
        <p className="text-sm text-ink-300 mt-1">
          The unified taxonomy of what your war room watches. Every connector
          query, scoring rule, and column filter reads from here.
        </p>
      </header>
      <WatchlistEditor brand={brand} onPatch={patchAndSave} />
    </div>
  );
}
