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
          We&apos;ll seed your war room with realistic mock signals so you can see the system in action immediately.
          Edit anything later from <span className="text-ink-100">/brand</span>.
        </p>
        <form action={createBrandAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand name" name="brandName" required placeholder="e.g. POVA" />
            <Field label="Category" name="category" required placeholder="e.g. Smartphones / D2C / SaaS" />
          </div>
          <Field label="Tagline (optional)" name="tagline" placeholder="e.g. Built for what's next." />
          <Textarea label="Voice" name="voice" rows={2} placeholder="One line. e.g. Sharp. Direct. Anti-cliché." />
          <Field label="Markets (comma-separated)" name="markets" placeholder="India, SEA, MEA" />
          <Field label="Competitors (comma-separated)" name="competitors" placeholder="Xiaomi, Realme, Samsung" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Risk tolerance" name="riskTolerance" options={['low', 'medium', 'high']} defaultValue="medium" />
            <Select label="Approval mode" name="approvalMode" options={['strict', 'moderate', 'fast']} defaultValue="moderate" />
          </div>
          <button type="submit" className="w-full h-10 rounded-md bg-flare-500 text-ink-950 font-semibold hover:bg-flare-400 text-sm mt-2">
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
