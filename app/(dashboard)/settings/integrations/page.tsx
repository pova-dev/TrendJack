import * as React from 'react';
import { requireBrand } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { WebhookManager } from '@/components/integrations/WebhookManager';
import { TelegramManager } from '@/components/integrations/TelegramManager';

export default async function IntegrationsSettings() {
  const ctx = await requireBrand();
  const [hooks, tgs] = await Promise.all([
    prisma.webhook.findMany({ where: { orgId: ctx.org!.id }, orderBy: { createdAt: 'desc' } }),
    prisma.telegramConnection.findMany({ where: { orgId: ctx.org!.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  return (
    <div className="p-6 max-w-4xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Integrations</h1>
        <p className="text-sm text-ink-300">Push trends to where your team lives. Telegram bots and outbound webhooks.</p>
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
  );
}

function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  return t.slice(0, 4) + '••••' + t.slice(-4);
}
