'use client';
import * as React from 'react';

interface BoardStreamHandlers {
  onTrendChange?: () => void;
  onProfileChange?: () => void;
  onWeightsChange?: () => void;
  onTick?: (at: string) => void;
}

// Subscribes to the board SSE stream and routes typed events to handlers.
// Auto-reconnects with exponential backoff up to 30s.
export function useBoardStream(boardId: string | null, handlers: BoardStreamHandlers) {
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!boardId) return;

    let es: EventSource | null = null;
    let backoff = 1000;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      es = new EventSource(`/api/stream/board/${boardId}`);
      es.addEventListener('open', () => { backoff = 1000; });

      const handleAny = () => handlersRef.current.onTrendChange?.();
      es.addEventListener('trend.created', handleAny);
      es.addEventListener('trend.updated', handleAny);
      es.addEventListener('trend.dismissed', handleAny);

      es.addEventListener('brand.profile_changed', () => handlersRef.current.onProfileChange?.());
      es.addEventListener('brand.crisis_toggle', () => handlersRef.current.onProfileChange?.());
      es.addEventListener('brand.weights_changed', () => handlersRef.current.onWeightsChange?.());
      es.addEventListener('tick', e => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          handlersRef.current.onTick?.(data.at);
        } catch { /* noop */ }
      });

      es.addEventListener('error', () => {
        es?.close();
        if (cancelled) return;
        backoff = Math.min(backoff * 2, 30_000);
        retryTimer = setTimeout(connect, backoff);
      });
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [boardId]);
}
