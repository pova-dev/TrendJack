'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md';

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(({ className, variant = 'subtle', size = 'sm', ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium',
        // Motion-safe transition — respects prefers-reduced-motion at the
        // Tailwind utility level.
        'motion-safe:transition-colors',
        // Focus ring: 2px with 2px offset against ink-900 surface so the
        // ring stays visible on flare-colored buttons (was 1px ring on
        // flare-on-flare = invisible per the Visual Auditor finding).
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flare-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
        'disabled:opacity-40 disabled:pointer-events-none',
        // Touch-target sizing — mobile gets HIG-compliant 44px floor;
        // desktop keeps the dense h-7/h-9. Apple HIG floor is 44pt; Material 3
        // is 48dp. h-11 = 44px Tailwind.
        size === 'xs' && 'h-11 px-3 text-2xs sm:h-6 sm:px-2',
        size === 'sm' && 'h-11 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-xs',
        size === 'md' && 'h-11 px-4 text-sm sm:h-9 sm:px-3.5',
        variant === 'primary' && 'bg-flare-500 text-ink-950 hover:bg-flare-400',
        variant === 'subtle' && 'bg-ink-700 text-ink-100 hover:bg-ink-600',
        variant === 'ghost' && 'text-ink-200 hover:bg-ink-700',
        variant === 'outline' && 'border border-ink-600 text-ink-100 hover:bg-ink-800',
        variant === 'danger' && 'bg-signal-red/15 text-signal-red hover:bg-signal-red/25',
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = 'Button';
