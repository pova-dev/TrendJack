'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';
import { usePushSubscribe } from '@/lib/hooks/use-push-subscribe';

// PWA install + push enrollment cluster.
//
// Two buttons, rendered conditionally:
//
//   ⤓ Install   — appears when the browser fires `beforeinstallprompt`.
//                 Per spec, prompt() must be called inside a user gesture,
//                 so we stash the event in state and only call .prompt()
//                 from the click handler.
//
//   🔔 Notify   — appears when push is supported by the browser AND the
//                 server has VAPID keys configured AND the user hasn't
//                 already subscribed. Clicking it triggers the
//                 Notification.requestPermission() + PushManager.subscribe()
//                 + POST /api/push/subscribe flow in usePushSubscribe.
//
// The cluster collapses entirely when both states are inactive
// (already-installed PWA + already-subscribed device, or unsupported).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);
  const push = usePushSubscribe();

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }
    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const showInstall = !installed && !!deferred;
  const showNotify = push.status === 'default';

  if (!showInstall && !showNotify) return null;

  return (
    <div className="flex items-center gap-2">
      {showInstall && (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!deferred) return;
            await deferred.prompt();
            const choice = await deferred.userChoice;
            if (choice.outcome === 'accepted') setInstalled(true);
            setDeferred(null);
          }}
          title="Install TrendJack as a desktop / home-screen app"
        >
          ⤓ Install
        </Button>
      )}
      {showNotify && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void push.subscribe()}
          title="Get push notifications when CVS-gated alerts fire"
        >
          🔔 Notify
        </Button>
      )}
    </div>
  );
}
