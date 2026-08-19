import { NextRequest } from 'next/server';
import { getBoard } from '@/lib/store';
import { bus } from '@/lib/realtime/bus';
import { getCurrentContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Auth check FIRST — getBoard now requires brandId. Audit 2026-05-29 B1.
  const session = await getCurrentContext();
  if (!session?.brand) return new Response('unauthorized', { status: 401 });

  const brandId = session.brand.id;
  const board = await getBoard(id, brandId);
  if (!board) return new Response('not_found', { status: 404 });
  const channels = [
    `brand:${brandId}:trends`,
    `brand:${brandId}:profile`,
    `brand:${brandId}:weights`,
  ];

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
          cleanup();
        }
      };
      send('hello', { boardId: id, brandId, at: new Date().toISOString() });

      const unsubs = channels.map(ch => bus.subscribe(ch, e => send(e.type, e)));
      const heartbeat = setInterval(() => send('tick', { at: new Date().toISOString() }), 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubs.forEach(u => u());
        try { controller.close(); } catch { /* already closed */ }
      };
      // @ts-expect-error: signal exists at runtime
      controller.signal?.addEventListener?.('abort', cleanup);
    },
    cancel() { /* client disconnected — start() cleanup runs via abort */ },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}
