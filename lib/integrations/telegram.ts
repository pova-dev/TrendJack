// Telegram outbound notifier. Per-org connection: bot token + chat id
// stored in TelegramConnection. Each connection subscribes to a set of
// events; on those events we POST sendMessage with rich MarkdownV2.
//
// Caller responsibility: do not block request paths. fireTelegram() is
// fire-and-forget and surfaces failures only via the connection's UI test
// button + audit log entries.

import { prisma } from '@/lib/db';

export interface TelegramSendOptions {
  text: string;
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disableWebPagePreview?: boolean;
  replyMarkup?: unknown;
}

export async function tgSendDirect(botToken: string, chatId: string, opts: TelegramSendOptions) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: opts.text,
      parse_mode: opts.parseMode ?? 'HTML',
      disable_web_page_preview: opts.disableWebPagePreview ?? false,
      reply_markup: opts.replyMarkup,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && (json as { ok?: boolean }).ok !== false, raw: json };
}

export async function fireTelegramForOrg(orgId: string, event: string, payload: Record<string, unknown>) {
  const conns = await prisma.telegramConnection.findMany({ where: { orgId, active: true } });
  const targets = conns.filter(c => {
    try { return (JSON.parse(c.events) as string[]).includes(event); }
    catch { return false; }
  });
  if (!targets.length) return;

  const text = formatPayload(event, payload);
  await Promise.allSettled(
    targets.map(t => tgSendDirect(t.botToken, t.defaultChatId, {
      text, parseMode: 'HTML', disableWebPagePreview: false,
      replyMarkup: payload.openUrl ? {
        inline_keyboard: [[{ text: '🔗 Open original', url: String(payload.openUrl) }]],
      } : undefined,
    })),
  );
}

function escape(s: string): string {
  return s.replace(/[<>&]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string));
}

function formatPayload(event: string, p: Record<string, unknown>): string {
  const trend = p.trend as { title?: string; recommendation?: string; scores?: { opportunity?: number }; lineage?: string; url?: string } | undefined;
  switch (event) {
    case 'trend.post_now':
    case 'trend.escalate': {
      const lines = [
        `<b>🔥 ${escape(trend?.title ?? 'New trend')}</b>`,
        `<i>${escape(trend?.lineage ?? '')}</i>`,
        '',
        `<b>Recommendation:</b> ${escape(trend?.recommendation ?? '')}`,
        `<b>Opportunity:</b> ${trend?.scores?.opportunity ?? '—'}/100`,
      ];
      return lines.join('\n');
    }
    case 'draft.shipped': {
      const draft = p.draft as { hook?: string; platform?: string } | undefined;
      return `<b>✅ Draft shipped</b>\n${escape(draft?.platform ?? '')}\n${escape(draft?.hook ?? '')}`;
    }
    default:
      return `<b>TrendJack:</b> ${event}\n${escape(JSON.stringify(p).slice(0, 500))}`;
  }
}
