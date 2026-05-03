import { NextRequest, NextResponse } from 'next/server';
import { sendToSlack } from '@/lib/integrations/slack';
import { exportToSheets } from '@/lib/integrations/sheets';
import { sendWebhook } from '@/lib/integrations/notion';
import { getCurrentContext } from '@/lib/auth';

export async function POST(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
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
    case 'notion':
    case 'webhook':
      return NextResponse.json(await sendWebhook(body));
    default:
      return NextResponse.json({ error: 'unknown_integration' }, { status: 400 });
  }
}
