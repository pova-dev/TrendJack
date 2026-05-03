'use client';
import * as React from 'react';
import type { BrandProfile } from '@/types';
import { Chip } from '@/components/ui/Chip';

// Live tone tester. Type/paste a draft post; we score it client-side using
// simplified versions of the engine's tonal+cringe+banned-topic checks so
// strategists can audition copy before shipping.
//
// This is intentionally lightweight — keystroke-fast, no network — and runs
// the same heuristics as lib/scoring/engine.ts. For Phase 3, a `/api/tone`
// endpoint will use Claude for a deeper read.

interface Props {
  brand: BrandProfile;
}

export function ToneTester({ brand }: Props) {
  const [text, setText] = React.useState('');
  const result = React.useMemo(() => analyse(text, brand), [text, brand]);

  return (
    <div className="rounded-md border border-ink-700 bg-ink-800/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300">Live tone tester</h3>
        <span className="text-2xs text-ink-400">runs locally · 0 latency</span>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='Type a draft post. The tester will show how it scores against your brand voice.'
        rows={3}
        className="block w-full px-2.5 py-2 rounded-md bg-ink-900 border border-ink-700 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
      />
      {text.trim().length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Tone fit"  value={result.tone}    invert={false} />
          <Stat label="Risk"      value={result.risk}    invert />
          <Stat label="Cringe"    value={result.cringe}  invert />
        </div>
      )}
      {result.findings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.findings.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-2xs">
              <Chip tone={f.severity === 'bad' ? 'bad' : f.severity === 'warn' ? 'warn' : 'good'}>{f.severity}</Chip>
              <span className="text-ink-200">{f.message}</span>
            </li>
          ))}
        </ul>
      )}
      {text.trim().length === 0 && (
        <p className="text-2xs text-ink-400 mt-2">
          Tip: paste a draft you&apos;re unsure about. We&apos;ll flag banned phrases, cliché triggers, banned topics, and tonal collisions in real time.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, invert }: { label: string; value: number; invert: boolean }) {
  const tone = invert
    ? value > 0.66 ? 'bad' : value > 0.33 ? 'warn' : 'good'
    : value > 0.66 ? 'good' : value > 0.33 ? 'warn' : 'bad';
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-2">
      <div className="text-2xs uppercase tracking-wider text-ink-400">{label}</div>
      <div className="flex items-end justify-between mt-1">
        <span className="text-base font-semibold tabular-nums text-ink-100">{Math.round(value * 100)}</span>
        <Chip tone={tone}>{tone === 'good' ? 'OK' : tone === 'warn' ? 'CAUTION' : 'STOP'}</Chip>
      </div>
    </div>
  );
}

function analyse(text: string, brand: BrandProfile) {
  const findings: { severity: 'good' | 'warn' | 'bad'; message: string }[] = [];
  const blob = text.toLowerCase();

  let tone = 0.6;
  let risk = 0.1;
  let cringe = 0.1;

  // Banned phrases
  const banned = brand.tone.bannedPhrases.filter(p => blob.includes(p.toLowerCase()));
  if (banned.length) {
    tone -= 0.3 * banned.length;
    findings.push({ severity: 'bad', message: `Banned phrase: "${banned[0]}"${banned.length > 1 ? ` (+${banned.length - 1} more)` : ''}` });
  }

  // Banned topics
  const bannedTopics = brand.bannedTopics.filter(t => blob.includes(t.toLowerCase()));
  if (bannedTopics.length) {
    risk += 0.5;
    findings.push({ severity: 'bad', message: `Banned topic detected: ${bannedTopics.join(', ')}` });
  }

  // Cliché markers
  const cliches = ['unleash', 'limitless', 'best version', 'level up', 'redefine', 'reimagined', 'game changer', 'crushing it'];
  const clicheHits = cliches.filter(c => blob.includes(c));
  if (clicheHits.length) {
    cringe += 0.25 * clicheHits.length;
    tone -= 0.2;
    findings.push({ severity: 'warn', message: `Cliché trigger: "${clicheHits[0]}". Could appear unchanged in a competitor ad.` });
  }

  // Generic Gen-Z attempts
  const cringeMarkers = ['rizz', 'how do you do fellow kids', 'literally me', 'main character energy'];
  const cringeHits = cringeMarkers.filter(m => blob.includes(m));
  if (cringeHits.length) {
    cringe += 0.35;
    findings.push({ severity: 'bad', message: 'Forced slang detected. Brand voice rejects this pattern.' });
  }

  // Excessive hashtags
  const hashtagCount = (text.match(/#\w+/g) ?? []).length;
  if (hashtagCount > 5) {
    findings.push({ severity: 'warn', message: `${hashtagCount} hashtags. Brand guideline caps at 3–5.` });
  }

  // Length hint
  if (text.length > 280) {
    findings.push({ severity: 'warn', message: `${text.length} chars. Won't fit X. Trim before posting.` });
  }

  // Positive markers
  const allowedHits = brand.tone.allowedJokes.filter(j => blob.includes(j.toLowerCase()));
  if (allowedHits.length) {
    tone += 0.1 * allowedHits.length;
    findings.push({ severity: 'good', message: `On-theme: ${allowedHits.join(', ')}` });
  }

  return {
    tone: clamp01(tone),
    risk: clamp01(risk),
    cringe: clamp01(cringe),
    findings,
  };
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }
