'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

interface TgConn {
  id: string; name: string; defaultChatId: string;
  events: string[]; active: boolean; botTokenMasked: string;
}

const EVENTS = [
  'trend.post_now', 'trend.escalate', 'trend.save',
  'trend.dismiss', 'draft.shipped', 'brand.crisis_toggle',
];

export function TelegramManager({ initial }: { initial: TgConn[] }) {
  const [conns, setConns] = React.useState<TgConn[]>(initial);
  const [name, setName] = React.useState('Default');
  const [token, setToken] = React.useState('');
  const [chatId, setChatId] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>(['trend.post_now', 'draft.shipped']);
  const [busy, setBusy] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  async function add() {
    if (!token || !chatId) return;
    setBusy(true);
    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, botToken: token, defaultChatId: chatId, events: picked }),
    });
    if (res.ok) {
      const created = await res.json();
      setConns([created, ...conns]);
      setToken(''); setChatId(''); setName('Default');
    }
    setBusy(false);
  }

  async function test() {
    if (!token || !chatId) return;
    setTestResult('sending…');
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botToken: token, defaultChatId: chatId }),
    });
    const json = await res.json();
    setTestResult(json.ok ? '✓ message sent' : `✗ ${(json.raw && json.raw.description) ?? 'failed'}`);
  }

  async function remove(id: string) {
    await fetch(`/api/telegram?id=${id}`, { method: 'DELETE' });
    setConns(conns.filter(c => c.id !== id));
  }

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4 space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-ink-100">Telegram</h2>
        <p className="text-2xs text-ink-300">Get trend alerts pushed to a channel or DM. Create a bot via <span className="font-mono text-ink-200">@BotFather</span>, copy the token, find your chat ID via <span className="font-mono text-ink-200">@userinfobot</span> (DM) or by adding the bot to a group.</p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name (optional)"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Default" /></Field>
        <Field label="Bot token"><input value={token} onChange={e => setToken(e.target.value)} className={inputCls} placeholder="123456:ABC-DEF…" type="password" /></Field>
        <Field label="Chat ID"><input value={chatId} onChange={e => setChatId(e.target.value)} className={inputCls} placeholder="-1001234567890 or 12345" /></Field>
      </div>
      <div>
        <div className="text-2xs uppercase tracking-wider text-ink-300 mb-1.5">Subscribe to events</div>
        <div className="flex flex-wrap gap-1.5">
          {EVENTS.map(e => (
            <button key={e} type="button" onClick={() => setPicked(p => p.includes(e) ? p.filter(x => x !== e) : [...p, e])}>
              <Chip tone={picked.includes(e) ? 'flare' : 'neutral'}>{e}</Chip>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={test} disabled={!token || !chatId}>Test message</Button>
        <Button variant="primary" size="sm" onClick={add} disabled={busy || !token || !chatId}>+ Add bot</Button>
        {testResult && <span className="text-2xs text-ink-300 font-mono">{testResult}</span>}
      </div>

      <div className="border-t border-ink-700 pt-3">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-2">Active</h3>
        {conns.length === 0 ? (
          <p className="text-2xs text-ink-400">No Telegram bots connected yet.</p>
        ) : (
          <ul className="space-y-2">
            {conns.map(c => (
              <li key={c.id} className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-800/50 px-3 py-2">
                <Chip tone={c.active ? 'good' : 'neutral'}>{c.active ? 'active' : 'paused'}</Chip>
                <span className="text-sm text-ink-100 truncate">{c.name}</span>
                <span className="text-2xs font-mono text-ink-400">chat <span className="text-ink-200">{c.defaultChatId}</span></span>
                <span className="text-2xs font-mono text-ink-400">token <span className="text-ink-200">{c.botTokenMasked}</span></span>
                <span className="ml-auto text-2xs text-ink-300">{c.events.length} events</span>
                <Button size="xs" variant="ghost" className="text-signal-red" onClick={() => remove(c.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputCls = 'block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
