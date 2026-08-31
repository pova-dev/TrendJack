'use client';
import * as React from 'react';
import type { Capability, Role } from '@/lib/auth/role-data';

// What the signed-in user may do, available to any client component.
//
// The server has known this since the capability matrix landed, and the client
// did not. Only a single canAdmin boolean reached the browser, so every
// destructive control rendered for everyone and a viewer discovered their
// limits by clicking Delete and receiving a 403. Being told no after acting is
// the worst ordering: it looks like the app broke rather than like the button
// was never theirs.
//
// This is presentation only. The server re-checks every capability on every
// request through requireCapability, because anything shipped to a browser can
// be edited in a browser. Hiding a control is courtesy; the guard is security.

interface CapabilityState {
  capabilities: ReadonlySet<Capability>;
  role: Role | null;
}

const Ctx = React.createContext<CapabilityState>({
  // Deny-by-default outside a provider. A missing provider must not silently
  // grant, which is the failure mode of defaulting to an allow-all set.
  capabilities: new Set<Capability>(),
  role: null,
});

export function CapabilityProvider({
  capabilities, role, children,
}: { capabilities: Capability[]; role: Role | null; children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ capabilities: new Set(capabilities), role }),
    // Joined rather than compared by reference: the array is rebuilt on every
    // server render, so a reference dep would rebuild the Set every time.
    [capabilities.join(','), role], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Does the current user hold this capability? */
export function useCan(capability: Capability): boolean {
  return React.useContext(Ctx).capabilities.has(capability);
}

/** The user's role, for messages that need to name it. */
export function useRole(): Role | null {
  return React.useContext(Ctx).role;
}

/**
 * Render children only when the user holds the capability.
 *
 * `fallback` exists for the cases where absence would be confusing: a toolbar
 * that loses its only button looks broken, so it can show a disabled control
 * with a reason instead. Default is to render nothing, because a control the
 * user can never use is clutter.
 */
export function Can({
  capability, children, fallback = null,
}: { capability: Capability; children: React.ReactNode; fallback?: React.ReactNode }) {
  return useCan(capability) ? <>{children}</> : <>{fallback}</>;
}
