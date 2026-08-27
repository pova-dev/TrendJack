import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { listCredentials, upsertCredential, deleteCredential } from '@/lib/credentials';
import { logAudit } from '@/lib/store';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

// Audit 2026-05-29 D3 — Slack / Sheets / Notion credential keys are now
// surface-able via the UI editor instead of env-var-only.
const ALLOWED_KEYS = new Set([
  // connector / live
  'X_BEARER_TOKEN', 'YOUTUBE_API_KEY', 'REDDIT_USER_AGENT',
  'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET',
  'NITTER_INSTANCES', 'INVIDIOUS_INSTANCES', 'RSSHUB_BASE', 'RSSHUB_FEEDS',
  'APIFY_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN', 'GTRENDS_GEO',
  // Social analytics. Actor ids are credentials, not constants, so a
  // different Apify actor can be swapped in from Settings without a deploy.
  'META_ACCESS_TOKEN',
  'APIFY_ACTOR_INSTAGRAM_PROFILE', 'APIFY_ACTOR_INSTAGRAM_POST',
  'APIFY_ACTOR_FACEBOOK_POST', 'APIFY_ACTOR_YOUTUBE_VIDEO',
  'APIFY_ACTOR_INSTAGRAM_COMMENTS', 'APIFY_ACTOR_FACEBOOK_COMMENTS',
  'APIFY_ACTOR_FACEBOOK_PAGE',
  // research
  'TAVILY_API_KEY', 'BRAVE_API_KEY',
  // ai providers
  'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY',
  'TJ_PROVIDER_CHEAP', 'TJ_MODEL_CHEAP',
  'TJ_PROVIDER_BALANCED', 'TJ_MODEL_BALANCED',
  'TJ_PROVIDER_PREMIUM', 'TJ_MODEL_PREMIUM',
  'TJ_FORCE_OPENROUTER',
  // integration creds (Audit 2026-05-29 D3)
  'SLACK_BOT_TOKEN', 'SLACK_DEFAULT_CHANNEL',
  'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'TRENDJACK_SHEET_ID',
  'TRENDJACK_DEFAULT_WEBHOOK',
]);

const SCOPE_FOR_KEY: Record<string, 'connector' | 'ai' | 'research' | 'integration'> = {
  X_BEARER_TOKEN: 'connector', YOUTUBE_API_KEY: 'connector', REDDIT_USER_AGENT: 'connector',
  REDDIT_CLIENT_ID: 'connector', REDDIT_CLIENT_SECRET: 'connector',
  NITTER_INSTANCES: 'connector', INVIDIOUS_INSTANCES: 'connector',
  RSSHUB_BASE: 'connector', RSSHUB_FEEDS: 'connector',
  TAVILY_API_KEY: 'research', BRAVE_API_KEY: 'research',
  ANTHROPIC_API_KEY: 'ai', OPENROUTER_API_KEY: 'ai', OPENAI_API_KEY: 'ai', GOOGLE_API_KEY: 'ai',
  APIFY_TOKEN: 'connector', INSTAGRAM_ACCESS_TOKEN: 'connector', FACEBOOK_ACCESS_TOKEN: 'connector',
  META_ACCESS_TOKEN: 'connector',
  APIFY_ACTOR_INSTAGRAM_PROFILE: 'connector', APIFY_ACTOR_INSTAGRAM_POST: 'connector',
  APIFY_ACTOR_FACEBOOK_POST: 'connector', APIFY_ACTOR_YOUTUBE_VIDEO: 'connector',
  APIFY_ACTOR_INSTAGRAM_COMMENTS: 'connector', APIFY_ACTOR_FACEBOOK_COMMENTS: 'connector',
  APIFY_ACTOR_FACEBOOK_PAGE: 'connector',
  GTRENDS_GEO: 'connector',
  TJ_PROVIDER_CHEAP: 'ai', TJ_MODEL_CHEAP: 'ai',
  TJ_PROVIDER_BALANCED: 'ai', TJ_MODEL_BALANCED: 'ai',
  TJ_PROVIDER_PREMIUM: 'ai', TJ_MODEL_PREMIUM: 'ai',
  TJ_FORCE_OPENROUTER: 'ai',
  // integration creds (Audit 2026-05-29 D3)
  SLACK_BOT_TOKEN: 'integration', SLACK_DEFAULT_CHANNEL: 'integration',
  GOOGLE_SHEETS_CLIENT_EMAIL: 'integration', GOOGLE_SHEETS_PRIVATE_KEY: 'integration',
  TRENDJACK_SHEET_ID: 'integration', TRENDJACK_DEFAULT_WEBHOOK: 'integration',
};

export async function GET() {
  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const items = await listCredentials(ctx.org.id);
  return NextResponse.json(items);
}

export async function PUT(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('credential:write'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json() as { entries?: Array<{ key: string; value: string }> };
  if (!Array.isArray(body.entries)) return NextResponse.json({ error: 'missing_entries' }, { status: 400 });

  const saved: string[] = [];
  for (const e of body.entries) {
    if (!ALLOWED_KEYS.has(e.key)) continue;       // ignore unknown keys silently
    if (typeof e.value !== 'string') continue;
    if (e.value.trim() === '') {
      await deleteCredential(ctx.org.id, SCOPE_FOR_KEY[e.key], e.key);
      saved.push(`-${e.key}`);
    } else {
      await upsertCredential({ orgId: ctx.org.id, scope: SCOPE_FOR_KEY[e.key], key: e.key, value: e.value });
      saved.push(`+${e.key}`);
    }
  }
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'credentials.update', meta: { keys: saved } });
  const items = await listCredentials(ctx.org.id);
  return NextResponse.json(items);
}

export async function DELETE(req: NextRequest) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('resource:delete'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  const ctx = await getCurrentContext();
  if (!ctx?.org) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key');
  if (!key || !ALLOWED_KEYS.has(key)) return NextResponse.json({ error: 'bad_key' }, { status: 400 });
  await deleteCredential(ctx.org.id, SCOPE_FOR_KEY[key], key);
  await logAudit({ orgId: ctx.org.id, userId: ctx.user.id, action: 'credentials.delete', target: key });
  return NextResponse.json({ ok: true });
}
