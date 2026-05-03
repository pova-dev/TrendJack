'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { switchBrandAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

interface Brand { id: string; name: string; category: string; crisisMode?: boolean }

interface Props {
  current: Brand;
  brands: Brand[];
}

export function BrandSwitcher({ current, brands }: Props) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function pick(brandId: string) {
    setOpen(false);
    if (brandId === current.id) return;
    await switchBrandAction(brandId);
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-ink-800 text-sm font-semibold text-ink-100"
      >
        <span className="w-5 h-5 rounded-sm bg-flare-500/15 text-flare-400 text-2xs font-bold flex items-center justify-center">
          {current.name.slice(0, 1).toUpperCase()}
        </span>
        {current.name}
        <span className="text-ink-400 text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-72 rounded-md bg-ink-800 border border-ink-700 shadow-pop p-1">
          <div className="px-2 py-1 text-2xs font-mono uppercase tracking-wider text-ink-400">switch brand</div>
          {brands.map(b => (
            <button
              key={b.id}
              onClick={() => pick(b.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-2 rounded text-left',
                b.id === current.id ? 'bg-ink-700' : 'hover:bg-ink-700',
              )}
            >
              <span className="w-6 h-6 rounded-sm bg-flare-500/15 text-flare-400 text-xs font-bold flex items-center justify-center">
                {b.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink-100 truncate">{b.name}</span>
                <span className="block text-2xs text-ink-300 truncate">{b.category}</span>
              </span>
              {b.crisisMode && <span className="text-2xs font-mono text-signal-red">CRISIS</span>}
            </button>
          ))}
          <div className="border-t border-ink-700 mt-1 pt-1">
            <a href="/brand/new" className="block px-2 py-2 text-xs text-flare-400 hover:bg-ink-700 rounded">+ Add another brand</a>
          </div>
        </div>
      )}
    </div>
  );
}
