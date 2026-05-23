import { describe, expect, it } from 'vitest';

import type { DraftClubTradeRefRow } from '@/lib/draftTrades/contracts';

import { filterClubTradeRefs, normalizeDraftClubSearchQuery } from './clubTradeRefSearch';

const sample: DraftClubTradeRefRow[] = [
  {
    tradeId: 't1',
    year: 2013,
    seqInYear: 5,
    title: 'Trade for Shane Mumford',
    clubSlug: 'gws',
    clubName: 'GWS',
    assetsRaw: 'Mumford + pick 32',
    expected: 100,
    actual: 50,
  },
  {
    tradeId: 't2',
    year: 2015,
    seqInYear: 1,
    title: 'Pick swap with Sydney',
    clubSlug: 'gws',
    clubName: 'GWS',
    assetsRaw: 'Future second',
    expected: null,
    actual: null,
  },
];

describe('normalizeDraftClubSearchQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDraftClubSearchQuery('  Foo   Bar  ')).toBe('foo bar');
  });
});

describe('filterClubTradeRefs', () => {
  it('returns all when query empty', () => {
    expect(filterClubTradeRefs(sample, '')).toHaveLength(2);
    expect(filterClubTradeRefs(sample, '   ')).toHaveLength(2);
  });

  it('matches title substring', () => {
    expect(filterClubTradeRefs(sample, 'mumford')).toHaveLength(1);
    expect(filterClubTradeRefs(sample, 'mumford')[0]?.tradeId).toBe('t1');
  });

  it('matches assetsRaw', () => {
    expect(filterClubTradeRefs(sample, 'future')).toHaveLength(1);
    expect(filterClubTradeRefs(sample, 'future')[0]?.tradeId).toBe('t2');
  });

  it('ANDs multiple tokens', () => {
    expect(filterClubTradeRefs(sample, 'pick sydney')).toHaveLength(1);
    expect(filterClubTradeRefs(sample, 'pick sydney')[0]?.tradeId).toBe('t2');
  });

  it('matches year and trade id', () => {
    expect(filterClubTradeRefs(sample, '2013')).toHaveLength(1);
    expect(filterClubTradeRefs(sample, 't2')).toHaveLength(1);
  });
});
