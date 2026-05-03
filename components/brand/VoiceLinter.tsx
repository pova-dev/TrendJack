'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

// Brand Voice Linter — paste-bin component. Operator types/pastes draft
// copy; right pane renders the live cringe + tonalFit scores plus a
// breakdown of which vocab categories triggered. Hits are highlighted
// in the textarea using a layered overlay. Reuses the same scoring
// primitives that filter INCOMING trends so what flags here would also
// flag in production.

interface Hit {
  category: 'banned-phrase' | 'cliché' | 'ad-speak' | 'hype' | 'forced-slang' | 'forbidden-style';
  match: string;
  weight: 'high' | 'medium' | 'low';
}
interface LintResult {
  text: string;
  cringe: number;
  tonalFit: number;
  verdict: 'clean' | 'caution' | 'rewrite' | 'fail';
  hits: Hit[];
  summary: {
    bannedPhrases: number;
    cliche: number;
    adSpeak: number;
    hype: number;
    forcedSlang: number;
    forbiddenStyle: number;
  };
}

const DEBOUNCE_MS = 350;

const VERDICT_TONE: Record<LintResult['verdict'], 'good' | 'flare' | 'warn' | 'bad'> = {
  clean:   'good',
  caution: 'flare',
  rewrite: 'warn',
  fail:    'bad',
};
const VERDICT_LABEL: Record<LintResult['verdict'], string> = {
  clean:   '✓ Clean',
  caution: '⚠ Caution',
  rewrite: '! Rewrite required',
  fail:    '✗ Hard kill',
};

const CATEGORY_LABEL: Record<Hit['category'], string> = {
  'banned-phrase':   'Banned phrase',
  'cliché':          'Cliché',
  'ad-speak':        'Ad-speak',
  'hype':            'Hype',
  'forced-slang':    'Forced slang',
  'forbidden-style': 'Forbidden style',
};

export function VoiceLinter() {
  const [text, setText] = React.useState('');
  const [result, setResult] = React.useState<LintResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) { setResult(null); setErr(null); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch('/api/brand/voice-lint', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const j = await r.json();
        if (!r.ok) setErr(j?.error ?? `http_${r.status}`);
        else setResult(j);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text]);

  // Render highlighted text — the textarea overlays a div that draws
  // background-color spans on each hit. Layered behind the input, so
  // the user types as normal but sees the offending tokens shaded.
  const highlighted = React.useMemo(() => {
    if (!result || result.hits.length === 0) return null;
    const lc = text.toLowerCase();
    type Mark = { start: number; end: number; tone: 'high' | 'medium' | 'low' };
    const marks: Mark[] = [];
    for (const hit of result.hits) {
      const needle = hit.match.toLowerCase();
      let idx = lc.indexOf(needle);
      while (idx !== -1) {
        marks.push({ start: idx, end: idx + needle.length, tone: hit.weight });
        idx = lc.indexOf(needle, idx + needle.length);
      }
    }
    marks.sort((a, b) => a.start - b.start);
    // Merge overlapping marks
    const merged: Mark[] = [];
    for (const m of marks) {
      const last = merged[merged.length - 1];
      if (last && m.start <= last.end) {
        last.end = Math.max(last.end, m.end);
        if (m.tone === 'high' || (m.tone === 'medium' && last.tone === 'low')) {
          last.tone = m.tone;
        }
      } else {
        merged.push({ ...m });
      }
    }
    const out: React.ReactNode[] = [];
    let cursor = 0;
    for (const m of merged) {
      if (m.start > cursor) out.push(<span key={`p${cursor}`}>{text.slice(cursor, m.start)}</span>);
      const cls =
        m.tone === 'high'   ? 'bg-bad-500/30 underline decoration-bad-400 decoration-2' :
        m.tone === 'medium' ? 'bg-flare-500/30 underline decoration-flare-400 decoration-2' :
                              'bg-ink-700/60 underline decoration-ink-400 decoration-2';
      out.push(<span key={`m${m.start}`} className={cls}>{text.slice(m.start, m.end)}</span>);
      cursor = m.end;
    }
    if (cursor < text.length) out.push(<span key={`tail`}>{text.slice(cursor)}</span>);
    return out;
  }, [text, result]);

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-ink-100">Brand Voice Linter</h2>
        <span className="text-2xs text-ink-400">scores any draft against your tone profile</span>
      </div>
      <p className="text-2xs text-ink-300 mb-3">
        Paste a draft (or the AI's output before you ship). Live cringe + tonal-fit scores; offending tokens
        get highlighted. Same scoring primitives that filter incoming trends, applied in reverse.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Editor */}
        <div className="relative">
          {highlighted && (
            <div
              aria-hidden
              className="absolute inset-0 px-2.5 py-2 text-sm leading-relaxed text-transparent whitespace-pre-wrap break-words pointer-events-none rounded-md border border-transparent overflow-hidden"
            >
              {highlighted}
            </div>
          )}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste a draft or hook here…"
            rows={10}
            className="relative block w-full px-2.5 py-2 rounded-md bg-ink-800/80 border border-ink-700 text-sm text-ink-100 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 resize-y"
          />
          <p className="mt-1 text-2xs text-ink-500">{text.length} chars · scores update {DEBOUNCE_MS}ms after you stop typing</p>
        </div>

        {/* Result */}
        <div className="space-y-3">
          {!result && !loading && !err && (
            <p className="text-2xs text-ink-400 italic">No draft yet. Type something on the left.</p>
          )}
          {loading && <p className="text-2xs text-ink-400 italic">Scoring…</p>}
          {err && <p className="text-2xs text-bad-400">{err}</p>}
          {result && (
            <>
              <div>
                <Chip tone={VERDICT_TONE[result.verdict]} className="text-xs uppercase tracking-wider">
                  {VERDICT_LABEL[result.verdict]}
                </Chip>
              </div>
              <div className="grid grid-cols-2 gap-2 text-2xs">
                <div className="rounded border border-ink-700 bg-ink-800/40 p-2">
                  <p className="text-ink-400 uppercase tracking-wider mb-0.5">cringe</p>
                  <p className="font-mono text-base text-ink-100">{Math.round(result.cringe * 100)}<span className="text-ink-400 text-xs">/100</span></p>
                </div>
                <div className="rounded border border-ink-700 bg-ink-800/40 p-2">
                  <p className="text-ink-400 uppercase tracking-wider mb-0.5">tonal fit</p>
                  <p className="font-mono text-base text-ink-100">{Math.round(result.tonalFit * 100)}<span className="text-ink-400 text-xs">/100</span></p>
                </div>
              </div>

              {result.hits.length === 0 ? (
                <p className="text-2xs text-good-400 italic">Clean — no vocab hits.</p>
              ) : (
                <div>
                  <p className="text-2xs font-mono text-ink-400 uppercase tracking-wider mb-1.5">hits ({result.hits.length})</p>
                  <ul className="space-y-1 text-2xs max-h-60 overflow-y-auto">
                    {result.hits.map((h, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <Chip
                          tone={h.weight === 'high' ? 'bad' : h.weight === 'medium' ? 'warn' : 'neutral'}
                          className="text-2xs flex-shrink-0"
                        >
                          {CATEGORY_LABEL[h.category]}
                        </Chip>
                        <span className="font-mono text-ink-200 truncate" title={h.match}>{h.match}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
