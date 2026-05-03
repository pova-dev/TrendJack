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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-flare-500',
        'disabled:opacity-40 disabled:pointer-events-none',
        size === 'xs' && 'h-6 px-2 text-2xs',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-9 px-3.5 text-sm',
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
