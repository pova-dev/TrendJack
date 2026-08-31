'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { requestWithStepUp, deleteWithStepUp } from '@/lib/client/step-up';
import { ALL_ROLES, ROLE_DESCRIPTIONS, type Role } from '@/lib/auth/role-data';
import { Can } from '@/components/auth/capability-context';

interface Member {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
  isSelf: boolean;
}

export function MembersTable({ initial, ownerCount }: { initial: Member[]; ownerCount: number }) {
  const [members, setMembers] = React.useState(initial);
  const [owners, setOwners] = React.useState(ownerCount);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /** The rules the server enforces, mirrored so the control is disabled with a
   *  reason rather than refused after the click. The server still decides. */
  function blockedReason(m: Member, next?: Role): string | null {
    if (m.isSelf) return 'You cannot change your own role';
    if (m.role === 'owner' && owners <= 1 && next !== 'owner') return 'The only owner cannot be demoted';
    return null;
  }

  async function changeRole(m: Member, role: Role) {
    if (role === m.role) return;
    setBusy(m.userId);
    setError(null);
    const res = await requestWithStepUp('/api/members', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: m.userId, role }),
    });
    setBusy(null);
    if (res.ok) {
      setMembers(prev => prev.map(x => (x.userId === m.userId ? { ...x, role } : x)));
      setOwners(prev => prev + (role === 'owner' ? 1 : 0) - (m.role === 'owner' ? 1 : 0));
      return;
    }
    if (res.reason !== 'cancelled') setError(res.message ?? 'Could not change that role.');
  }

  async function remove(m: Member) {
    setBusy(m.userId);
    setError(null);
    const res = await deleteWithStepUp(`/api/members?userId=${encodeURIComponent(m.userId)}`);
    setBusy(null);
    if (res.ok) {
      setMembers(prev => prev.filter(x => x.userId !== m.userId));
      if (m.role === 'owner') setOwners(prev => prev - 1);
      return;
    }
    if (res.reason !== 'cancelled') setError(res.message ?? 'Could not remove that member.');
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-md border border-signal-red/40 bg-signal-red/10 px-3 py-2 text-xs text-bad-300">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {members.map(m => {
          const blocked = blockedReason(m);
          return (
            <li
              key={m.membershipId}
              className="flex flex-col gap-3 sm:flex-row sm:items-center rounded-lg border border-ink-700 bg-ink-850 p-3 sm:p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-ink-100 truncate">{m.name || m.email}</span>
                  {m.isSelf && <span className="text-2xs font-mono text-ink-500">you</span>}
                </div>
                {m.name && <p className="text-2xs font-mono text-ink-500 truncate">{m.email}</p>}
                <p className="mt-1 text-2xs text-ink-500">{ROLE_DESCRIPTIONS[m.role]}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.email}</label>
                <select
                  id={`role-${m.userId}`}
                  value={m.role}
                  disabled={!!blocked || busy === m.userId}
                  title={blocked ?? undefined}
                  onChange={e => void changeRole(m, e.target.value as Role)}
                  className={cn(
                    'h-8 px-2 rounded-md bg-ink-800 border border-ink-700 text-xs text-ink-100',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                  )}
                >
                  {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>

                <Can capability="resource:delete">
                  <button
                    type="button"
                    disabled={!!blocked || busy === m.userId}
                    title={blocked ?? 'Remove from this organisation'}
                    onClick={() => void remove(m)}
                    className="text-2xs font-mono text-ink-500 hover:text-signal-red disabled:opacity-40 disabled:hover:text-ink-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded px-2 py-2"
                  >
                    remove
                  </button>
                </Can>
              </div>
            </li>
          );
        })}
      </ul>

      {members.length === 1 && (
        <p className="mt-3 text-2xs text-ink-500">
          You are the only member. Anyone who signs up and joins this org will appear here.
        </p>
      )}
    </div>
  );
}
