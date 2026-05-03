'use client';
import * as React from 'react';
import { focusRing } from '@/lib/utils';

// First-time guided tour. Three quick steps pointing at the surfaces a
// new operator needs to recognize within 30 seconds:
//
//   1. Top bar — live indicator + freshness clock + alerts badge
//   2. Brand Matches column — your brand-specific lane (vs competitor /
//      generic trending)
//   3. Drawer — click any card to see scores, drafts, research, lineage
//
// Dismissed via localStorage flag so the tour fires once per browser.
// Operator can reset by clearing the flag in DevTools or with the
// "Show me the tour again" link in the onboard footer.
//
// Implementation: simple modal-style steps, no DOM-anchoring (which
// breaks across viewport sizes). Each step has a title + body + an
// arrow pointing at a CSS selector if you want to spotlight it
// — kept minimal here. Tailwind only; no Shepherd.js dep.

const FLAG_KEY = 'tj_tour_completed_v1';

const STEPS = [
  {
    title: 'Welcome to your war room',
    body: 'Every column is a filtered view of trends scored against your brand. Drag column headers to reorder. The leftmost columns claim trends first when categories overlap.',
    cta: 'Got it →',
  },
  {
    title: 'Brand Matches is your home base',
    body: 'It only shows trends that mention YOUR brand keywords. The other columns show competitor mentions, rising velocity, and category-trending content. Add product names + variants in /brand → Brand keywords.',
    cta: 'Next →',
  },
  {
    title: 'Click any card',
    body: 'The drawer opens with five tabs: Overview (why now), Scores (the math), Drafts (AI-generated copy), Research (verified facts with citations), and Lineage (where the trend started). Battle Card appears when a competitor claimed it first.',
    cta: 'Start using TrendJack',
  },
] as const;

export function GuidedTour() {
  const [step, setStep] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const completed = window.localStorage.getItem(FLAG_KEY);
    if (!completed) {
      // Open immediately on first paint (was 600ms — caused operator to
      // start clicking cards then have a modal hijack focus mid-action,
      // per Round-2 Visual Auditor finding). The dashboard underneath is
      // gated via pointer-events-none below so an early click on a card
      // can't fire while the tour is showing.
      setStep(0);
    }
  }, []);

  // Block pointer events on the underlying dashboard while the tour is
  // open. Operators can still scroll (no body lock — that's user-hostile)
  // but click handlers on cards / buttons / etc. are short-circuited
  // until the operator dismisses or completes the tour.
  React.useEffect(() => {
    if (step === null) return;
    document.body.style.cursor = 'default';
    const main = document.querySelector('main');
    main?.classList.add('pointer-events-none');
    return () => { main?.classList.remove('pointer-events-none'); };
  }, [step]);

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FLAG_KEY, '1');
    }
    setStep(null);
  }

  function next() {
    if (step === null) return;
    if (step + 1 >= STEPS.length) dismiss();
    else setStep(step + 1);
  }

  if (step === null) return null;
  const s = STEPS[step];

  return (
    <div
      // pointer-events-auto restores click-handling for the overlay +
      // children. The dashboard <main> is gated `pointer-events-none`
      // while the tour is open, but the GuidedTour itself mounts inside
      // <main>, so without this auto-override the modal would inherit
      // the disabled state and the "Got it" button wouldn't fire.
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 motion-safe:transition-opacity pointer-events-auto"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tj-tour-title"
    >
      <div
        className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl bg-ink-900 border border-ink-700 shadow-pop p-5 m-2"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xs font-mono text-ink-400 uppercase tracking-wider">
            Step {step + 1} of {STEPS.length}
          </span>
          <button
            onClick={dismiss}
            className={`ml-auto text-ink-400 hover:text-ink-100 text-lg leading-none w-8 h-8 sm:w-6 sm:h-6 rounded-md ${focusRing}`}
            aria-label="Dismiss tour"
          >×</button>
        </div>
        <h2 id="tj-tour-title" className="text-base font-semibold text-ink-100 mb-1.5">
          {s.title}
        </h2>
        <p className="text-sm text-ink-200 leading-relaxed">{s.body}</p>
        <div className="flex items-center gap-2 mt-4">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={
                  'h-1 w-6 rounded-full ' +
                  (i === step ? 'bg-flare-500' : 'bg-ink-700')
                }
              />
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className={`h-11 sm:h-9 px-3 rounded-md text-sm sm:text-xs font-medium text-ink-300 hover:bg-ink-800 ${focusRing}`}
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className={`h-11 sm:h-9 px-4 rounded-md bg-flare-500 text-ink-950 text-sm font-semibold hover:bg-flare-400 ${focusRing}`}
            >
              {s.cta}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
