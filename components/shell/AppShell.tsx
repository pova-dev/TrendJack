import * as React from 'react';
import { LeftRail } from './LeftRail';
import { Copilot } from '@/components/copilot/Copilot';
import { StepUpPrompt } from '@/components/auth/StepUpPrompt';
import { AppHeader } from './AppHeader';
import { HeaderSlotProvider } from './header-slot';

interface Brand { id: string; name: string; category: string; crisisMode?: boolean }

interface Props {
  user: { name: string; email: string };
  brand: Brand;
  brands: Brand[];
  canAdmin: boolean;
  children: React.ReactNode;
}

// The shell owns the header.
//
// It used to be each page's job, which produced eleven duplicate mounts and
// eight pages with no header at all, including every settings screen. Pages
// skipped it because it required six props, so drawing a header meant first
// fetching the brand list. The layout already resolves user, org and brand and
// was throwing all of it away.
//
// Now the layout passes what it already has, the header renders once, and a
// page with something extra to contribute publishes it through HeaderSlot.
export function AppShell({ children, user, brand, brands, canAdmin }: Props) {
  return (
    <HeaderSlotProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-ink-900 text-ink-100">
        <LeftRail user={user} />
        <div className="flex flex-col flex-1 min-w-0">
          <AppHeader brand={brand} brands={brands} canAdmin={canAdmin} />
          <main className="flex flex-col flex-1 min-h-0">{children}</main>
        </div>
        <Copilot />
        {/* Mounted once for the whole app. Every destructive action anywhere
            raises this same prompt rather than carrying its own copy. */}
        <StepUpPrompt />
      </div>
    </HeaderSlotProvider>
  );
}
