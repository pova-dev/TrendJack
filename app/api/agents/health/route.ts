import { NextResponse } from 'next/server';
import { getAgentState } from '@/lib/agents-boot';
import { listRegistered } from '@/src/connectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agents/health — agent + connector status.
// Returns the boot state of Filter / Verifier / Architect, the
// registered connector list with cadence, and stuck-message count.
// Used by the operator to verify the agentic pipeline is actually
// running in their deployment.
export async function GET() {
  const state = getAgentState();
  const connectors = listRegistered().map(c => ({
    id: c.id,
    source: c.source,
    cadenceSec: c.cadenceSec,
  }));

  return NextResponse.json({
    booted: !!state,
    startedAt: state?.startedAt ?? null,
    agents: {
      filter:    state?.filterRunning ?? false,
      verifier:  state?.verifierRunning ?? false,
      architect: state?.architectRunning ?? false,
    },
    stuckMessages: state?.stuckMessages ?? 0,
    connectors,
  });
}
