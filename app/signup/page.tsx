import * as React from 'react';
import Link from 'next/link';
import { signupAction } from '@/lib/auth/actions';

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-pop">
        <Link href="/" className="flex items-center gap-2 mb-5">
          <span className="w-8 h-8 rounded-md bg-flare-500 text-ink-950 font-bold flex items-center justify-center">TJ</span>
          <span className="text-lg font-semibold text-ink-100">TrendJack</span>
        </Link>
        <h1 className="text-base font-semibold text-ink-100 mb-1">Spin up your war room</h1>
        <p className="text-xs text-ink-300 mb-5">Sign up, set up your brand, see live signals — all in &lt; 60 seconds.</p>
        <form action={signupAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your name" name="name" required />
            <Field label="Org / company" name="orgName" required />
          </div>
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" minLength={8} required hint="Min 8 chars" />
          <button type="submit" className="w-full h-9 rounded-md bg-flare-500 text-ink-950 font-semibold hover:bg-flare-400 text-sm">
            Create account
          </button>
        </form>
        <p className="mt-4 text-xs text-ink-400">
          Already have one? <Link href="/signin" className="text-flare-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">{label}</span>
      <input
        {...props}
        className="mt-1 block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
      />
      {hint && <span className="text-2xs text-ink-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}
