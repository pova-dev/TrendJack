'use client';
import * as React from 'react';
import type { ColumnConfig, ColumnType, Recommendation, SourceId } from '@/types';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ChipInput } from '@/components/brand/ChipInput';

const TYPES: { value: ColumnType; label: string; helper: string }[] = [
  { value: 'brand_matches',         label: 'Brand Matches',     helper: 'Top opportunity, brand-fit gated' },
  { value: 'first_mover_window',    label: 'First-Mover',       helper: 'Trends nobody has claimed yet' },
  { value: 'rising_trends',         label: 'Rising',            helper: 'Sorted by velocity' },
  { value: 'high_velocity',         label: 'High Velocity',     helper: 'Velocity > 200/h' },
  { value: 'competitor_activity',   label: 'Competitor Activity', helper: 'Trends already claimed by a competitor' },
  { value: 'risk_watch',            label: 'Risk Watch',        helper: 'Risk score ≥ 0.5' },
  { value: 'decay_watch',           label: 'Decay Watch',       helper: 'Past 70% of life — avoid' },
  { value: 'emerging_memes',        label: 'Emerging Memes',    helper: 'TikTok/Reels meme formats' },
  { value: 'creator_signals',       label: 'Creator Signals',   helper: 'Influencer-led conversations' },
  { value: 'compliance_hold',       label: 'Compliance Hold',   helper: 'Auto-flagged for review' },
  { value: 'localization_queue',    label: 'Localization',      helper: 'Trends to adapt per market' },
  { value: 'crisis_watch',          label: 'Crisis Watch',      helper: 'Brand sentiment dips' },
  { value: 'alerts',                label: 'Alerts',            helper: 'Rule-driven event feed' },
  { value: 'custom',                label: 'Custom',            helper: 'Bring your own filter' },
];

const SOURCES: SourceId[] = ['x', 'reddit', 'youtube', 'tiktok', 'google_trends', 'news', 'custom'];
const RECS: Recommendation[] = ['POST_NOW', 'PREP_1H', 'MONITOR', 'IGNORE', 'ESCALATE'];

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (col: ColumnConfig) => void;
  initial?: ColumnConfig;
}

