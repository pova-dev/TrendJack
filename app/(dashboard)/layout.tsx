import * as React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { requireUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { startIngestCron } from '@/lib/cron';
import { bootAgents } from '@/lib/agents-boot';

// Boot the background ingest cron + agentic pipeline once per Node
// process. Both are idempotent via module-level flags.
//   - startIngestCron(): drives Scout polling every 90s
//   - bootAgents(): subscribes Filter / Verifier / Architect to the bus
//     so raw signals flow through the agent graph, not just the legacy
//     synchronous path.
startIngestCron();
bootAgents();

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (!ctx.brand) redirect('/onboard');
  return <AppShell user={{ name: ctx.user.name ?? ctx.user.email, email: ctx.user.email }}>{children}</AppShell>;
}
