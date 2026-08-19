// Architect agent tests — the DLQ path had zero coverage, which is how it
// shipped with a type error that broke `npm run build` (AuditLog.orgId is
// required; the handler passed no org). These lock the contract down:
//   - stuck messages (> stuckThresholdMs) fire onStuck
//   - unrecoverable messages (> dlqThresholdMs) fire onDlq, not onStuck
//   - the default DLQ handler degrades to stderr when no dlqOrgId is set
//   - a permanently stuck message is reported once, not once per scan

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PendingInfo, StateBus } from '@/src/core/state';
import { startArchitectAgent, defaultDlqHandler } from '@/src/agents/architect';

const mkPending = (over: Partial<PendingInfo> = {}): PendingInfo => ({
  msgId: 'msg-1',
  streamName: 'rawSignals',
  consumerGroup: 'filter-agent',
  consumerName: 'consumer-1',
  idleMs: 0,
  deliveryCount: 1,
  ...over,
});

/** Minimal StateBus stub — the Architect only ever calls pending(). */
const mkBus = (pending: PendingInfo[]): StateBus =>
  ({ pending: vi.fn(async () => pending) } as unknown as StateBus);

describe('startArchitectAgent — threshold routing', () => {
  it('fires onStuck for a message past the stuck threshold', async () => {
    const onStuck = vi.fn();
    const onDlq = vi.fn();
    const a = startArchitectAgent({
      bus: mkBus([mkPending({ idleMs: 90_000 })]),
      monitorGroups: ['filter-agent'],
      stuckThresholdMs: 60_000,
      dlqThresholdMs: 300_000,
      onStuck,
      onDlq,
    });
    await a.scanNow();
    a.stop();

    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onDlq).not.toHaveBeenCalled();
  });

  it('escalates to onDlq past the DLQ threshold and skips onStuck', async () => {
    const onStuck = vi.fn();
    const onDlq = vi.fn();
    const a = startArchitectAgent({
      bus: mkBus([mkPending({ idleMs: 600_000, deliveryCount: 7 })]),
      monitorGroups: ['filter-agent'],
      stuckThresholdMs: 60_000,
      dlqThresholdMs: 300_000,
      onStuck,
      onDlq,
    });
    await a.scanNow();
    a.stop();

    expect(onStuck).not.toHaveBeenCalled();
    expect(onDlq).toHaveBeenCalledTimes(1);
    // The group is what tells an operator WHICH agent is wedged.
    expect(onDlq.mock.calls[0][0]).toMatchObject({
      msgId: 'msg-1',
      group: 'filter-agent',
      deliveryCount: 7,
    });
  });

  it('leaves a healthy message alone', async () => {
    const onStuck = vi.fn();
    const onDlq = vi.fn();
    const a = startArchitectAgent({
      bus: mkBus([mkPending({ idleMs: 500 })]),
      monitorGroups: ['filter-agent'],
      onStuck,
      onDlq,
    });
    await a.scanNow();
    a.stop();

    expect(onStuck).not.toHaveBeenCalled();
    expect(onDlq).not.toHaveBeenCalled();
  });

  it('does not let one failing group abort the scan of the others', async () => {
    const onDlq = vi.fn();
    const bus = {
      pending: vi.fn(async (group: string) => {
        if (group === 'filter-agent') throw new Error('redis down');
        return [mkPending({ idleMs: 600_000, msgId: 'msg-ok' })];
      }),
    } as unknown as StateBus;

    const a = startArchitectAgent({
      bus,
      monitorGroups: ['filter-agent', 'verifier-agent'],
      dlqThresholdMs: 300_000,
      onDlq,
    });
    await a.scanNow();
    a.stop();

    expect(onDlq).toHaveBeenCalledTimes(1);
    expect(onDlq.mock.calls[0][0]).toMatchObject({ msgId: 'msg-ok' });
  });
});

describe('defaultDlqHandler — no owning org', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it('logs to stderr instead of writing a tenant-less audit row', async () => {
    // AuditLog.orgId is non-null and the Architect is a process singleton,
    // so with no dlqOrgId there is no correct tenant to attribute this to.
    await defaultDlqHandler({ ...mkPending({ msgId: 'no-org-1' }), group: 'filter-agent' });

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain('[architect] DLQ');
    expect(String(errSpy.mock.calls[0][1])).toContain('no-org-1');
  });

  it('reports a permanently stuck message once, not once per scan', async () => {
    const info = { ...mkPending({ msgId: 'repeat-1' }), group: 'filter-agent' };
    await defaultDlqHandler(info);
    await defaultDlqHandler(info);
    await defaultDlqHandler(info);

    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
