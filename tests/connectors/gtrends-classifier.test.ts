import { describe, expect, it } from 'vitest';
import { classifyTrendCategory } from '@/lib/gtrends-classifier';

// Pinned regression cases. Each one is a real trend we saw the legacy
// `?category=t` / `?category=m` RSS endpoint return — Google's own
// category param ignores them, but our classifier puts them in the
// right bucket via news source + title.

describe('classifyTrendCategory', () => {
  it('classifies sports by news source domain', () => {
    expect(classifyTrendCategory({
      title: 'mönchengladbach vs dortmund',
      newsSource: 'FussballTransfers.com',
      articleUrl: 'https://fussballtransfers.com/news/123',
    })).toBe('t');
    expect(classifyTrendCategory({
      title: 'rashid khan',
      newsSource: 'ESPNcricinfo',
      articleUrl: 'https://www.espncricinfo.com/cricket/123',
    })).toBe('t');
    expect(classifyTrendCategory({
      title: 'madrid open',
      newsSource: 'ATP Tour',
      articleUrl: 'https://www.atptour.com/123',
    })).toBe('t');
  });

  it('classifies entertainment by news source', () => {
    expect(classifyTrendCategory({
      title: 'swapped movie netflix',
      newsSource: 'Variety',
      articleUrl: 'https://variety.com/2026/film/news/swapped-netflix',
    })).toBe('e');
  });

  it('classifies sci-tech by news source', () => {
    expect(classifyTrendCategory({
      title: 'pixel 11 launch',
      newsSource: 'The Verge',
      articleUrl: 'https://theverge.com/123',
    })).toBe('m');
  });

  it('falls back to title keywords when source is unknown', () => {
    expect(classifyTrendCategory({
      title: 'pbks vs kkr',
      newsSource: 'Some Random Site',
      articleUrl: 'https://example.com/article',
    })).toBe('t'); // "vs" in title
    expect(classifyTrendCategory({
      title: 'iPhone 17 launch leaks',
      newsSource: 'Some Random Site',
    })).toBe('m'); // "iphone", "launch", "leaks"
    expect(classifyTrendCategory({
      title: 'sensex hits record high',
      newsSource: 'Some Random Site',
    })).toBe('b');
  });

  it('defaults to "top" when nothing matches', () => {
    expect(classifyTrendCategory({
      title: 'nahid rana',
      newsSource: 'The Times of India',
      articleUrl: 'https://timesofindia.indiatimes.com/123',
    })).toBe('top');
    expect(classifyTrendCategory({
      title: 'mht cet',
      newsSource: 'Shiksha',
      articleUrl: 'https://shiksha.com/exam/123',
    })).toBe('top');
  });

  it('handles missing fields gracefully', () => {
    expect(classifyTrendCategory({ title: 'standalone term' })).toBe('top');
    expect(classifyTrendCategory({ title: '', newsSource: 'ESPN India' })).toBe('t');
  });

  // Pinned: every item Google's own Technology filter (category=18)
  // showed for India must classify as 'm'. If the classifier loses
  // any of these, the Sci & Tech column will silently drop it and
  // the operator will see a smaller list than Google's UI.
  describe('matches Google\'s Technology filter for India', () => {
    it('apple iphone 18 pro max', () => {
      expect(classifyTrendCategory({ title: 'apple iphone 18 pro max' })).toBe('m');
    });
    it('Hindi: सैमसंग', () => {
      expect(classifyTrendCategory({ title: 'सैमसंग' })).toBe('m');
    });
    it('nvidia (single brand name, no source)', () => {
      expect(classifyTrendCategory({ title: 'nvidia' })).toBe('m');
    });
    it('Hindi: स्मार्टफोन', () => {
      expect(classifyTrendCategory({ title: 'स्मार्टफोन' })).toBe('m');
    });
  });
});
