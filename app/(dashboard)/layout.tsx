import * as React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { requireUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { startIngestCron } from '@/lib/cron';
import { bootAgents } from '@/lib/agents-boot';
import { startLineageCron } from '@/lib/lineage-cron';

// Boot the background ingest cron + agentic pipeline + lineage cron
// once per Node process. All three are idempotent via module-level
// flags.
//   - startIngestCron(): drives Scout polling every 90s
//   - bootAgents(): subscribes Filter / Verifier / Architect to the bus
//   - startLineageCron(): rebuilds per-brand lineage map every 60s so
//     the Filter Agent's enrichSignal hook can short-circuit the
//     per-trend fingerprint scan.
startIngestCron();
bootAgents();
startLineageCron();

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (!ctx.brand) redirect('/onboard');
  return <AppShell user={{ name: ctx.user.name ?? ctx.user.email, email: ctx.user.email }}>{children}</AppShell>;
}
