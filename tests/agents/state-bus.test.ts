// StateBus tests — verify the in-memory implementation honors the contract:
//   - publish() delivers to all subscribed groups
//   - within a group, messages are partitioned (each msg → exactly one consumer)
//   - across groups, messages are duplicated (each group sees every msg)
//   - ack() removes from pending; un-acked messages are visible via pending()
//   - close() releases all subscriptions

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MemoryStateBus, STREAMS, type RawSignalMessage } from '@/src/core/state';
import { mkSignal } from '../fixtures/trends';

let bus: MemoryStateBus;

beforeEach(() => {
  bus = new MemoryStateBus({ redeliveryMs: 200, maxRedeliveries: 2 });
});

afterEach(async () => {
  await bus.close();
});

const sampleMsg = (): RawSignalMessage => ({
  signal: mkSignal({ title: 'Test trend' }),
  brandId: 'brand-test',
  connectorId: 'reddit_live',
  fetchedAt: new Date(),
});

describe('MemoryStateBus.publish + subscribe', () => {
  it('delivers a published message to a subscribed handler', async () => {
    const received: string[] = [];
    bus.subscribe(STREAMS.rawSignals, async (msg) => {
      received.push(msg.body.signal.title);
      await bus.ack(STREAMS.rawSignals.name, msg.id);
    }, { group: 'filter-agent' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await new Promise(r => setTimeout(r, 10)); // let microtasks flush

    expect(received).toEqual(['Test trend']);
  });

  it('partitions messages within a single group (round-robin)', async () => {
    const consumerA: string[] = [];
    const consumerB: string[] = [];
    bus.subscribe(STREAMS.rawSignals, msg => { consumerA.push(msg.id); }, { group: 'g', consumerName: 'a' });
    bus.subscribe(STREAMS.rawSignals, msg => { consumerB.push(msg.id); }, { group: 'g', consumerName: 'b' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await new Promise(r => setTimeout(r, 10));

    // 4 messages split across 2 consumers in the same group → each gets some,
    // none gets all (otherwise it isn't partitioned).
    expect(consumerA.length + consumerB.length).toBe(4);
    expect(consumerA.length).toBeGreaterThan(0);
    expect(consumerB.length).toBeGreaterThan(0);
  });

  it('duplicates messages across different groups', async () => {
    const filterReceived: number[] = [];
    const verifierReceived: number[] = [];

    bus.subscribe(STREAMS.rawSignals, async (msg) => {
      filterReceived.push(1);
      await bus.ack(STREAMS.rawSignals.name, msg.id);
    }, { group: 'filter-agent' });

    bus.subscribe(STREAMS.rawSignals, async (msg) => {
      verifierReceived.push(1);
      await bus.ack(STREAMS.rawSignals.name, msg.id);
    }, { group: 'analytics-tap' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await new Promise(r => setTimeout(r, 10));

    // Both groups should see both messages.
    expect(filterReceived).toHaveLength(2);
    expect(verifierReceived).toHaveLength(2);
  });

  it('returns the message id from publish', async () => {
    const id = await bus.publish(STREAMS.rawSignals, sampleMsg());
    expect(id).toMatch(/^mem-\d+$/);
  });
});

describe('MemoryStateBus.ack + pending', () => {
  it('un-acked messages show up in pending()', async () => {
    bus.subscribe(STREAMS.rawSignals, () => {
      // Intentionally never ack.
    }, { group: 'lazy-agent' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await new Promise(r => setTimeout(r, 10));

    const pending = await bus.pending('lazy-agent');
    expect(pending.length).toBe(2);
    expect(pending[0].consumerGroup).toBe('lazy-agent');
    expect(pending[0].deliveryCount).toBeGreaterThanOrEqual(1);
  });

  it('ack() removes the message from pending', async () => {
    let captured = '';
    bus.subscribe(STREAMS.rawSignals, async (msg) => {
      captured = msg.id;
      await bus.ack(STREAMS.rawSignals.name, msg.id);
    }, { group: 'good-citizen' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());
    await new Promise(r => setTimeout(r, 10));

    expect(captured).toMatch(/^mem-/);
    const pending = await bus.pending('good-citizen');
    expect(pending).toHaveLength(0);
  });

  it('redelivers un-acked messages after the redelivery window', async () => {
    let deliveries = 0;
    bus.subscribe(STREAMS.rawSignals, () => {
      deliveries++;
      // Don't ack — provoke redelivery.
    }, { group: 'bad-citizen' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());

    // After 250ms (> 200ms redelivery window), should have been redelivered at least once.
    await new Promise(r => setTimeout(r, 250));
    expect(deliveries).toBeGreaterThanOrEqual(2);
  });

  it('stops redelivering after maxRedeliveries', async () => {
    let deliveries = 0;
    bus.subscribe(STREAMS.rawSignals, () => {
      deliveries++;
    }, { group: 'broken' });

    await bus.publish(STREAMS.rawSignals, sampleMsg());

    // maxRedeliveries=2 → at most 2 total deliveries (initial + 1 redelivery)
    await new Promise(r => setTimeout(r, 700));
    expect(deliveries).toBeLessThanOrEqual(2);
  });
});

describe('MemoryStateBus.close', () => {
  it('rejects publish after close', async () => {
    await bus.close();
    await expect(bus.publish(STREAMS.rawSignals, sampleMsg())).rejects.toThrow(/closed/);
  });

  it('rejects subscribe after close', async () => {
    await bus.close();
    expect(() => bus.subscribe(STREAMS.rawSignals, () => {}, { group: 'g' })).toThrow(/closed/);
  });
});

describe('typed streams', () => {
  it('STREAMS.rawSignals carries RawSignalMessage at the type level', async () => {
    // This test exists primarily to assert at compile time that the typing
    // works. At runtime we just verify the publish accepts a valid shape.
    const id = await bus.publish(STREAMS.rawSignals, {
      signal: mkSignal({ title: 'Type-checked' }),
      brandId: 'b1',
      connectorId: 'reddit_live',
      fetchedAt: new Date(),
    });
    expect(id).toMatch(/^mem-/);
  });
});
