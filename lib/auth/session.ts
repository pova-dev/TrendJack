// Session via iron-session (HTTP-only encrypted cookie).
// Sessions store the userId + currently-active orgId + brandId. The brand can
// be switched by the user in the topbar; we persist that choice in the cookie.

import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface TJSession {
  userId?: string;
  orgId?: string;
  brandId?: string;
}

// SESSION_SECRET hard-fail in production. The previous default fallback
// shipped a deterministic key — anyone reading source on GitHub could
// derive it and decrypt sessions + encrypted org credentials. Dev/test
// keeps the placeholder for ergonomics; production boot throws if the
// env var is missing or too short.
function resolveSessionSecret(): string {
  const env = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!env || env.length < 32) {
      throw new Error(
        'FATAL: SESSION_SECRET must be set to a 32+ char value in production. ' +
        'Generate one with `openssl rand -hex 32` and add to your environment.',
      );
    }
    return env;
  }
  return env || 'dev-only-insecure-secret-please-change-to-32+chars-in-prod';
}

// Resolved lazily, on first session access — NOT at module load.
//
// `next build` imports every route module with NODE_ENV=production to collect
// page data, so evaluating this at module scope made a production build
// impossible without a runtime secret. That broke `npm run build` outright and
// meant the Dockerfile (which builds before SESSION_SECRET is ever supplied)
// could never produce an image.
//
// Deferring keeps CLAUDE.md hard-rule 8 exactly where it belongs — the first
// real session read/write in a running production server still throws — while
// letting a secret-less build machine compile the app.
let cachedSecret: string | undefined;
function sessionSecret(): string {
  if (cachedSecret === undefined) cachedSecret = resolveSessionSecret();
  return cachedSecret;
}

export const sessionOptions: SessionOptions = {
  get password() { return sessionSecret(); },
  cookieName: 'tj_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
};

// iron-session's IronSession<T> already declares save() / destroy() /
// updateConfig() — we just need to surface that type to callers instead
// of the bare TJSession data shape.
import type { IronSession } from 'iron-session';

export async function getSession(): Promise<IronSession<TJSession>> {
  const cookieStore = await cookies();
  return getIronSession<TJSession>(cookieStore, sessionOptions);
}
