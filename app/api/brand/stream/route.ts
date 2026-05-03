import { NextRequest } from 'next/server';
import { getCurrentContext } from '@/lib/auth';
import { bus } from '@/lib/realtime/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const ctx = await getCurrentContext();
  if (!ctx?.brand) return new Response('unauthorized', { status: 401 });
  const brandId = ctx.brand.id;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; cleanup(); }
      };
      send('hello', { brandId, at: new Date().toISOString() });

      const unsubs = [
        bus.subscribe(`brand:${brandId}:profile`, e => send(e.type, e)),
        bus.subscribe(`brand:${brandId}:weights`, e => send(e.type, e)),
      ];
      const heartbeat = setInterval(() => send('tick', { at: new Date().toISOString() }), 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubs.forEach(u => u());
        try { controller.close(); } catch {}
      };
      // @ts-expect-error
      controller.signal?.addEventListener?.('abort', cleanup);
    },
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
