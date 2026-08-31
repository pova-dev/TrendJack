import * as React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { can, type Role } from '@/lib/auth/capabilities';
import { MembersTable } from '@/components/admin/MembersTable';
import { getCronStatus } from '@/lib/cron';
import { getRetentionStatus } from '@/lib/retention';
import { realtimeStatus } from '@/lib/realtime/bus';
import { isMailConfigured } from '@/lib/auth/mailer';
import { relTime } from '@/lib/utils';

// Operational home for whoever runs this instance.
//
// The Admin tab used to point at /audit, which is one log and nothing else.
// Everything an admin actually needs to answer "is this healthy and who can
// touch it" was spread across pages with no navigation to them.
//
// Deliberately not a metrics wall. Each row here is something an admin can act
// on, and anything that is not configured says so plainly rather than
// rendering a zero that looks like a measurement.

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const ctx = await requireUser();
  if (!ctx.org) redirect('/');

  // Server-side gate. The tab is hidden for roles without it, but a hidden
  // link is not a control: anyone can type the URL.
  const role = (ctx.role ?? null) as Role | null;
  if (!can(role, 'member:manage') && !can(role, 'org:admin')) {
    return <Denied role={role} />;
  }

  const [members, recentAudit, trendCount, draftCount, outcomeCount] = await Promise.all([
    prisma.membership.findMany({
      where: { orgId: ctx.org.id },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.auditLog.findMany({
      where: { orgId: ctx.org.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { email: true } } },
    }),
    ctx.brand ? prisma.trend.count({ where: { brandId: ctx.brand.id } }) : 0,
    ctx.brand ? prisma.draft.count({ where: { brandId: ctx.brand.id } }) : 0,
    ctx.brand ? prisma.trend.count({ where: { brandId: ctx.brand.id, performanceMultiple: { not: null } } }) : 0,
  ]);

  const cron = getCronStatus();
  const retention = getRetentionStatus();
  const realtime = realtimeStatus();
  const inProcess = realtime.includes('in-process');

  const shaped = members.map(m => ({
    membershipId: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role as Role,
    joinedAt: m.createdAt.toISOString(),
    isSelf: m.userId === ctx.user.id,
  }));

  return (
    <div className="flex-1 overflow-y-auto tj-scroll">
      <div className="tj-stagger mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 pb-28 sm:pb-10">
        <header>
          <p className="text-2xs font-mono uppercase tracking-widest text-ink-400">Administration</p>
          <h1 className="mt-1 text-xl sm:text-2xl font-semibold text-ink-100">{ctx.org.name}</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {shaped.length} {shaped.length === 1 ? 'member' : 'members'} · you are {role}
          </p>
        </header>

        <Section title="People" caption="Roles decide what each person can reach. Deleting anything also needs an emailed code.">
          <MembersTable initial={shaped} ownerCount={shaped.filter(m => m.role === 'owner').length} />
        </Section>

        <Section title="System" caption="What is running, and what is switched off.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Status
              label="Ingestion"
              ok={!!cron.lastRunAt}
              value={cron.lastRunAt ? `last tick ${relTime(new Date(cron.lastRunAt).toISOString())}` : 'never run'}
              detail={cron.lastResult?.errors?.length ? `${cron.lastResult.errors.length} source errors on last tick` : undefined}
            />
            <Status
              label="Email"
              ok={isMailConfigured()}
              value={isMailConfigured() ? 'configured' : 'not configured'}
              detail={isMailConfigured() ? undefined : 'Deleting is impossible until SMTP is set. This is deliberate.'}
              fix={isMailConfigured() ? undefined : { href: '/connectors', label: 'Set SMTP' }}
            />
            {/* realtimeStatus() returns a human string rather than a struct.
                In-process is correct for a single instance and a real problem
                for several, which is why the detail is conditional on it. */}
            <Status
              label="Realtime"
              ok={!inProcess}
              value={inProcess ? 'in-process' : 'redis'}
              detail={inProcess
                ? 'Fine on one instance. On more than one, events reach only the process that raised them.'
                : undefined}
            />
            <Status
              label="Retention"
              ok={retention.enabled}
              value={retention.enabled ? 'enabled' : 'disabled'}
              detail={retention.enabled ? undefined : 'Nothing is ever deleted. The database grows without bound.'}
            />
          </div>
        </Section>

        <Section title="This brand" caption="Volume, and whether any of it is being used.">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Metric label="signals" value={trendCount.toLocaleString('en-US')} />
            <Metric label="drafts" value={draftCount.toLocaleString('en-US')} />
            <Metric
              label="outcomes"
              value={outcomeCount.toLocaleString('en-US')}
              warn={outcomeCount === 0 && draftCount > 0}
            />
            <Metric label="members" value={String(shaped.length)} />
          </dl>
          {outcomeCount === 0 && draftCount > 0 && (
            <p className="mt-3 text-xs text-signal-amber leading-relaxed max-w-prose">
              No post results have ever been recorded. Scoring calibration learns from those,
              so it is currently running on its priors alone.
            </p>
          )}
        </Section>

        <Section title="Recent activity" caption="Last eight events. The full log keeps 200.">
          {recentAudit.length === 0 ? (
            <p className="text-xs text-ink-500">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800 rounded-lg border border-ink-700 bg-ink-850 overflow-hidden">
              {recentAudit.map(a => (
                <li key={a.id} className="flex items-baseline gap-3 px-3 py-2 text-xs">
                  <span className="font-mono text-2xs text-ink-500 shrink-0">{relTime(a.createdAt.toISOString())}</span>
                  <span className="font-mono text-ink-200 truncate">{a.action}</span>
                  <span className="ml-auto text-2xs text-ink-500 truncate max-w-[40%]">{a.user?.email ?? 'system'}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/audit" className="mt-3 inline-block text-xs text-flare-400 hover:text-flare-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 rounded">
            Full audit log →
          </Link>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      <p className="mt-0.5 text-2xs text-ink-500 max-w-prose">{caption}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A subsystem, and what to do when it is off. A red dot with no remedy is
 *  just anxiety. */
function Status({
  label, ok, value, detail, fix,
}: { label: string; ok: boolean; value: string; detail?: string; fix?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-signal-green' : 'bg-signal-amber'}`} aria-hidden="true" />
        <span className="text-2xs font-mono uppercase tracking-wider text-ink-500">{label}</span>
        <span className="ml-auto text-xs font-mono text-ink-200">{value}</span>
      </div>
      {detail && <p className="mt-2 text-2xs text-ink-500 leading-relaxed">{detail}</p>}
      {fix && (
        <Link href={fix.href} className="mt-2 inline-block text-2xs text-flare-400 hover:text-flare-300">
          {fix.label} →
        </Link>
      )}
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-2xs font-mono uppercase tracking-wider text-ink-600">{label}</dt>
      <dd className={`mt-0.5 text-lg font-mono tabular-nums leading-none ${warn ? 'text-signal-amber' : 'text-ink-100'}`}>
        {value}
      </dd>
    </div>
  );
}

/** Reached by typing the URL without the role. Says which role is missing,
 *  because "Forbidden" with no detail is how permission problems become
 *  support tickets. */
function Denied({ role }: { role: Role | null }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-2xs font-mono uppercase tracking-widest text-signal-amber">Not available</p>
        <h1 className="mt-2 text-lg font-semibold text-ink-100">Administration needs an admin role</h1>
        <p className="mt-2 text-sm text-ink-400 leading-relaxed">
          Your role is <span className="font-mono text-ink-200">{role ?? 'none'}</span>, which cannot manage
          people or org settings. An owner can change that from this page.
        </p>
        <Link href="/" className="mt-4 inline-block text-xs text-flare-400 hover:text-flare-300">
          Back to Today →
        </Link>
      </div>
    </div>
  );
}
