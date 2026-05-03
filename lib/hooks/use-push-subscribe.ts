'use client';
import * as React from 'react';

// Client-side helper that registers a Web Push subscription with the
// active service worker, then POSTs the subscription to /api/push/subscribe
// so the delivery worker can reach this device.
//
// Status states:
//   - "unsupported"   — browser doesn't support Notification or PushManager
//   - "unconfigured"  — server has no VAPID keys (worker idle)
//   - "denied"        — user blocked notification permission
//   - "default"       — user hasn't decided yet (button can prompt)
//   - "subscribed"    — active subscription registered + POSTed
//   - "error"         — last subscribe attempt failed (see message)

export type PushStatus =
  | 'loading'
  | 'unsupported'
  | 'unconfigured'
  | 'denied'
  | 'default'
  | 'subscribed'
  | 'error';

interface PushHook {
  status: PushStatus;
  message?: string;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscribe(): PushHook {
  const [status, setStatus] = React.useState<PushStatus>('loading');
  const [message, setMessage] = React.useState<string | undefined>();

  // Initial probe — check support, current permission, existing subscription.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setStatus('unsupported');
        return;
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          if (!cancelled) setStatus('subscribed');
          return;
        }
        if (Notification.permission === 'denied') {
          if (!cancelled) setStatus('denied');
          return;
        }
        if (!cancelled) setStatus(Notification.permission === 'granted' ? 'default' : 'default');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const subscribe = React.useCallback(async () => {
    setMessage(undefined);
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }

    try {
      // 1. Request notification permission (must be in a user gesture).
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setStatus(perm === 'denied' ? 'denied' : 'default');
          return;
        }
      }
      if (Notification.permission !== 'granted') {
        setStatus('denied');
        return;
      }

      // 2. Fetch the VAPID public key from the server.
      const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
      if (!keyRes.ok) {
        setStatus('error');
        setMessage('Server did not return a VAPID key.');
        return;
      }
      const keyJson = (await keyRes.json()) as { configured: boolean; publicKey?: string };
      if (!keyJson.configured || !keyJson.publicKey) {
        setStatus('unconfigured');
        return;
      }

      // 3. Subscribe to push via the SW.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to BufferSource — TS lib.dom narrows applicationServerKey
        // to ArrayBufferView<ArrayBuffer>, but Uint8Array's buffer is
        // ArrayBufferLike. The runtime accepts both.
        applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey) as BufferSource,
      });

      // 4. POST the subscription to the server for persistence.
      const postRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(sub.toJSON()),
      });
      if (!postRes.ok) {
        setStatus('error');
        setMessage(`Server rejected subscription (HTTP ${postRes.status}).`);
        return;
      }
      setStatus('subscribed');
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message);
    }
  }, []);

  const unsubscribe = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: 'DELETE',
          credentials: 'include',
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus('default');
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message);
    }
  }, []);

  return { status, message, subscribe, unsubscribe };
}

// VAPID public keys are URL-safe base64; PushManager.subscribe wants a
// raw Uint8Array. This is the standard reference conversion from MDN.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
