// Resolves the best "open the original" URL for a trend.
//
// Live connectors always set `trend.url` (the actual post / article).
// But:
//   • Mock seeds may have null url
//   • Older DB rows from before url column existed have null url
//   • Some connectors (Google Trends realtime) don't always have a single
//     canonical URL — only an "explore this query" page
//
// In those cases we fall back to a sensible per-source search URL so the
// "↗" icon is never broken. The user always has somewhere to investigate.

import type { Trend, SourceId } from '@/types';

export function resolveSourceUrl(trend: Pick<Trend, 'url' | 'source' | 'title' | 'hashtags'>): string {
  if (trend.url) return trend.url;
  return fallbackSourceUrl(trend.source, trend.title, trend.hashtags ?? []);
}

export function fallbackSourceUrl(source: SourceId, title: string, hashtags: string[]): string {
  // Prefer the first hashtag if present (cleaner than the full title).
  const seed = (hashtags.find(h => h.length > 1) ?? title).replace(/^#/, '').slice(0, 100);
  const q = encodeURIComponent(seed);
  switch (source) {
    case 'x':             return `https://x.com/search?q=${q}&f=live`;
    case 'reddit':        return `https://www.reddit.com/search/?q=${q}&t=day&sort=hot`;
    case 'youtube':       return `https://www.youtube.com/results?search_query=${q}&sp=EgIIAQ%253D%253D`; // last 24h
    case 'tiktok':        return `https://www.tiktok.com/search?q=${q}`;
    case 'instagram':     return `https://www.instagram.com/explore/tags/${q.replace(/%20/g, '')}/`;
    case 'facebook':      return `https://www.facebook.com/search/posts/?q=${q}`;
    case 'google_trends': return `https://trends.google.com/trends/explore?q=${q}&geo=IN`;
    case 'news':          return `https://news.google.com/search?q=${q}`;
    default:              return `https://www.google.com/search?q=${q}`;
  }
}
