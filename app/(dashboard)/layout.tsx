import * as React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { requireUser } from '@/lib/auth';
import { listBrandsForOrg } from '@/lib/store';
import { can } from '@/lib/auth/capabilities';
import { redirect } from 'next/navigation';
import { startIngestCron } from '@/lib/cron';
import { bootAgents } from '@/lib/agents-boot';
import { startLineageCron } from '@/lib/lineage-cron';
import { startPlanLifecycleCron } from '@/lib/plan-cron';
import { bootMediaAdapters } from '@/src/core/media/boot';
import { startSocialPollCron } from '@/lib/social/poller';
import { startRetentionCron } from '@/lib/retention';
import { initRealtime } from '@/lib/realtime/bus';

// Boot the background ingest cron + agentic pipeline + lineage cron +
// media adapters once per Node process. All are idempotent via
// module-level flags.
//   - startIngestCron(): drives Scout polling every 90s
//   - bootAgents(): subscribes Filter / Verifier / Architect to the bus
//   - startLineageCron(): rebuilds per-brand lineage map every 60s so
//     the Filter Agent's enrichSignal hook can short-circuit the
//     per-trend fingerprint scan.
//   - bootMediaAdapters(): registers DALL-E 3 + future image/video
//     adapters with the multi-model media router.
//   - startSocialPollCron(): refreshes social follower/engagement counters
//     on each account's cadence (15 min default). Checks every minute for
//     accounts that are due; does nothing when none are configured.
startIngestCron();
bootAgents();
startLineageCron();
startPlanLifecycleCron();
bootMediaAdapters();
startSocialPollCron();
startRetentionCron();
// Fans realtime events across instances when REDIS_URL is set, and warns
// loudly when it is not on a platform that runs more than one.
void initRealtime();

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (!ctx.brand) redirect('/onboard');

  // Fetched once here rather than in each page. Every page needs the brand
  // list to draw a header, and making that a per-page job is why eight pages
  // ended up with no header at all.
  const brands = await listBrandsForOrg(ctx.org!.id);

  // Resolved server-side from the capability matrix, so the Admin tab is
  // absent for roles that cannot use it rather than merely hidden.
  const canAdmin = can(ctx.role, 'org:admin') || can(ctx.role, 'member:manage');

  const shape = (b: { id: string; name: string; category: string; crisisMode?: boolean }) =>
    ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode });

  return (
    <AppShell
      user={{ name: ctx.user.name ?? ctx.user.email, email: ctx.user.email }}
      brand={shape(ctx.brand)}
      brands={brands.map(shape)}
      canAdmin={canAdmin}
    >
      {children}
    </AppShell>
  );
}
