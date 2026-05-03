import * as React from 'react';
import { redirect } from 'next/navigation';
import { createBrandAction } from '@/lib/auth/actions';
import { requireUser } from '@/lib/auth';

export default async function NewBrandPage() {
  const ctx = await requireUser();
  if (!ctx.org) redirect('/onboard');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl rounded-xl border border-ink-700 bg-ink-900 p-6">
        <h1 className="text-lg font-semibold text-ink-100 mb-1">Add another brand</h1>
        <p className="text-sm text-ink-300 mb-5">Each brand gets its own war room with its own voice, banned words, and trend feed.</p>
        <form action={createBrandAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Brand name" name="brandName" required />
            <Input label="Category" name="category" required />
          </div>
          <Input label="Tagline (optional)" name="tagline" />
          <Input label="Voice" name="voice" placeholder="One line. e.g. Sharp. Direct. Anti-cliché." />
          <Input label="Markets (comma-separated)" name="markets" />
          <Input label="Competitors (comma-separated)" name="competitors" />
          <div className="grid grid-cols-2 gap-3">
            <Pick label="Risk tolerance" name="riskTolerance" options={['low','medium','high']} defaultValue="medium" />
            <Pick label="Approval mode" name="approvalMode" options={['strict','moderate','fast']} defaultValue="moderate" />
          </div>
          <button type="submit" className="w-full h-10 rounded-md bg-flare-500 text-ink-950 font-semibold hover:bg-flare-400 text-sm">
            Create brand
          </button>
        </form>
      </div>
    </div>
  );
}

function Input({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <input {...p} className="mt-1 block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100" />
    </label>
  );
}
function Pick({ label, options, ...p }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <select {...p} className="mt-1 block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 capitalize">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
