'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { deleteWithStepUp } from '@/lib/client/step-up';

interface Webhook { id: string; name: string; url: string; events: string[]; active: boolean }

const EVENTS = [
  'trend.save', 'trend.dismiss', 'trend.assign',
  'trend.post_now', 'trend.escalate',
  'draft.generated', 'draft.shipped',
  'brand.profile_changed', 'brand.crisis_toggle',
];

export function WebhookManager({ initial }: { initial: Webhook[] }) {
  const [hooks, setHooks] = React.useState<Webhook[]>(initial);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>(['trend.post_now', 'draft.shipped']);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    if (!url) return;
    setBusy(true);
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || 'Webhook', url, events: picked }),
    });
    if (res.ok) {
      const created = await res.json();
      setHooks([{ id: created.id, name: created.name, url: created.url, events: JSON.parse(created.events), active: created.active }, ...hooks]);
      setName(''); setUrl('');
    }
    setBusy(false);
  }

  async function remove(id: string) {
    const res = await deleteWithStepUp(`/api/webhooks?id=${id}`);
    // Only drop the row once the server confirms. Removing it optimistically
    // made a denied delete look like it worked until the next refresh.
    if (res.ok) { setHooks(hooks.filter(h => h.id !== id)); setError(null); return; }
    if (res.reason !== 'cancelled') setError(res.message ?? 'Could not remove that webhook.');
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div role="alert" className="rounded-md border border-signal-red/40 bg-signal-red/10 px-3 py-2 text-xs text-bad-300">
          {error}
        </div>
      ) : null}
      <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
        <h2 className="text-sm font-semibold text-ink-100 mb-3">Add webhook</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Slack #drafts)"
            className="h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100" />
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…"
            className="col-span-2 h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100" />
        </div>
        <div className="mt-3">
          <div className="text-2xs uppercase tracking-wider text-ink-300 mb-1.5">Fire on events</div>
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map(e => (
              <button key={e} type="button"
                onClick={() => setPicked(p => p.includes(e) ? p.filter(x => x !== e) : [...p, e])}>
                <Chip tone={picked.includes(e) ? 'flare' : 'neutral'}>{e}</Chip>
              </button>
            ))}
          </div>
        </div>
        <Button variant="primary" className="mt-4" onClick={add} disabled={busy || !url}>
          {busy ? 'Saving…' : '+ Add webhook'}
        </Button>
        <p className="mt-2 text-2xs text-ink-400">
          Each delivery includes <code className="text-ink-200 font-mono">X-TrendJack-Signature</code> (HMAC-SHA256) using a per-webhook secret.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-ink-100 mb-2">Active</h2>
        {hooks.length === 0 ? (
          <p className="text-xs text-ink-400">No webhooks yet.</p>
        ) : (
          <ul className="space-y-2">
            {hooks.map(h => (
              <li key={h.id} className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-900 px-3 py-2">
                <Chip tone={h.active ? 'good' : 'neutral'}>{h.active ? 'active' : 'paused'}</Chip>
                <span className="text-sm text-ink-100 truncate">{h.name}</span>
                <span className="text-2xs font-mono text-ink-400 truncate">{h.url}</span>
                <span className="ml-auto text-2xs text-ink-300">{h.events.length} events</span>
                <Button size="xs" variant="ghost" className="text-signal-red" onClick={() => remove(h.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
