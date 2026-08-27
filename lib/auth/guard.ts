// Route guard.
//
// One choke point every mutating route goes through. Resolves the session,
// checks the capability, and returns a context the handler can trust.
//
// Deliberately throws rather than returning a nullable, so a handler cannot
// accidentally continue past a failed check by ignoring a return value. That
// is the failure mode of `const ok = await check(); // never read`, and it is
// how authorization bugs usually reach production.

import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { can, type Capability, type Role } from './capabilities';
import { logAudit } from '@/lib/store';

export class ForbiddenError extends Error {
  constructor(
    readonly capability: Capability,
    readonly role: Role | null,
  ) {
    super(`role "${role ?? 'none'}" lacks capability "${capability}"`);
    this.name = 'ForbiddenError';
  }
}

export class UnauthenticatedError extends Error {
  constructor() { super('not signed in'); this.name = 'UnauthenticatedError'; }
}

export interface GuardedContext {
  user: { id: string; email: string; name: string | null };
  org: { id: string };
  brand: { id: string };
  role: Role;
}

/**
 * Require a capability. Returns the resolved context or throws.
 *
 * Denials are written to the audit log, because a permission failure is
 * exactly the kind of event a security review asks to see, and because a
 * legitimate user hitting a wall repeatedly is a signal their role is wrong.
 */
export async function requireCapability(capability: Capability): Promise<GuardedContext> {
  const ctx = await getCurrentContext();
  if (!ctx?.user) throw new UnauthenticatedError();
  if (!ctx.org || !ctx.brand) throw new UnauthenticatedError();

  const role = (ctx.role ?? null) as Role | null;
  if (!can(role, capability)) {
    // Best-effort: never let audit logging turn a 403 into a 500.
    try {
      await logAudit({
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: 'auth.denied',
        target: capability,
        meta: { role: role ?? 'none' },
      });
    } catch { /* ignore */ }
    throw new ForbiddenError(capability, role);
  }

  return {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
    org: { id: ctx.org.id },
    brand: { id: ctx.brand.id },
    role: role as Role,
  };
}

/**
 * Translate a guard failure into a response.
 *
 * The message names the capability and the role, because "Forbidden" with no
 * detail is the reason permission problems take hours to diagnose. It leaks
 * nothing: the caller already knows their own role.
 */
export function guardErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof UnauthenticatedError) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (e instanceof ForbiddenError) {
    return NextResponse.json({
      error: 'forbidden',
      capability: e.capability,
      role: e.role,
      message: `Your role (${e.role ?? 'none'}) cannot perform "${e.capability}".`,
    }, { status: 403 });
  }
  return null;
}

/**
 * Wrap a handler so guard failures become correct responses automatically.
 *
 * Using this rather than a try/catch per route means a handler cannot forget
 * to translate the error and accidentally return a 500 for a permission
 * problem, which would hide the real cause from whoever is debugging it.
 */
export function withCapability<Args extends unknown[]>(
  capability: Capability,
  handler: (ctx: GuardedContext, ...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    let ctx: GuardedContext;
    try {
      ctx = await requireCapability(capability);
    } catch (e) {
      const res = guardErrorResponse(e);
      if (res) return res;
      throw e;
    }
    return handler(ctx, ...args);
  };
}
