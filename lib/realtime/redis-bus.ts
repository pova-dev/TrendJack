// Redis-backed realtime bus.
//
// The in-process EventEmitter only reaches clients connected to the SAME Node
// process. On any multi-instance deploy that means a trend published by
// instance A never reaches a dashboard held open against instance B: realtime
// simply stops working for most users, with no error anywhere. Silent, and
// therefore the worst kind of failure.
//
// This adapter fixes it with Redis pub/sub, and is deliberately optional:
//   - REDIS_URL unset  → in-process bus, plus a loud warning if the process
//                        looks like it is running alongside others.
//   - REDIS_URL set    → fan-out through Redis, so every instance sees every
//                        event.
//
// The client is loaded with a dynamic import so `redis` stays an optional
// dependency. A single-server or local install never needs it installed.
//
// Redis pub/sub is fire-and-forget, which exactly matches what this bus is
// for: SSE nudges telling a dashboard to refetch. A dropped message costs one
// delayed refresh, not lost data, because the data itself lives in Postgres.
// That is why no delivery guarantee or replay is attempted here.

import type { RTEvent } from './bus';

type Handler = (e: RTEvent) => void;

export interface RealtimeTransport {
  publish(channel: string, event: RTEvent): void;
  subscribe(channel: string, handler: Handler): () => void;
  /** Human-readable, for the health endpoint. */
  describe(): string;
  close(): Promise<void>;
}

interface RedisLike {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  duplicate(): RedisLike;
  on(event: string, cb: (err: unknown) => void): unknown;
}

/**
 * Connect a Redis transport, or return null when Redis is not configured.
 *
 * Throws only when REDIS_URL IS set but unusable. A misconfigured Redis must
 * fail loudly at boot rather than silently degrade to a broken realtime layer,
 * which is the exact failure mode this module exists to remove.
 */
export async function createRedisTransport(url: string): Promise<RealtimeTransport> {
  let createClient: (opts: { url: string }) => RedisLike;
  try {
    // Optional dependency: only needed when REDIS_URL is set, so a
    // single-server or local install never has to carry it. The specifier is
    // held in a variable on purpose, which stops TypeScript and the bundler
    // resolving it at build time and lets the package genuinely stay optional.
    const specifier = 'redis';
    const mod = await import(/* webpackIgnore: true */ specifier) as unknown as {
      createClient: (opts: { url: string }) => RedisLike;
    };
    createClient = mod.createClient;
  } catch {
    throw new Error(
      'REDIS_URL is set but the "redis" package is not installed. Run `npm i redis`, ' +
      'or unset REDIS_URL to run single-instance with the in-process bus.',
    );
  }

  const pub = createClient({ url });
  // Redis requires a dedicated connection for subscriptions: a subscribed
  // client cannot issue other commands.
  const sub = pub.duplicate();

  // Never let a connection blip take the process down. Realtime is a
  // nice-to-have layer; the data is in the database either way.
  pub.on('error', err => console.error('[realtime] redis publisher error', err));
  sub.on('error', err => console.error('[realtime] redis subscriber error', err));

  await pub.connect();
  await sub.connect();

  const handlers = new Map<string, Set<Handler>>();

  return {
    publish(channel, event) {
      void pub.publish(channel, JSON.stringify(event)).catch(err => {
        console.error('[realtime] publish failed', channel, err);
      });
    },

    subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        void sub.subscribe(channel, message => {
          let event: RTEvent;
          try { event = JSON.parse(message) as RTEvent; }
          catch { return; }   // a malformed message must not kill the stream
          for (const h of handlers.get(channel) ?? []) {
            try { h(event); } catch (e) { console.error('[realtime] handler threw', e); }
          }
        }).catch(err => console.error('[realtime] subscribe failed', channel, err));
      }
      set.add(handler);

      return () => {
        const s = handlers.get(channel);
        if (!s) return;
        s.delete(handler);
        // Last local listener for this channel: drop the Redis subscription
        // too, so an idle instance is not fanned traffic it cannot use.
        if (s.size === 0) {
          handlers.delete(channel);
          void sub.unsubscribe(channel).catch(() => {});
        }
      };
    },

    describe() {
      return `redis (${redactUrl(url)})`;
    },

    async close() {
      handlers.clear();
      await Promise.allSettled([sub.quit(), pub.quit()]);
    },
  };
}

/** Never log credentials that live in a connection string. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return 'redis://***';
  }
}

/**
 * Does this process look like one of several?
 *
 * Used to warn when realtime is about to be quietly broken. These are the
 * platforms where more than one instance is the default rather than the
 * exception, so running in-process there is almost certainly unintended.
 */
export function looksMultiInstance(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(
    env.VERCEL ||
    env.AWS_LAMBDA_FUNCTION_NAME ||
    env.K_SERVICE ||          // Cloud Run
    env.WEBSITE_INSTANCE_ID || // Azure App Service
    env.DYNO ||               // Heroku
    env.FLY_ALLOC_ID ||       // Fly.io
    (env.KUBERNETES_SERVICE_HOST && env.NODE_ENV === 'production')
  );
}