export function ColumnBuilder({ open, onClose, onSave, initial }: Props) {
  const [type, setType] = React.useState<ColumnType>(initial?.type ?? 'custom');
  const [title, setTitle] = React.useState(initial?.title ?? 'New column');
  const [sources, setSources] = React.useState<SourceId[]>(initial?.filters.sources ?? []);
  const [recs, setRecs] = React.useState<Recommendation[]>(initial?.filters.recommendations ?? []);
  const [minOpp, setMinOpp] = React.useState<number>(initial?.filters.minOpportunity ?? 0);
  const [maxRisk, setMaxRisk] = React.useState<number>(initial?.filters.maxRisk ?? 1);
  const [maxCringe, setMaxCringe] = React.useState<number>(initial?.filters.maxCringe ?? 1);
  const [minVelocity, setMinVelocity] = React.useState<number>(initial?.filters.minVelocity ?? 0);
  const [windowHours, setWindowHours] = React.useState<number>(initial?.filters.windowHours ?? 0);
  const [firstMoverOnly, setFirstMoverOnly] = React.useState<boolean>(initial?.filters.firstMoverOnly ?? false);
  const [bannedTopicSafe, setBannedTopicSafe] = React.useState<boolean>(initial?.filters.bannedTopicSafe ?? true);
  const [decay, setDecay] = React.useState<boolean>(initial?.filters.decay ?? false);
  const [keywordInclude, setKeywordInclude] = React.useState<string[]>(initial?.filters.keywordInclude ?? []);
  const [keywordExclude, setKeywordExclude] = React.useState<string[]>(initial?.filters.keywordExclude ?? []);
  const [hashtags, setHashtags] = React.useState<string[]>(initial?.filters.hashtags ?? []);
  const [subreddits, setSubreddits] = React.useState<string[]>(initial?.filters.subreddits ?? []);
  const [twitterLocale, setTwitterLocale] = React.useState<string>(initial?.filters.twitterLocale ?? 'national:IN');
  const [newsAllow, setNewsAllow] = React.useState<string[]>(initial?.filters.newsAllow ?? []);
  const [newsDeny, setNewsDeny] = React.useState<string[]>(initial?.filters.newsDeny ?? []);
  const [refreshSec, setRefreshSec] = React.useState<number>(initial?.refreshSec ?? 60);
  const [gtrendsCategory, setGtrendsCategory] = React.useState<string>(initial?.filters.gtrendsCategory ?? '');
  const [sortKey, setSortKey] = React.useState<string>((initial?.sort.key as string) ?? 'opportunity');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>(initial?.sort.dir ?? 'desc');

  if (!open) return null;

  const toggle = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, v: T) =>
    set(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));

  function save() {
    const id = initial?.id ?? `col_${Math.random().toString(36).slice(2, 8)}`;
    onSave({
      id, type, title, refreshSec,
      filters: {
        sources: sources.length ? sources : undefined,
        recommendations: recs.length ? recs : undefined,
        minOpportunity: minOpp || undefined,
        // 0 means "no filter" — persisting 0 would filter out every
        // trend whose risk/cringe is even slightly > 0, which is almost
        // every trend. Treat 0 as the sentinel for "off" and only
        // persist values in (0, 1).
        maxRisk: maxRisk > 0 && maxRisk < 1 ? maxRisk : undefined,
        maxCringe: maxCringe > 0 && maxCringe < 1 ? maxCringe : undefined,
        minVelocity: minVelocity > 0 ? minVelocity : undefined,
        windowHours: windowHours > 0 ? windowHours : undefined,
        firstMoverOnly: firstMoverOnly || undefined,
        bannedTopicSafe,
        decay: decay || undefined,
        keywordInclude: keywordInclude.length ? keywordInclude : undefined,
        keywordExclude: keywordExclude.length ? keywordExclude : undefined,
        hashtags: hashtags.length ? hashtags : undefined,
        subreddits: subreddits.length ? subreddits : undefined,
        twitterLocale: sources.includes('x') ? twitterLocale : undefined,
        newsAllow: newsAllow.length ? newsAllow : undefined,
        newsDeny: newsDeny.length ? newsDeny : undefined,
        gtrendsCategory: sources.includes('google_trends') && gtrendsCategory ? gtrendsCategory : undefined,
      },
      sort: { key: sortKey as ColumnConfig['sort']['key'], dir: sortDir },
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-3xl rounded-xl bg-ink-900 border border-ink-700 shadow-pop max-h-[88vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <header className="px-5 py-3 border-b border-ink-700 flex items-center justify-between sticky top-0 bg-ink-900 z-10">
          <h2 className="text-sm font-semibold text-ink-100">{initial ? 'Edit column' : 'New column'}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100 text-lg leading-none">×</button>
        </header>
        <div className="p-5 space-y-5">
          <Section title="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </Section>

          <Section title="Type">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {TYPES.map(t => (
                <button key={t.value} onClick={() => setType(t.value)}
                  className={`text-left px-2.5 py-2 rounded-md border text-xs ${type === t.value ? 'border-flare-500 bg-flare-500/5' : 'border-ink-700 bg-ink-800 hover:border-ink-600'}`}>
                  <div className="text-ink-100 font-medium">{t.label}</div>
                  <div className="text-2xs text-ink-300">{t.helper}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Sources (empty = all)">
            <div className="flex flex-wrap gap-1">
              {SOURCES.map(s => (
                <button key={s} onClick={() => toggle(setSources, s)}>
                  <Chip tone={sources.includes(s) ? 'flare' : 'neutral'}>{s}</Chip>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Recommendations (empty = all)">
            <div className="flex flex-wrap gap-1">
              {RECS.map(r => (
                <button key={r} onClick={() => toggle(setRecs, r)}>
                  <Chip tone={recs.includes(r) ? 'flare' : 'neutral'}>{r}</Chip>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Score gates">
            <Slider label="Min opportunity" value={minOpp} min={0} max={100} step={5} onChange={setMinOpp} />
            <Slider label="Max risk" value={maxRisk} min={0} max={1} step={0.05} format={n => `${Math.round(n * 100)}%`} onChange={setMaxRisk} />
            <Slider label="Max cringe" value={maxCringe} min={0} max={1} step={0.05} format={n => `${Math.round(n * 100)}%`} onChange={setMaxCringe} />
            <Slider label="Min velocity (/h)" value={minVelocity} min={0} max={2000} step={50} onChange={setMinVelocity} />
            <Slider label="Time window (h, 0 = unlimited)" value={windowHours} min={0} max={72} step={1} onChange={setWindowHours} />
          </Section>

          <Section title="Keyword filters">
            <div className="space-y-3">
              <div>
                <Label>Include — match if any of these appear</Label>
                <ChipInput tone="good" value={keywordInclude} onChange={setKeywordInclude} placeholder="e.g. battery, gaming, thermal" />
              </div>
              <div>
                <Label>Exclude — drop if any of these appear</Label>
                <ChipInput tone="bad" value={keywordExclude} onChange={setKeywordExclude} placeholder="e.g. politics, election" />
              </div>
              <div>
                <Label>Hashtags (exact match)</Label>
                <ChipInput tone="info" value={hashtags} onChange={setHashtags} placeholder="#GamingPhone, #BatteryLife" />
              </div>
            </div>
          </Section>

          {sources.includes('google_trends') ? (
            <Section title="Google Trends options">
              <Picker label="Category" value={gtrendsCategory} onChange={setGtrendsCategory}
                options={[
                  ['',     'All (any category)'],
                  ['top',  'Top stories'],
                  ['t',    'Sports'],
                  ['b',    'Business'],
                  ['e',    'Entertainment'],
                  ['m',    'Sci & Tech'],
                  ['h',    'Health'],
                ]} />
              <p className="text-2xs text-ink-400 mt-2">
                Brand profile decides which categories are <em>ingested</em>. This dropdown
                narrows the column to one of those — pick &quot;All&quot; to show every ingested category.
              </p>
            </Section>
          ) : null}

          {sources.length === 0 || sources.includes('x') ? (
            <Section title="Twitter / X options">
              <Picker label="Trends locale" value={twitterLocale} onChange={setTwitterLocale}
                options={[
                  ['national:IN','India national'], ['national:US','US national'], ['national:UK','UK national'],
                  ['local:Delhi','Local · Delhi'], ['local:Mumbai','Local · Mumbai'], ['local:Bangalore','Local · Bangalore'],
                  ['global','Global'],
                ]} />
            </Section>
          ) : null}

          {sources.length === 0 || sources.includes('reddit') ? (
            <Section title="Reddit options">
              <Label>Subreddits (without r/)</Label>
              <ChipInput value={subreddits} onChange={setSubreddits} placeholder="IndianGaming, Android, gadgets" />
            </Section>
          ) : null}

          {sources.length === 0 || sources.includes('news') ? (
            <Section title="News domain filters">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Allow only these</Label>
                  <ChipInput tone="good" value={newsAllow} onChange={setNewsAllow} placeholder="reuters.com, theverge.com" />
                </div>
                <div>
                  <Label>Block these</Label>
                  <ChipInput tone="bad" value={newsDeny} onChange={setNewsDeny} placeholder="lowqualityblog.com" />
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="Behaviour">
            <div className="space-y-1">
              <Toggle label="First-mover only (no brand posts yet)" checked={firstMoverOnly} onChange={setFirstMoverOnly} />
              <Toggle label="Exclude banned topics" checked={bannedTopicSafe} onChange={setBannedTopicSafe} />
              <Toggle label="Show decay only (past peak)" checked={decay} onChange={setDecay} />
            </div>
          </Section>

          <Section title="Refresh & sort">
            <div className="grid grid-cols-3 gap-2">
              <Picker label="Refresh" value={String(refreshSec)} onChange={v => setRefreshSec(Number(v))}
                options={[['30','30s'],['60','60s'],['120','2m'],['300','5m'],['900','15m'],['3600','1h']]} />
              <Picker label="Sort by" value={sortKey} onChange={setSortKey}
                options={[['opportunity','Opp'],['velocity','Velocity'],['firstSeenAt','Newest'],['risk','Risk'],['reach','Reach']]} />
              <Picker label="Direction" value={sortDir} onChange={v => setSortDir(v as 'asc'|'desc')}
                options={[['desc','Desc'],['asc','Asc']]} />
            </div>
          </Section>
        </div>
        <footer className="px-5 py-3 border-t border-ink-700 flex items-center justify-end gap-2 sticky bottom-0 bg-ink-900">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Save column</Button>
        </footer>
      </div>
    </div>
  );
}

const inputCls = 'block w-full h-9 px-2.5 rounded-md bg-ink-800 border border-ink-700 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-flare-500';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-300 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-2xs uppercase tracking-wider text-ink-300 mb-1">{children}</div>;
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (n: number) => string }) {
  return (
    <label className="block mb-1.5">
      <div className="flex items-center justify-between text-2xs">
        <span className="text-ink-300">{label}</span>
        <span className="font-mono tabular-nums text-ink-100">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-flare-500" />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs text-ink-200 py-1">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-flare-500" /> {label}
    </label>
  );
}

function Picker({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="text-2xs uppercase tracking-wider text-ink-300">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full h-8 px-2 rounded-md bg-ink-800 border border-ink-700 text-xs text-ink-100">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
