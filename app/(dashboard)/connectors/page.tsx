import * as React from 'react';
import Link from 'next/link';
import { listConnectorOverview } from '@/lib/connectors';
import { getBrand, listBrandsForOrg } from '@/lib/store';
import { sourceLabel } from '@/components/trend/SourceIcon';
import { Chip } from '@/components/ui/Chip';
import { TopBar } from '@/components/shell/TopBar';
import { requireBrand } from '@/lib/auth';
import { listCredentials, getOrgCredentials } from '@/lib/credentials';
import { CredentialEditor } from '@/components/connectors/CredentialEditor';
import { TestButton } from '@/components/connectors/TestButton';

// Per-source credential metadata. Drives the inline editors so the user
// can type / paste a key right next to the connector option that needs it.
/** Social analytics credentials.
 *
 *  These belong to no entry in the connector registry, so the per-source loop
 *  below never renders them and they were unreachable from the UI: the API
 *  accepted them, but nothing offered a field. Given their own section so an
 *  operator can add a token without touching a file or redeploying. */
const SOCIAL_KEY_SPECS: { key: string; helper?: string; secret?: boolean }[] = [
  { key: 'YOUTUBE_API_KEY', helper: 'Free. Google Cloud → APIs → YouTube Data v3. Covers your channel AND every competitor, including comment text. Start here.' },
  { key: 'APIFY_TOKEN', helper: 'apify.com → Settings → Integrations. Needed only for competitor Instagram; billed per result.' },
  { key: 'APIFY_ACTOR_INSTAGRAM_PROFILE', secret: false, helper: 'Handle → followers + recent posts. e.g. apify/instagram-profile-scraper' },
  { key: 'APIFY_ACTOR_INSTAGRAM_POST', secret: false, helper: 'Post URL → deep engagement. e.g. patient_discovery/instagram-reel-analytics-by-url' },
  { key: 'APIFY_ACTOR_FACEBOOK_POST', secret: false, helper: 'Post URL → likes / views / comment count. e.g. clappi/facebook-posts-reels-scraper' },
  { key: 'APIFY_ACTOR_YOUTUBE_VIDEO', secret: false, helper: 'Optional. The free YouTube API returns more than this actor does.' },
  { key: 'META_ACCESS_TOKEN', helper: 'Long-lived Page token with pages_read_engagement + instagram_basic. Free and exact, for accounts you own.' },
];

const KEY_SPECS: Record<string, { key: string; helper?: string; secret?: boolean }[]> = {
  X_BEARER_TOKEN:    [{ key: 'X_BEARER_TOKEN', helper: 'X / Twitter v2 Bearer token. Basic tier $200/mo.' }],
  YOUTUBE_API_KEY:   [{ key: 'YOUTUBE_API_KEY', helper: 'Google Cloud → APIs → YouTube Data v3. 10k unit free quota/day.' }],
  REDDIT_USER_AGENT: [{ key: 'REDDIT_USER_AGENT', secret: false, helper: 'Reddit asks for a polite UA. e.g. "trendjack/1.0 by u/yourname"' }],
  NITTER_INSTANCES:  [{ key: 'NITTER_INSTANCES', secret: false, helper: 'Comma-separated. e.g. https://nitter.net,https://nitter.privacydev.net' }],
  INVIDIOUS_INSTANCES: [{ key: 'INVIDIOUS_INSTANCES', secret: false, helper: 'Comma-separated public instances. e.g. https://yewtu.be,https://invidious.fdn.fr' }],
  RSSHUB_BASE:       [
    { key: 'RSSHUB_BASE', secret: false, helper: 'Public or self-hosted RSSHub URL. e.g. https://rsshub.app' },
    { key: 'RSSHUB_FEEDS', secret: false, helper: 'Comma-separated paths, e.g. /twitter/keyword/POVA,/producthunt/today' },
  ],
};

export default async function ConnectorsPage() {
  const ctx = await requireBrand();
  const brand = await getBrand(ctx.brand.id);
  if (!brand) return null;
  const brands = await listBrandsForOrg(ctx.org!.id);
  const credList = await listCredentials(ctx.org!.id);
  // Re-resolve overview with org creds in mind by injecting into env briefly?
  // Simpler: pass the cred list to the page and decorate availability there.
  const orgCreds = await getOrgCredentials(ctx.org!.id);
  const overview = listConnectorOverview();
  const has = (k: string) => !!orgCreds[k] || !!process.env[k];

  return (
    <>
      <TopBar
        brand={{ id: brand.id, name: brand.name, category: brand.category, crisisMode: brand.crisisMode }}
        brands={brands.map(b => ({ id: b.id, name: b.name, category: b.category, crisisMode: b.crisisMode }))}
        trendCount={0}
        postNowCount={0}
      />
      <div className="flex-1 overflow-y-auto p-6 max-w-5xl space-y-5">
        <header>
          <h1 className="text-xl font-semibold text-ink-100 mb-1">Connectors</h1>
          <p className="text-sm text-ink-300">
            Each source has multiple provider options. We auto-pick the best available — paid official APIs first, then open-source frontends, then mock fixtures.
            Add API keys below; they unlock the matching option without restarting.
          </p>
          <div className="flex items-center gap-2 mt-2 text-2xs text-ink-400">
            <Chip tone="good">official</Chip> paid first-party API
            <Chip tone="info">oss</Chip> open-source frontend
            <Chip tone="warn">mock</Chip> bundled fixtures
            <Link href="/settings/ai" className="ml-auto text-flare-400 hover:underline">Need to add an AI key? →</Link>
          </div>
        </header>

        <section className="rounded-md border border-ink-700 bg-ink-900 overflow-hidden">
          <header className="flex items-center gap-3 px-4 py-2.5 bg-ink-800/40 border-b border-ink-700">
            <span className="text-sm font-semibold text-ink-100">Social analytics</span>
            <span className="text-2xs text-ink-400">powers the Social tab</span>
            <span className="ml-auto flex items-center gap-2 text-2xs font-mono">
              <span className={has('YOUTUBE_API_KEY') ? 'text-signal-green' : 'text-ink-400'}>YouTube</span>
              <span className={has('APIFY_TOKEN') ? 'text-signal-green' : 'text-ink-400'}>Apify</span>
              <span className={has('META_ACCESS_TOKEN') ? 'text-signal-green' : 'text-ink-400'}>Meta</span>
            </span>
          </header>
          <div className="px-4 py-3 space-y-2">
            <p className="text-2xs text-ink-400">
              A YouTube key alone tracks every channel on your list, competitors included, and costs nothing.
              Apify is only required for competitor Instagram. Meta is only for accounts you own.
            </p>
            <CredentialEditor
              title=""
              keys={SOCIAL_KEY_SPECS}
              initial={credList.map(c => ({ key: c.key, mask: c.mask }))}
            />
          </div>
        </section>

        {overview.map(o => {
          // For this source, gather the env-key sets across all of its options.
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
                  <p className="text-ink-100 mb-1">
                    This source needs configuration before TrendJack can pull data.
                    Refresh + ingest will skip it until you set it up.
                  </p>
                  <p className="text-2xs text-ink-300">
                    Required keys:{' '}
                    {o.active.configRequiredKeys.map(k => <code key={k} className="font-mono text-flare-400 mr-1">{k}</code>)}
                  </p>
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

        <p className="text-2xs text-ink-400">
          Stored encrypted (AES-256-GCM) at the org level. Restart not required — added keys take effect on the next refresh / poll.
        </p>
      </div>
    </>
  );
}
