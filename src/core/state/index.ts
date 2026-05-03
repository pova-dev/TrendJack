// StateBus — agent message-passing primitive.
//
// Usage:
//
//   import { getBus, STREAMS } from '@/src/core/state';
//
//   const bus = getBus();
//
//   // Publisher (Scout):
//   await bus.publish(STREAMS.rawSignals, {
//     signal, brandId, connectorId, fetchedAt: new Date()
//   });
//
//   // Subscriber (Filter):
//   bus.subscribe(STREAMS.rawSignals, async (msg) => {
//     const result = score(msg.body.signal, { brand });
//     await bus.publish(STREAMS.scoredTrends, { ... });
//     await bus.ack(STREAMS.rawSignals.name, msg.id);
//   }, { group: 'filter-agent' });
//
// Backend selection: dev/test → MemoryStateBus, prod → RedisStreamsBus
// (Phase 8 deliverable). The `getBus()` factory hides the choice.

import type { StateBus } from './bus';
import { MemoryStateBus } from './memory';

export type { StateBus, Unsubscribe, PublishedMessage, PendingInfo, SubscribeOpts } from './bus';
export type {
  StreamId,
  RawSignalMessage,
  ScoredTrendMessage,
  VerifiedTrendMessage,
  LineageMessage,
  ResonanceMessage,
  CringeDecayMessage,
  AlertMessage,
} from './streams';
export { STREAMS } from './streams';
export { MemoryStateBus } from './memory';

// ---------------------------------------------------------------------------
// Singleton factory. Lazily constructs the bus on first access so importing
// this module has no side effects (matters for tests + Next.js HMR).

let _instance: StateBus | null = null;

export function getBus(): StateBus {
  if (!_instance) {
    _instance = createBus();
  }
  return _instance;
}

/** Force-replace the bus instance. Test-only — production code should never
 *  call this. Useful for hermetic tests that want a fresh bus per run. */
export function setBusForTests(bus: StateBus | null): void {
  _instance = bus;
}

function createBus(): StateBus {
  // Future: if (process.env.REDIS_URL) return new RedisStreamsBus(...).
  // For now, always in-memory. Phase 8 wires Redis.
  return new MemoryStateBus();
}
