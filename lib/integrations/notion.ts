// Generic outbound webhook (used by Notion/Airtable/Linear/anything that
// accepts a JSON POST). For real Notion integration use the Notion SDK with
// NOTION_TOKEN + database id; kept generic for MVP flexibility.

export interface WebhookPayload {
  url?: string;
  body: unknown;
}

export async function sendWebhook(p: WebhookPayload) {
  const url = p.url ?? process.env.TRENDJACK_DEFAULT_WEBHOOK;
  if (!url) {
    return { ok: true, mode: 'mock' as const, message: '[mock] no webhook URL configured' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p.body),
    });
    return { ok: res.ok, mode: 'live' as const, status: res.status };
  } catch (e: unknown) {
    return { ok: false, mode: 'live' as const, error: e instanceof Error ? e.message : String(e) };
  }
}
