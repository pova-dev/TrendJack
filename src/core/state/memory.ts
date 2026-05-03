// In-memory StateBus implementation.
//
// Used in dev/test and as the default before Redis is configured. Implements
// the full StateBus contract including consumer groups, ack/pending tracking,
// and at-least-once redelivery semantics.
//
// Concurrency model:
//   - publish() pushes the message into a per-stream queue + dispatches to
//     each consumer group's "next consumer" (round-robin within group)
//   - subscribe() registers a consumer; un-acked messages are tracked in
//     pendingByGroup with a delivery timestamp
//   - ack() removes the entry from pending
//   - close() drops all subscriptions
//
// Production parity:
//   - This impl is single-process; Redis Streams gives multi-process.
//   - Both honor consumer-group partitioning: each message goes to exactly
//     one consumer in each group.
//   - Both support at-least-once redelivery: messages with no ack within
//     the redelivery window are re-dispatched.

import { EventEmitter } from 'eventemitter3';
import type {
  StateBus,
  Unsubscribe,
  PublishedMessage,
  PendingInfo,
  SubscribeOpts,
} from './bus';
import type { StreamId } from './streams';

interface Subscription<T> {
  group: string;
  consumerName: string;
  handler: (msg: PublishedMessage<T>) => Promise<void> | void;
}

interface PendingEntry {
  msgId: string;
  streamName: string;
  consumerGroup: string;
  consumerName: string;
  deliveredAt: number;
  deliveryCount: number;
  body: unknown;
  retryTimer?: NodeJS.Timeout;
}

interface MemoryBusOpts {
  /** How long an unacked message can sit before redelivery. Defaults to 30s. */
  redeliveryMs?: number;
  /** Max redelivery attempts before marking permanently failed. Defaults to 3. */
  maxRedeliveries?: number;
}

export class MemoryStateBus implements StateBus {
  private subscribers = new Map<string, Subscription<unknown>[]>(); // streamName → subs
  private nextRoundRobinIdx = new Map<string, number>(); // `${streamName}:${group}` → idx
  private pendingByGroup = new Map<string, PendingEntry[]>(); // groupName → pending
  private pendingById = new Map<string, PendingEntry>();      // msgId → entry
  private eventBus = new EventEmitter();
  private nextMsgId = 1;
  private closed = false;
  private readonly redeliveryMs: number;
  private readonly maxRedeliveries: number;

  constructor(opts: MemoryBusOpts = {}) {
    this.redeliveryMs = opts.redeliveryMs ?? 30_000;
    this.maxRedeliveries = opts.maxRedeliveries ?? 3;
  }

  async publish<T>(stream: StreamId<T>, message: T): Promise<string> {
    if (this.closed) throw new Error('MemoryStateBus is closed');

    const msgId = `mem-${this.nextMsgId++}`;
    const published: PublishedMessage<T> = {
      id: msgId,
      body: message,
      publishedAt: new Date(),
    };

    // Deliver to one consumer per group (round-robin within group).
    const subs = this.subscribers.get(stream.name) ?? [];
    const byGroup = groupBy(subs, s => s.group);

    for (const [group, groupSubs] of byGroup) {
      const key = `${stream.name}:${group}`;
      const idx = (this.nextRoundRobinIdx.get(key) ?? 0) % groupSubs.length;
      this.nextRoundRobinIdx.set(key, idx + 1);
      const target = groupSubs[idx];

      this.deliver(target, stream.name, published, 1);
    }

    // Notify any plain event listeners (used by tests).
    this.eventBus.emit(stream.name, published);

    return msgId;
  }

  subscribe<T>(
    stream: StreamId<T>,
    handler: (msg: PublishedMessage<T>) => Promise<void> | void,
    opts: SubscribeOpts,
  ): Unsubscribe {
    if (this.closed) throw new Error('MemoryStateBus is closed');

    const sub: Subscription<unknown> = {
      group: opts.group,
      consumerName: opts.consumerName ?? `c-${Math.random().toString(36).slice(2, 8)}`,
      handler: handler as Subscription<unknown>['handler'],
    };
    const list = this.subscribers.get(stream.name) ?? [];
    list.push(sub);
    this.subscribers.set(stream.name, list);

    return () => {
      const cur = this.subscribers.get(stream.name) ?? [];
      this.subscribers.set(stream.name, cur.filter(s => s !== sub));
    };
  }

  async ack(streamName: string, msgId: string): Promise<void> {
    const entry = this.pendingById.get(msgId);
    if (!entry) return; // already acked or never tracked
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    this.pendingById.delete(msgId);
    const groupList = this.pendingByGroup.get(entry.consumerGroup) ?? [];
    this.pendingByGroup.set(
      entry.consumerGroup,
      groupList.filter(e => e.msgId !== msgId),
    );
  }

  async pending(group: string): Promise<PendingInfo[]> {
    const now = Date.now();
    return (this.pendingByGroup.get(group) ?? []).map(e => ({
      msgId: e.msgId,
      streamName: e.streamName,
      consumerGroup: e.consumerGroup,
      consumerName: e.consumerName,
      idleMs: now - e.deliveredAt,
      deliveryCount: e.deliveryCount,
    }));
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.pendingById.values()) {
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
    }
    this.pendingById.clear();
    this.pendingByGroup.clear();
    this.subscribers.clear();
    this.eventBus.removeAllListeners();
  }

  // ----- internals --------------------------------------------------------

  private deliver(
    sub: Subscription<unknown>,
    streamName: string,
    published: PublishedMessage<unknown>,
    deliveryCount: number,
  ): void {
    const entry: PendingEntry = {
      msgId: published.id,
      streamName,
      consumerGroup: sub.group,
      consumerName: sub.consumerName,
      deliveredAt: Date.now(),
      deliveryCount,
      body: published.body,
    };
    this.pendingById.set(entry.msgId, entry);
    const groupList = this.pendingByGroup.get(sub.group) ?? [];
    groupList.push(entry);
    this.pendingByGroup.set(sub.group, groupList);

    // Schedule redelivery if no ack within window.
    entry.retryTimer = setTimeout(() => {
      this.handleRedeliveryTimeout(entry, sub, streamName, published);
    }, this.redeliveryMs);
    // Don't keep the process alive just because a retry is pending.
    if (entry.retryTimer.unref) entry.retryTimer.unref();

    // Fire the handler. Errors don't kill the bus — they just leave the
    // message un-acked, which the redelivery loop will pick up.
    Promise.resolve()
      .then(() => sub.handler(published))
      .catch(_err => {
        // swallowed — pending entry remains, redelivery will handle it
      });
  }

  private handleRedeliveryTimeout(
    entry: PendingEntry,
    sub: Subscription<unknown>,
    streamName: string,
    published: PublishedMessage<unknown>,
  ): void {
    // Already acked before timeout fired? Nothing to do.
    if (!this.pendingById.has(entry.msgId)) return;

    if (entry.deliveryCount >= this.maxRedeliveries) {
      // Drop the entry from pending — production Redis impl would XADD to a
      // DLQ stream here. For dev we just leave it visible via pending().
      return;
    }
    // Remove old pending entry, redeliver.
    this.pendingById.delete(entry.msgId);
    const groupList = this.pendingByGroup.get(sub.group) ?? [];
    this.pendingByGroup.set(sub.group, groupList.filter(e => e.msgId !== entry.msgId));
    this.deliver(sub, streamName, published, entry.deliveryCount + 1);
  }
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}
