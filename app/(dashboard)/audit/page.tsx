import * as React from 'react';
import { requireUser } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { prisma } from '@/lib/db';
import { Chip } from '@/components/ui/Chip';
import { relTime } from '@/lib/utils';

export default async function AuditPage() {
  const ctx = await requireUser();
  if (!ctx.org) return null;
  const brand = ctx.brand ? await getBrand(ctx.brand.id) : null;
  const brands = await listBrandsForOrg(ctx.org.id);
  const logs = await prisma.auditLog.findMany({
    where: { orgId: ctx.org.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: true },
  });

  return (
    <>
      {brand && (
        <TopBar
          brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
          brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
          trendCount={0}
          postNowCount={0}
        />
      )}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl">
        <h1 className="text-xl font-semibold text-ink-100 mb-1">Audit log</h1>
        <p className="text-sm text-ink-300 mb-5">Last 200 events across the org. Read-only.</p>
        <div className="rounded-md border border-ink-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-2xs uppercase tracking-wider text-ink-300">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-t border-ink-700">
                  <td className="px-3 py-2 font-mono text-2xs text-ink-300">{relTime(l.createdAt.toISOString())}</td>
                  <td className="px-3 py-2 text-ink-100 text-xs">{l.user?.email ?? '—'}</td>
                  <td className="px-3 py-2"><Chip tone="info">{l.action}</Chip></td>
                  <td className="px-3 py-2 font-mono text-2xs text-ink-300 truncate">{l.target ?? '—'}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-2xs text-ink-400">no events yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
