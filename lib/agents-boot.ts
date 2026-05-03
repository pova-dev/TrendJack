// Production boot — wires the agentic pipeline into the live runtime.
//
// Runs once per Node process (idempotent via a module-level flag) when
// the dashboard layout first renders. The cron (lib/cron.ts) drives
// Scout polling; Scout publishes to STREAMS.rawSignals; Filter / Verifier
// / Architect subscribe and process from there.
//
// Architecture during the migration window:
//   - Scout publishes raw signals to the bus (dryRun=false)
//   - The legacy synchronous score+persist loop in lib/ingest.ts still
//     writes the DB, so dashboard data continues to flow.
//   - Filter Agent subscribes and re-scores in parallel — currently
//     produces telemetry only (does not double-write to DB). Once we've
//     verified parity over a full ingest cycle the inline score+persist
//     in lib/ingest.ts can be deleted in favor of the Filter Agent path.
//   - Verifier subscribes to scoredTrends and stubs (no premium-AI calls
//     until ANTHROPIC_API_KEY / etc. are wired in via the verifier
//     adapter swap).
//   - Architect monitors pending() for stuck messages.

import 'server-only';
import { getBus } from '@/src/core/state';
import { startFilterAgent } from '@/src/agents/filter';
import { startVerifierAgent, stubVerifier } from '@/src/agents/verifier';
import { startArchitectAgent } from '@/src/agents/architect';
import { bootstrapConnectors } from '@/src/connectors';
import { getBrand } from './store';

interface AgentRunState {
  startedAt: Date;
  filterRunning: boolean;
  verifierRunning: boolean;
  architectRunning: boolean;
  stuckMessages: number;
}

declare global {
  var __tj_agents_boot__: AgentRunState | undefined;
}

export function bootAgents(): AgentRunState {
  if (globalThis.__tj_agents_boot__) {
    return globalThis.__tj_agents_boot__;
  }

  bootstrapConnectors();

  const bus = getBus();

  startFilterAgent({
    bus,
    loadBrand: async (brandId) => getBrand(brandId),
  });

  startVerifierAgent({
    bus,
    adapter: stubVerifier,
  });

  let stuckMessages = 0;
  startArchitectAgent({
    bus,
    onStuck: () => { stuckMessages++; },
    monitorGroups: ['filter-agent', 'verifier-agent'],
  });

  const state: AgentRunState = {
    startedAt: new Date(),
    filterRunning: true,
    verifierRunning: true,
    architectRunning: true,
    get stuckMessages() { return stuckMessages; },
  } as AgentRunState;

  globalThis.__tj_agents_boot__ = state;

  // eslint-disable-next-line no-console
  console.log('[agents-boot] Filter + Verifier + Architect started — bus subscribed');
  return state;
}

export function getAgentState(): AgentRunState | null {
  return globalThis.__tj_agents_boot__ ?? null;
}
