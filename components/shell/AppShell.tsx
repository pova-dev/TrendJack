import * as React from 'react';
import { LeftRail } from './LeftRail';
import { Copilot } from '@/components/copilot/Copilot';

interface Props {
  user: { name: string; email: string };
  children: React.ReactNode;
}

export function AppShell({ children, user }: Props) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-900 text-ink-100">
      <LeftRail user={user} />
      <main className="flex flex-col flex-1 min-w-0">{children}</main>
      <Copilot />
    </div>
  );
}
