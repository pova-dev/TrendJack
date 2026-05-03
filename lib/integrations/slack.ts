// Slack integration stub.
// Phase 1: logs the payload and pretends success. Phase 2 wires the
// Slack Web API via SLACK_BOT_TOKEN.
//
// Required env (when going live):
//   SLACK_BOT_TOKEN — xoxb-...
//   SLACK_DEFAULT_CHANNEL — e.g. #trendjack-drafts

export interface SlackPayload {
  channel?: string;
  trendId: string;
  title: string;
  recommendation: string;
  opportunity: number;
  url?: string;
  draftPreview?: string;
}

export async function sendToSlack(p: SlackPayload) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = p.channel ?? process.env.SLACK_DEFAULT_CHANNEL ?? '#trendjack-drafts';

  if (!token) {
    return {
      ok: true,
      mode: 'mock' as const,
      message: `[mock] Would post to ${channel}: ${p.title} (${p.recommendation}, opp ${p.opportunity})`,
    };
  }

  const text = `*${p.title}* — ${p.recommendation} (opp ${p.opportunity})\n${p.draftPreview ?? ''}\n${p.url ?? ''}`;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const json = await res.json();
  return { ok: json.ok, mode: 'live' as const, raw: json };
}
