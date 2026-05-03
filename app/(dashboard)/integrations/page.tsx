import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { TopBar } from '@/components/shell/TopBar';
import { prisma } from '@/lib/db';
import { WebhookManager } from '@/components/integrations/WebhookManager';
import { TelegramManager } from '@/components/integrations/TelegramManager';

export default async function IntegrationsPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);
  const [hooks, tgs] = await Promise.all([
    prisma.webhook.findMany({ where: { orgId: ctx.org!.id }, orderBy: { createdAt: 'desc' } }),
    prisma.telegramConnection.findMany({ where: { orgId: ctx.org!.id }, orderBy: { createdAt: 'desc' } }),
  ]);

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={0}
        postNowCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-6">
        <header>
          <h1 className="text-xl font-semibold text-ink-100 mb-1">Integrations</h1>
          <p className="text-sm text-ink-300">Push trends to wherever your team lives. Telegram bots and outbound webhooks first; Slack 2-way coming next.</p>
        </header>

        <TelegramManager initial={tgs.map(t => ({
          id: t.id, name: t.name, defaultChatId: t.defaultChatId,
          events: JSON.parse(t.events) as string[], active: t.active,
          botTokenMasked: maskToken(t.botToken),
        }))} />

        <WebhookManager initial={hooks.map(h => ({
          id: h.id, name: h.name, url: h.url,
          events: JSON.parse(h.events) as string[], active: h.active,
        }))} />
      </div>
    </>
  );
}

function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  return t.slice(0, 4) + '••••' + t.slice(-4);
}
