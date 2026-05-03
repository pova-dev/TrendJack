'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

interface CredItem { key: string; mask: string }
interface KeySpec { key: string; label?: string; placeholder?: string; helper?: string; secret?: boolean }

interface Props {
  /** Section heading shown above the editor */
  title: string;
  /** Optional explanatory paragraph */
  subtitle?: string;
  /** Keys to surface */
  keys: KeySpec[];
  /** Server-side current state (mask only) */
  initial: CredItem[];
  /** Optional CTA outside the inline editor (e.g. external signup link) */
  rightSlot?: React.ReactNode;
}

// Compact inline credential editor used on /connectors per source.
// Strict UX: each key has its own [input] [Save | Remove] row.
export function CredentialEditor({ title, subtitle, keys, initial, rightSlot }: Props) {
  const [items, setItems] = React.useState<CredItem[]>(initial);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [savedKey, setSavedKey] = React.useState<string | null>(null);

  function maskFor(k: string) { return items.find(i => i.key === k)?.mask; }
  function isSet(k: string) { return items.some(i => i.key === k); }

  async function reload() {
    const r = await fetch('/api/credentials');
    if (r.ok) setItems(await r.json());
  }

  async function save(k: string) {
    const value = draft[k] ?? '';
    setBusyKey(k);
    try {
      await fetch('/api/credentials', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: [{ key: k, value }] }),
      });
      await reload();
      setDraft(d => ({ ...d, [k]: '' }));
      setSavedKey(k);
      setTimeout(() => setSavedKey(null), 1500);
    } finally { setBusyKey(null); }
  }

  async function remove(k: string) {
    setBusyKey(k);
    try { await fetch(`/api/credentials?key=${k}`, { method: 'DELETE' }); await reload(); }
    finally { setBusyKey(null); }
  }

  return (
    <section className="rounded-md border border-ink-700 bg-ink-900 p-3 space-y-2">
      <header className="flex items-start gap-2">
        <div className="flex-1">
          <h4 className="text-xs font-semibold text-ink-100">{title}</h4>
          {subtitle && <p className="text-2xs text-ink-300 mt-0.5">{subtitle}</p>}
        </div>
        {rightSlot}
      </header>
      <div className="space-y-2">
        {keys.map(spec => {
          const set = isSet(spec.key);
          return (
            <div key={spec.key} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-mono uppercase tracking-wider text-ink-300 w-44 shrink-0 flex items-center gap-1">
                  {spec.key}
                  {set && <Chip tone="good" className="!text-[9px]">set</Chip>}
                </span>
                <input
                  type={spec.secret === false ? 'text' : 'password'}
                  placeholder={set ? maskFor(spec.key) : spec.placeholder ?? 'Paste value'}
                  value={draft[spec.key] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [spec.key]: e.target.value }))}
                  className="flex-1 h-8 px-2 rounded-md bg-ink-800 border border-ink-700 text-xs text-ink-100 font-mono"
                />
                <Button size="xs" variant="primary" disabled={busyKey === spec.key || !draft[spec.key]} onClick={() => save(spec.key)}>
                  {savedKey === spec.key ? '✓' : 'Save'}
                </Button>
                {set && (
                  <Button size="xs" variant="ghost" disabled={busyKey === spec.key} className="text-signal-red" onClick={() => remove(spec.key)}>
                    Remove
                  </Button>
                )}
              </div>
              {spec.helper && <p className="text-[10px] text-ink-400 ml-44 pl-1">{spec.helper}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
