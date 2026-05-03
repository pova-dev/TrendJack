'use client';
import * as React from 'react';
import { Button } from '@/components/ui/Button';

// PWA install prompt — captures the browser's deferred
// `beforeinstallprompt` event and surfaces an Install button when
// the page is eligible. Hidden on already-installed PWAs (display
// mode = standalone) and on browsers that don't support installation.
//
// Per spec, the prompt() call MUST be in response to a user gesture.
// We stash the event in state and call prompt() inside the click
// handler, which keeps Chromium happy.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);

  React.useEffect(() => {
    // Already installed?
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

  if (installed || !deferred) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') setInstalled(true);
        setDeferred(null);
      }}
      title="Install TrendJack as a desktop / home-screen app"
    >
      ⤓ Install
    </Button>
  );
}
