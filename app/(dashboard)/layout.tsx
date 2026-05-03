import * as React from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { requireUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { startIngestCron } from '@/lib/cron';

// Boot the background ingest cron once per Node process. Hot-reload safe
// (idempotent via a global flag inside startIngestCron).
startIngestCron();

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUser();
  if (!ctx.brand) redirect('/onboard');
  return <AppShell user={{ name: ctx.user.name ?? ctx.user.email, email: ctx.user.email }}>{children}</AppShell>;
}
