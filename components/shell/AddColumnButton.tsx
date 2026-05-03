'use client';
// Tiny client-side wrapper around TopBar so its + Column button can dispatch
// the global event the Board listens for. Keeps the page server-side.

import * as React from 'react';
import { TopBar } from './TopBar';

interface Brand { id: string; name: string; category: string; crisisMode?: boolean }

interface Props {
  brand: Brand;
  brands: Brand[];
  trendCount: number;
  postNowCount: number;
}

export function AddColumnButton(props: Props) {
  return (
    <TopBar
      {...props}
      onAddColumn={() => window.dispatchEvent(new CustomEvent('tj:add-column'))}
    />
  );
}
