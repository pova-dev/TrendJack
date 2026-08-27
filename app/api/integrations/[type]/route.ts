import { NextRequest, NextResponse } from 'next/server';
import { sendToSlack } from '@/lib/integrations/slack';
import { exportToSheets } from '@/lib/integrations/sheets';
import { sendWebhook } from '@/lib/integrations/notion';
import { getCurrentContext } from '@/lib/auth';
import { requireCapability, guardErrorResponse } from '@/lib/auth/guard';

export async function POST(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  // Permission gate. Deny-by-default: this route mutates state, so it must
  // name the capability it needs. See lib/auth/capabilities.ts.
  try { await requireCapability('trend:act'); }
  catch (e) { const denied = guardErrorResponse(e); if (denied) return denied; throw e; }

  // SECURITY: this route was previously unauthenticated — anyone with the
  // URL could POST through to Slack / Notion / Sheets using the server's
  // tokens. Now requires a logged-in session with an active brand.
  const auth = await getCurrentContext();
  if (!auth?.brand) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { type } = await ctx.params;
  const body = await req.json();

  switch (type) {
    case 'slack':
      return NextResponse.json(await sendToSlack(body));
    case 'sheets':
      return NextResponse.json(await exportToSheets(body));
    case 'webhook':
      // Generic JSON POST. Honest about what it does.
      return NextResponse.json(await sendWebhook(body));
    case 'notion':
      // Audit 2026-05-29 D5 — the previous code routed `notion` through
      // `sendWebhook`, which is a generic JSON POST. Notion's API requires
      // `Notion-Version` headers and bearer auth, so the call always failed
      // silently. Until the @notionhq/client adapter lands, refuse the
      // request rather than fail mysteriously.
      return NextResponse.json({
        ok: false,
        error: 'notion_integration_not_implemented',
        message: 'Native Notion integration is not built yet. Use the generic webhook target with a Notion automation (e.g. Zapier / Make.com / n8n) as a bridge.',
      }, { status: 501 });
    default:
      return NextResponse.json({ error: 'unknown_integration' }, { status: 400 });
  }
}
