'use client';
import * as React from 'react';

// Lets the shell own one header while pages still contribute their own bits.
//
// The header used to be mounted by each page, which meant eleven copies of the
// same component and eight pages with no header at all. The reason pages
// skipped it is that it demanded six props, so drawing a header meant fetching
// the brand list first. connectors/page.tsx passed `trendCount={0}` purely to
// satisfy the type, which is a fabricated number on screen and exactly the
// thing hard-rule 1 exists to prevent.
//
// Inverting it fixes both: the shell renders the header from context it
// already resolved, and a page that has something extra to show publishes it
// here. A page that has nothing extra does nothing, and still gets a header.

export interface HeaderSlot {
  /** Signals currently loaded on this page. Absent means "not applicable
   *  here", which renders nothing rather than a zero. */
  trendCount?: number;
  postNowCount?: number;
  /** ISO timestamp of the last ingest tick. */
  liveAt?: string;
  /** Board-specific. Present only where adding a column means something. */
  onAddColumn?: () => void;
}

const SlotContext = React.createContext<HeaderSlot>({});
const SetSlotContext = React.createContext<(patch: HeaderSlot, key: string) => void>(() => {});

export function HeaderSlotProvider({ children }: { children: React.ReactNode }) {
  // Keyed by publisher so two publishers on one page merge instead of
  // clobbering each other, and so unmounting one only withdraws its own keys.
  const [entries, setEntries] = React.useState<Record<string, HeaderSlot>>({});

  const publish = React.useCallback((patch: HeaderSlot, key: string) => {
    setEntries(prev => {
      const next = { ...prev };
      if (Object.keys(patch).length === 0) delete next[key];
      else next[key] = patch;
      return next;
    });
  }, []);

  const merged = React.useMemo<HeaderSlot>(
    () => Object.values(entries).reduce<HeaderSlot>((acc, e) => ({ ...acc, ...e }), {}),
    [entries],
  );

  return (
    <SetSlotContext.Provider value={publish}>
      <SlotContext.Provider value={merged}>{children}</SlotContext.Provider>
    </SetSlotContext.Provider>
  );
}

/** Read the merged slot. Used by the header itself. */
export function useHeaderSlot(): HeaderSlot {
  return React.useContext(SlotContext);
}

/**
 * Publish into the header from anywhere below the shell.
 *
 * Withdraws on unmount, so navigating away from the board cannot leave a stale
 * "+ Column" button pointing at a page that no longer exists.
 */
export function usePublishHeader(slot: HeaderSlot, key: string): void {
  const publish = React.useContext(SetSlotContext);

  // Depend on the values rather than the object, so a caller passing an inline
  // object literal does not republish on every render and loop.
  const { trendCount, postNowCount, liveAt, onAddColumn } = slot;

  React.useEffect(() => {
    publish({ trendCount, postNowCount, liveAt, onAddColumn }, key);
    return () => publish({}, key);
  }, [publish, key, trendCount, postNowCount, liveAt, onAddColumn]);
}

/**
 * Server-page friendly publisher. Renders nothing.
 *
 * Server components cannot call hooks, so a server page drops this in and the
 * client half does the publishing.
 */
export function HeaderMetrics(props: { trendCount?: number; postNowCount?: number; liveAt?: string; slotKey?: string }) {
  const { trendCount, postNowCount, liveAt, slotKey = 'page' } = props;
  usePublishHeader({ trendCount, postNowCount, liveAt }, slotKey);
  return null;
}
