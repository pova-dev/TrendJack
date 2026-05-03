import { describe, expect, it } from 'vitest';
import { parseBoqResponse } from '@/lib/connectors/googletrends-realtime';

// Synthetic boq response sample matching the live i0OFE shape, cut down
// to two items for readability. Real responses are hundreds of items.
//
// If Google changes the wrapper structure (XSSI prefix, byte-length
// preamble, wrb.fr triple shape, or the inner trend row layout), this
// test catches it before the dashboard goes empty in production.

const SAMPLE = [
  ")]}'",
  '111111',
  JSON.stringify([
    [
      'wrb.fr',
      'i0OFE',
      JSON.stringify([
        null,
        [
          [
            'where to watch gujarat titans vs punjab kings',
            null,
            'IN',
            [1777812000],
            null,
            null,
            1000000,
            null,
            1000,
            ['related a', 'related b'],
            [17],
            [[123, 'en', 'IN']],
            'where to watch gujarat titans vs punjab kings',
          ],
          [
            'pbks vs gt',
            null,
            'IN',
            [1777800000],
            null,
            null,
            200000,
            null,
            1000,
            ['gt v pbks'],
            [11],
            [[456, 'en', 'IN']],
            'pbks vs gt',
          ],
        ],
      ]),
      null,
      null,
      null,
      'generic',
    ],
  ]),
].join('\n');

describe('parseBoqResponse', () => {
  it('strips XSSI prefix and unwraps wrb.fr', () => {
    const items = parseBoqResponse(SAMPLE);
    expect(items).toHaveLength(2);
  });

  it('decodes title, geo, startUnix, searchVolume, growthPct, relatedTerms', () => {
    const [first] = parseBoqResponse(SAMPLE);
    expect(first.title).toBe('where to watch gujarat titans vs punjab kings');
    expect(first.geo).toBe('IN');
    expect(first.startUnix).toBe(1777812000);
    expect(first.searchVolume).toBe(1_000_000);
    expect(first.growthPct).toBe(1000);
    expect(first.relatedTerms).toEqual(['related a', 'related b']);
  });

  it('throws on missing envelope', () => {
    expect(() => parseBoqResponse(")]}'\n0\n")).toThrow();
  });

  it('throws when the wrb.fr triple is for a different RPC id', () => {
    const wrong = ")]}'\n10\n" + JSON.stringify([['wrb.fr', 'OTHER_RPC', '[]', null, null, null, 'generic']]);
    expect(() => parseBoqResponse(wrong)).toThrow();
  });
});
