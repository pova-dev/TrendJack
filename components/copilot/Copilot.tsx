'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cn } from '@/lib/utils';

interface Message { role: 'user' | 'ai'; text: string; provider?: string; model?: string }

const SUGGESTIONS = [
  'What should we post today?',
  'Which trends are too risky for our brand?',
  'Find an angle competitors haven\'t claimed yet.',
  'Summarize the top 3 first-mover opportunities.',
];

export function Copilot() {
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault(); setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setMessages(m => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      setMessages(m => [...m, {
        role: 'ai',
        text: json.reply ?? '(no reply)',
        provider: json.provider,
        model: json.model,
      }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'ai', text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-flare-500 text-ink-950 px-4 py-2.5 shadow-pop hover:bg-flare-400 font-semibold text-sm"
          title="Open AI co-pilot · /"
        >
          <span>✦</span> AI co-pilot
          <kbd className="bg-ink-950/30 text-ink-100 px-1.5 py-0.5 rounded text-2xs font-mono">/</kbd>
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 z-30 w-[420px] max-w-[calc(100vw-2rem)] h-[560px] flex flex-col rounded-xl bg-ink-900 border border-ink-700 shadow-pop">
          <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-ink-700">
            <div className="flex items-center gap-2">
              <span className="text-flare-400">✦</span>
              <h3 className="text-sm font-semibold text-ink-100">AI co-pilot</h3>
              <Chip tone="info">grounded in your brand + live trends</Chip>
            </div>
            <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-100 text-lg leading-none">×</button>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <>
                <p className="text-2xs text-ink-300">
                  Ask about your dashboard. I&apos;ll cite trend numbers and quote scores.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="block w-full text-left text-xs text-ink-200 px-2.5 py-2 rounded-md bg-ink-800 hover:bg-ink-700 border border-ink-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex flex-col gap-1 max-w-[95%]', m.role === 'user' ? 'self-end ml-auto items-end' : 'self-start items-start')}>
                <div className={cn(
                  'px-3 py-2 rounded-lg text-xs whitespace-pre-wrap leading-relaxed',
                  m.role === 'user' ? 'bg-flare-500/15 text-ink-100' : 'bg-ink-800 text-ink-200',
                )}>
                  {m.text}
                </div>
                {m.role === 'ai' && m.provider && (
                  <span className="text-2xs font-mono text-ink-400">{m.provider}{m.model ? ` · ${m.model}` : ''}</span>
                )}
              </div>
            ))}
            {busy && (
              <div className="text-2xs text-ink-400 italic">thinking…</div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); ask(input); }}
            className="border-t border-ink-700 p-3 flex items-center gap-2"
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask anything about your war room…"
              className="flex-1 h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-xs text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy || !input.trim()}>Ask</Button>
          </form>
        </div>
      )}
    </>
  );
}
