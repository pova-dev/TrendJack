'use client';
// Publishes the board's contributions to the shell header: its signal counts
// and the + Column action.
//
// Was AddColumnButton, a client wrapper that rendered a whole TopBar purely so
// its button could dispatch an event. Now that the shell owns the header, this
// renders nothing and only supplies values, which is why the board no longer
// has to hand over the brand list to draw a header.

import * as React from 'react';
import { usePublishHeader } from './header-slot';

interface Props {
  trendCount: number;
  postNowCount: number;
  liveAt?: string;
}

export function BoardHeaderSlot({ trendCount, postNowCount, liveAt }: Props) {
  // The Board listens for this event rather than taking a callback, because
  // the board tree is mounted as a sibling of the header rather than beneath
  // it. Kept as-is: it already worked and is not what this refactor is about.
  const onAddColumn = React.useCallback(
    () => window.dispatchEvent(new CustomEvent('tj:add-column')),
    [],
  );

  usePublishHeader({ trendCount, postNowCount, liveAt, onAddColumn }, 'board');
  return null;
}
