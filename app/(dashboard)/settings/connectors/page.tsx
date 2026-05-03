import * as React from 'react';
import Link from 'next/link';
import { requireBrand } from '@/lib/auth';
import { listConnectorOverview } from '@/lib/connectors';
import { listCredentials, getOrgCredentials } from '@/lib/credentials';
import { sourceLabel } from '@/components/trend/SourceIcon';
import { Chip } from '@/components/ui/Chip';
import { CredentialEditor } from '@/components/connectors/CredentialEditor';
import { TestButton } from '@/components/connectors/TestButton';

const KEY_SPECS: Record<string, { key: string; helper?: string; secret?: boolean }[]> = {
  X_BEARER_TOKEN:    [{ key: 'X_BEARER_TOKEN', helper: 'X / Twitter v2 Bearer token. Basic tier $200/mo.' }],
  YOUTUBE_API_KEY:   [{ key: 'YOUTUBE_API_KEY', helper: 'Google Cloud → APIs → YouTube Data v3.' }],
  REDDIT_USER_AGENT: [{ key: 'REDDIT_USER_AGENT', secret: false, helper: 'e.g. "trendjack/1.0 by u/yourname"' }],
  NITTER_INSTANCES:  [{ key: 'NITTER_INSTANCES', secret: false, helper: 'Comma-separated. e.g. https://nitter.net,https://nitter.privacydev.net' }],
  INVIDIOUS_INSTANCES: [{ key: 'INVIDIOUS_INSTANCES', secret: false, helper: 'Comma-separated public instances.' }],
  RSSHUB_BASE: [
    { key: 'RSSHUB_BASE', secret: false, helper: 'Public or self-hosted RSSHub URL. e.g. https://rsshub.app' },
    { key: 'RSSHUB_FEEDS', secret: false, helper: 'Comma-separated paths, e.g. /twitter/keyword/POVA,/producthunt/today' },
  ],
};

export default async function ConnectorsSettings() {
  const ctx = await requireBrand();
  const credList = await listCredentials(ctx.org!.id);
  const orgCreds = await getOrgCredentials(ctx.org!.id);
  const overview = listConnectorOverview();
  const has = (k: string) => !!orgCreds[k] || !!process.env[k];

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink-100">Connectors</h1>
        <p className="text-sm text-ink-300">
          Each source has multiple provider options. We auto-pick the best available — paid official APIs first, then open-source frontends, then mock fixtures.
        </p>
        <div className="flex items-center gap-2 mt-2 text-2xs text-ink-400">
          <Chip tone="good">official</Chip> paid first-party API
          <Chip tone="info">oss</Chip> open-source frontend
          <Chip tone="warn">mock</Chip> bundled fixtures
          <Link href="/settings/ai" className="ml-auto text-flare-400 hover:underline">Need to add an AI key? →</Link>
        </div>
      </header>

      {overview.map(o => {
        const optionKeys = Array.from(new Set(o.options.flatMap(opt => opt.requires)));
        return (
          <section key={o.source} className="rounded-md border border-ink-700 bg-ink-900 overflow-hidden">
            <header className="flex items-center gap-3 px-4 py-2.5 bg-ink-800/40 border-b border-ink-700">
              <span className="text-sm font-semibold text-ink-100">{sourceLabel(o.source)}</span>
              {'unconfigured' in o.active && o.active.unconfigured ? (
                <Chip tone="bad">unconfigured · setup required</Chip>
              ) : (
                <Chip tone={o.active.badge === 'official' ? 'good' : o.active.badge === 'oss' ? 'info' : 'warn'}>
                  active · {o.active.label}
                </Chip>
              )}
              <span className="ml-auto"><TestButton source={o.source} /></span>
            </header>
            {'unconfigured' in o.active && o.active.unconfigured && (
              <div className="px-4 py-3 bg-signal-red/5 border-b border-ink-700 text-xs">
                <p className="text-ink-100 mb-1">Source needs configuration. Refresh + ingest will skip it until set.</p>
                <p className="text-2xs text-ink-300">Required keys: {o.active.configRequiredKeys.map(k => <code key={k} className="font-mono text-flare-400 mr-1">{k}</code>)}</p>
              </div>
            )}
            <div className="divide-y divide-ink-700/40">
              {o.options.map(opt => {
                const requiredOk = (opt.requires.length === 0) || opt.requires.every(has);
                const inUse = !('unconfigured' in o.active && o.active.unconfigured) && opt.id === (o.active as { id: string }).id;
                return (
                  <div key={opt.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <Chip tone={opt.badge === 'official' ? 'good' : opt.badge === 'oss' ? 'info' : 'warn'}>{opt.badge}</Chip>
                    <span className="text-ink-100 font-medium">{opt.label}</span>
                    <span className="text-2xs font-mono text-ink-400">{opt.id}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {opt.requires.length > 0 && (
                        <span className="text-2xs font-mono text-ink-300">
                          requires:{' '}
                          {opt.requires.map(r => (
                            <span key={r} className={has(r) ? 'text-signal-green' : 'text-signal-red'}>{r} </span>
                          ))}
                        </span>
                      )}
                      {inUse && <Chip tone="flare">in use</Chip>}
                      {!requiredOk && <Chip tone="bad">env missing</Chip>}
                    </span>
                  </div>
                );
              })}
            </div>
            {optionKeys.length > 0 && (
              <div className="px-4 py-3 border-t border-ink-700 bg-ink-950/40 space-y-2">
                {optionKeys.map(k => {
                  const specs = KEY_SPECS[k] ?? [{ key: k }];
                  return (
                    <CredentialEditor
                      key={k}
                      title={k.replace(/_/g, ' ')}
                      keys={specs}
                      initial={credList.map(c => ({ key: c.key, mask: c.mask }))}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
