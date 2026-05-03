// StateBus — agent message-passing primitive.
//
// One interface, two implementations. The contract:
//
//   publish(stream, message)    → fire-and-forget; resolves when delivered
//                                  to all consumers (or persisted, in Redis impl)
//   subscribe(stream, handler,  → register a consumer in a named consumer
//             { group })          group; messages are partitioned across
//                                  group members (at-least-once delivery)
//   ack(streamName, msgId)      → acknowledge a message has been processed
//                                  successfully; pending entries DLQ otherwise
//   pending(group)              → inspect un-acked messages for a consumer
//                                  group (DLQ visibility)
//
// Production backend: Redis Streams (later phase). It gives us:
//   - persistence (replay after consumer restart)
//   - consumer groups (horizontal scaling)
//   - per-message ack with auto-pending → DLQ
//   - partitioning by stream key
//
// Dev/test backend: in-process EventEmitter + Map. Same contract, no Redis.
// Tests use this so they're hermetic. Production swaps via env flag.

import type { StreamId } from './streams';

export interface Unsubscribe {
  (): void;
}

export interface PendingInfo {
  msgId: string;
  streamName: string;
  consumerGroup: string;
  consumerName: string;
  /** Milliseconds since the message was delivered without ack. */
  idleMs: number;
  /** How many times this message has been re-delivered (retry count). */
  deliveryCount: number;
}

export interface SubscribeOpts {
  /** Consumer group name. Messages are load-balanced across consumers
   *  in the same group (each message goes to exactly one). Different
   *  groups receive copies independently. */
  group: string;
  /** Consumer name within the group. Defaults to a generated id. */
  consumerName?: string;
}

export interface PublishedMessage<T> {
  /** Provider-assigned message id (used for ack). For in-memory impl this
   *  is just an autoincrement; for Redis it's the stream entry id. */
  id: string;
  body: T;
  publishedAt: Date;
}

export interface StateBus {
  /** Publish a message to a stream. Resolves once at-least-once delivery
   *  is guaranteed (in-memory: synchronous; Redis: XADD complete). */
  publish<T>(stream: StreamId<T>, message: T): Promise<string>;

  /** Subscribe a handler to a stream. Returns an unsubscribe function.
   *
   *  IMPORTANT: handler should call bus.ack(streamName, msgId) after
   *  successful processing. Un-acked messages will be redelivered to
   *  the same consumer group (visible via pending()).
   */
  subscribe<T>(
    stream: StreamId<T>,
    handler: (msg: PublishedMessage<T>) => Promise<void> | void,
    opts: SubscribeOpts,
  ): Unsubscribe;

  /** Mark a message as successfully processed. */
  ack(streamName: string, msgId: string): Promise<void>;

  /** Inspect pending (un-acked) messages for a consumer group. Used by
   *  the ArchitectAgent to surface stuck messages and trigger DLQ. */
  pending(group: string): Promise<PendingInfo[]>;

  /** Close all subscriptions and release backend resources. */
  close(): Promise<void>;
}
