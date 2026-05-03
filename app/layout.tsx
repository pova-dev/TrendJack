import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrendJack — POVA War Room',
  description: 'Real-time trend hijacking command center',
  manifest: '/manifest.webmanifest',
  themeColor: '#0a0a10',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'TrendJack',
  },
};

// No-FOUC theme bootstrap. Runs before paint to set html.dark / html.light
// based on (in order): localStorage → system preference → dark default.
// Without this the page would render dark first then snap to light on
// hydration, causing a visible flash.
const THEME_BOOTSTRAP = `
(function(){
  try {
    var stored = localStorage.getItem('tj-theme');
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var resolved = stored === 'light' || stored === 'dark'
      ? stored
      : (prefersLight ? 'light' : 'dark');
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
  } catch(e) {}
})();
`.trim();

// Dev-only window-error → server-log relay. Lets me read browser-side
// errors via the dev server log when DevTools isn't available.
const ERROR_RELAY = `
(function(){
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  function send(payload) {
    try {
      navigator.sendBeacon
        ? navigator.sendBeacon('/api/devlog', new Blob([JSON.stringify(payload)], {type:'application/json'}))
        : fetch('/api/devlog', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload), keepalive:true });
    } catch(e) {}
  }
  window.addEventListener('error', function(e){
    send({
      kind: 'error',
      message: (e.error && e.error.message) || e.message || 'unknown',
      stack: (e.error && e.error.stack) || null,
      filename: e.filename, lineno: e.lineno, colno: e.colno,
      url: location.href,
    });
  });
  window.addEventListener('unhandledrejection', function(e){
    send({
      kind: 'unhandledrejection',
      message: (e.reason && (e.reason.message || String(e.reason))) || 'unknown',
      stack: (e.reason && e.reason.stack) || null,
      url: location.href,
    });
  });
  console.error = (function(orig){
    return function(){
      try { send({ kind: 'console.error', args: Array.from(arguments).map(a => { try { return typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a); } catch { return String(a); } }) }); } catch(e) {}
      return orig.apply(this, arguments);
    };
  })(console.error);
})();
`.trim();

// Service-worker registration. Wires the PWA install + push delivery
// path. Only registers in production (`navigator.serviceWorker` is
// available in dev too but Next's HMR + SW caching interact badly).
const SW_REGISTER = `
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(function(e){
    console.warn('[tj-sw] register failed:', e && e.message);
  });
}
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning because the theme-bootstrap script mutates
  // <html>'s class before React hydrates; that's expected and we don't
  // want a noisy hydration warning for it.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: ERROR_RELAY }} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: SW_REGISTER }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
