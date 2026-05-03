import * as React from 'react';
import { redirect } from 'next/navigation';
import { createBrandAction } from '@/lib/auth/actions';
import { getCurrentContext } from '@/lib/auth';

export default async function OnboardPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect('/signin');
  if (ctx.brand) redirect('/');

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 py-10">
      <div className="w-full max-w-2xl rounded-xl border border-ink-700 bg-ink-900 p-7 shadow-pop">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-8 h-8 rounded-md bg-flare-500 text-ink-950 font-bold flex items-center justify-center">TJ</span>
          <span className="text-lg font-semibold text-ink-100">TrendJack</span>
        </div>
        <h1 className="text-xl font-semibold text-ink-100 mb-1">Set up your first brand</h1>
        <p className="text-sm text-ink-300 mb-6">
          We&apos;ll seed your war room with category-appropriate signals so you see a working dashboard within seconds.
          Edit anything later from <span className="text-ink-100">/brand</span>.
        </p>
        <form action={createBrandAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand name" name="brandName" required placeholder="e.g. POVA" />
            <Field label="Category" name="category" required placeholder="e.g. Smartphones / Footwear / Fintech" />
          </div>
          <Field label="Tagline (optional)" name="tagline" placeholder="e.g. Built for what's next." />
          <Textarea label="Voice" name="voice" rows={2} placeholder="One line. e.g. Sharp. Direct. Anti-cliché." />
          <Field label="Markets (comma-separated)" name="markets" placeholder="India, SEA, MEA" />
          <Field label="Competitors (comma-separated)" name="competitors" placeholder="Xiaomi, Realme, Samsung" />

          <details className="rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2">
            <summary className="text-xs text-ink-300 cursor-pointer select-none hover:text-ink-100">
              Tone capture (optional)
            </summary>
            <div className="mt-3 space-y-3">
              <Field label="Banned phrases (comma-separated)" name="bannedPhrases"
                placeholder="unleash, level up, dream big" />
              <Field label="Forbidden styles (comma-separated)" name="forbiddenStyles"
                placeholder="lifestyle warmth, motivational cliché, doom messaging" />
              <Field label="Allowed jokes (comma-separated)" name="allowedJokes"
                placeholder="material science nerdery, self-aware luxury" />
            </div>
          </details>

          <div className="grid grid-cols-3 gap-3">
            <Select
              label="Your role"
              name="role"
              options={['owner', 'admin', 'strategist', 'operator', 'approver', 'viewer']}
              defaultValue="owner"
            />
            <Select label="Risk tolerance" name="riskTolerance" options={['low', 'medium', 'high']} defaultValue="medium" />
            <Select label="Approval mode" name="approvalMode" options={['strict', 'moderate', 'fast']} defaultValue="moderate" />
          </div>
          <p className="text-2xs text-ink-400">
            Roles control approval routing once the org has multiple users.
            <span className="text-ink-300"> Owner</span> = full control;{' '}
            <span className="text-ink-300">Strategist</span> = drafts + research;{' '}
            <span className="text-ink-300">Operator</span> = generate + ship;{' '}
            <span className="text-ink-300">Approver</span> = review-only.
          </p>
          <button type="submit" className="w-full h-11 rounded-md bg-flare-500 text-ink-950 font-semibold hover:bg-flare-400 text-sm mt-2">
            Create brand & open war room →
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <input {...props} className="mt-1 block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-flare-500" />
    </label>
  );
}
function Textarea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <textarea {...props} className="mt-1 block w-full px-2.5 py-2 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-flare-500" />
    </label>
  );
}
function Select({ label, options, ...props }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <select {...props} className="mt-1 block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-flare-500 capitalize">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
