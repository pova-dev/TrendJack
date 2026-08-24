// Burst coalescing for realtime-triggered refetches.
//
// The board subscribes to per-trend SSE events, but ingestion arrives in
// bursts: one cron tick inserts 100+ trends and each insert publishes its own
// event. Refetching per event produced ~125 requests per minute from a single
// idle tab, each a ~840ms scan over the trend table, measured at ~7,500
// requests/hour with nobody touching the page.
//
// Two guarantees, which together are what make bursts cheap:
//   1. Debounce  - events inside the window collapse into one run.
//   2. Single-flight - only one run at a time. Triggers that arrive mid-flight
//      schedule exactly one follow-up rather than queueing per event, so the
//      board still converges on the latest state without stampeding.
//
// Extracted from the component so the behaviour can be tested without a DOM.

export interface Coalescer {
  /** Request a run. Cheap to call in a tight loop. */
  trigger: () => void;
  /** Cancel any pending run. Call on unmount. */
  cancel: () => void;
  /** Run now, bypassing the debounce (still single-flight). */
  flush: () => Promise<void>;
}

export function createCoalescer(
  fn: () => Promise<void>,
  debounceMs = 1_500,
): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let queued = false;

  async function run(): Promise<void> {
    if (inFlight) { queued = true; return; }
    inFlight = true;
    try {
      await fn();
    } catch {
      // Swallowed on purpose. Runs are started by a timer with no caller left
      // to await them, so a rejection here would surface as an unhandled
      // promise rejection rather than anything actionable. Reporting failure
      // is the callback's job: the board catches internally and shows a
      // "showing last known data" banner.
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        // Tail run picks up whatever landed while we were busy. Deliberately
        // not awaited by the caller that set `queued`, which has already
        // returned; convergence matters, ordering does not.
        void run();
      }
    }
  }

  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void run(); }, debounceMs);
    },
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      queued = false;
    },
    flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      return run();
    },
  };
}
