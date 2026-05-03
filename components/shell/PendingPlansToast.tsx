'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';

// Pending Plans toast — surfaces the autonomous Composer's output on
// the dashboard. Polls /api/plans?status=pending_approval every 60s and
// shows a stack of cards with verdict / time-to-expiry / quick approve+
// reject. Click into the trend's drawer to review the full plan.
//
// Bottom-right desktop, bottom-sheet on mobile. Auto-hides when there's
// nothing pending. Supersedes existing toast on click; doesn't compete
// with the GuidedTour modal (z-30 vs tour z-50).

interface Plan {
  id: string;
  trendId: string;
  status: string;
  chosenAngleRef: string;
  payload: {
    chosenAngle?: { angle: string; rationale: string; exampleHook: string };
    rationale?: string;
    citationSet?: Array<{ key?: string; sourceUrl?: string }>;
  };
  proposedScheduleAt: string;
  expiresAt: string;
  createdAt: string;
}

const POLL_MS = 60_000;

export function PendingPlansToast() {
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [collapsed, setCollapsed] = React.useState(false);
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch('/api/plans?status=pending_approval&limit=10', { cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { plans: Plan[] };
        if (!cancelled) setPlans(j.plans ?? []);
      } catch { /* poll silently */ }
    }
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  React.useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  async function decide(planId: string, action: 'approve' | 'reject') {
    await fetch(`/api/plans/${planId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, reason: action === 'reject' ? 'Rejected from dashboard toast' : '' }),
    });
    setPlans(prev => prev.filter(p => p.id !== planId));
  }

  if (plans.length === 0) return null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 right-4 z-30 rounded-full h-11 px-4 bg-flare-500 text-ink-950 text-sm font-semibold shadow-pop hover:bg-flare-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
        title="Pending Ship-It Plans"
      >
        ✦ {plans.length} plan{plans.length === 1 ? '' : 's'} pending
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 w-[min(420px,calc(100vw-2rem))]">
      <div className="rounded-xl bg-ink-900 border border-flare-500/40 shadow-pop overflow-hidden">
        <header className="flex items-center justify-between px-3 py-2 border-b border-ink-700 bg-ink-800/50">
          <span className="text-xs font-semibold text-ink-100">
            <span className="text-flare-400">✦</span> {plans.length} Ship-It Plan{plans.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => setCollapsed(true)}
            className="text-ink-400 hover:text-ink-100 text-sm leading-none w-6 h-6 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
            aria-label="Minimize plans toast"
          >−</button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-ink-700">
          {plans.slice(0, 5).map(p => {
            const expiry = now != null ? new Date(p.expiresAt).getTime() - now : 0;
            const expiryLabel = expiry > 3600_000
              ? `${Math.round(expiry / 3600_000)}h`
              : expiry > 0
                ? `${Math.max(1, Math.round(expiry / 60_000))}m`
                : 'expired';
            return (
              <div key={p.id} className="p-3">
                <div className="flex items-start gap-2 mb-1.5">
                  <p className="text-xs text-ink-100 font-semibold flex-1 line-clamp-2">
                    {p.payload.chosenAngle?.angle ?? '(no angle)'}
                  </p>
                  <span className={`text-2xs font-mono flex-shrink-0 ${expiry < 3600_000 ? 'text-bad-400' : 'text-ink-400'}`}>
                    {expiryLabel}
                  </span>
                </div>
                {p.payload.rationale && (
                  <p className="text-2xs text-ink-300 mb-2 line-clamp-2">{p.payload.rationale}</p>
                )}
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="primary" onClick={() => decide(p.id, 'approve')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decide(p.id, 'reject')}>
                    Reject
                  </Button>
                  <a
                    href={`/?trend=${p.trendId}`}
                    className="ml-auto text-2xs text-flare-400 hover:text-flare-300 font-mono"
                  >
                    review →
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
