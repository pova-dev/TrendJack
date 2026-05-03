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

const password = process.env.SESSION_SECRET || 'dev-only-insecure-secret-please-change-to-32+chars-in-prod';

export const sessionOptions: SessionOptions = {
  password,
  cookieName: 'tj_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  },
};

export async function getSession(): Promise<TJSession> {
  const cookieStore = await cookies();
  return getIronSession<TJSession>(cookieStore, sessionOptions);
}
