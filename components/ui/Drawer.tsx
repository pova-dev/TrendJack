'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

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
        style={{ width }}
        className={cn(
          'absolute right-0 top-0 h-full bg-ink-900 border-l border-ink-700 shadow-pop',
          'transition-transform duration-150 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="h-full overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
