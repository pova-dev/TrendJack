'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

// Drawer behavior:
//   ≥sm (desktop / tablet): right-side panel, configurable width.
//   <sm (mobile): bottom-sheet — full viewport width, 92vh tall, slides
//                  up from the bottom. Drag handle at the top is visual
//                  only; tap-outside or Escape to dismiss.
//
// The single Drawer surface auto-adapts via Tailwind responsive
// utilities — no JS branching, no parent-driven layout switch.
export function Drawer({
  open,
  onClose,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-40 transition-opacity',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        // Inline width is desktop-only — overridden by sm:max-w / mobile
        // utilities below. We can't conditionally omit `style` because
        // the value is computed from props, so we pass it always and let
        // the mobile classes win via `sm:` reset of width.
        style={{ width: typeof window !== 'undefined' && window.innerWidth >= 640 ? width : undefined }}
        className={cn(
          // Desktop: side drawer, anchored right.
          'sm:absolute sm:right-0 sm:top-0 sm:h-full sm:border-l sm:border-ink-700',
          // Mobile: bottom-sheet pinned to the bottom edge.
          'absolute left-0 right-0 bottom-0 sm:left-auto h-[92vh] sm:h-full',
          // Visual + transition.
          'bg-ink-900 shadow-pop rounded-t-xl sm:rounded-none',
          'transition-transform duration-200 ease-out',
          // Open / closed transforms differ by axis: slide-from-bottom on
          // mobile, slide-from-right on desktop.
          open
            ? 'translate-y-0 sm:translate-x-0'
            : 'translate-y-full sm:translate-y-0 sm:translate-x-full',
        )}
      >
        {/* Mobile-only drag handle. Decorative — actual dismiss is
            tap-outside or Escape. Could be wired to pointer-events
            for a swipe-down gesture in a follow-up. */}
        <div className="sm:hidden flex justify-center py-2">
          <div className="w-10 h-1 rounded-full bg-ink-600" />
        </div>
        <div className="h-full overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
