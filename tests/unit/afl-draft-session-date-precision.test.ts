import { createAflTradeExternalEvidenceEnvelope } from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { describe, expect, it } from 'vitest';
import {
  parseDraftSessionDatePrecision as parse,
  draftSessionDefinitelyPrecedes as precedes,
} from '@/server/aflTradeIntelligence/source/draftSessionDatePrecision';

const window = { precision: 'window', eventDate: null, earliestDate: '2012-10-08', latestDate: '2012-10-26' } as const;
const day = (eventDate: string) => ({ precision: 'day', eventDate } as const);

describe('draft session date precision', () => {
  it('preserves source window bounds without selecting an event day', () => {
    expect(parse(window, 2012)).toEqual(window);
    expect(parse(day('2011-10-17'), 2011)).toEqual(day('2011-10-17'));
    expect(parse(day('2012-02-29'), 2012).eventDate).toBe('2012-02-29');
  });

  it.each([
    { ...window, eventDate: '2012-10-26' },
    { ...window, earliestDate: '2012-10-27' },
    { ...window, earliestDate: '2012-10-26' },
    { ...window, earliestDate: '2011-10-08' },
    { ...window, latestDate: '2012-02-30' },
    { ...window, earliestDate: '2012-10' },
    { ...window, eventDate: undefined },
    { ...day('2012-10-26'), earliestDate: '2012-10-08' },
    day('2011-02-29'),
  ])('rejects invalid or falsely precise dates: %j', value => {
    expect(() => parse(value, 2012)).toThrow();
  });

  it('rejects a different stated draft year', () => {
    expect(() => parse(window, 2011)).toThrow();
    expect(() => parse(day('2012-10-26'), 2011)).toThrow();
  });

  it('proves strict ordering only when every possible earlier day precedes every later day', () => {
    expect(precedes(day('2012-10-07'), window)).toBe(true);
    expect(precedes(window, day('2012-10-27'))).toBe(true);
    expect(precedes(day('2012-10-08'), window)).toBe(false);
    expect(precedes(window, day('2012-10-26'))).toBe(false);
    expect(precedes(window, day('2012-10-20'))).toBe(false);
    expect(precedes(window, { ...window, earliestDate: '2012-10-20', latestDate: '2012-10-30' })).toBe(false);
    expect(precedes(day('2012-10-09'), day('2012-10-08'))).toBe(false);
  });
});


it('retains a window as Official AFL evidence and rejects unsupported provider/year/precision', () => {
  const content = {
    schemaVersion: 'afl-trade-external-evidence/v1' as const,
    provider: 'official_afl' as const,
    capture: {captureId: `source-capture:${'a'.repeat(64)}`, artifactId: `artifact:${'b'.repeat(64)}`,
      contentSha256: 'b'.repeat(64), mediaType: 'text/html', sourceUrl: 'https://www.afl.com.au/news/1/fixture',
      capturedAt: '2026-09-14T00:00:00.000Z', effectiveAt: '2012-10-26T00:00:00.000Z',
      parserVersion: 'fixture/v1', fieldManifestSha256: 'c'.repeat(64)},
    sourceRow: {ordinal: 1, sourceKey: 'window'},
    claim: {kind: 'draft_session_window' as const, draftYear: 2012, draftType: 'mini_draft' as const,
      sessionOrdinal: 1, datePrecision: window},
    publicationEligible: false as const,
  };
  expect(createAflTradeExternalEvidenceEnvelope(content).content.claim).toEqual(content.claim);
  expect(() => createAflTradeExternalEvidenceEnvelope({...content, provider: 'draftguru'})).toThrow();
  expect(() => createAflTradeExternalEvidenceEnvelope({...content, claim: {...content.claim, draftYear: 2011}})).toThrow();
  expect(() => createAflTradeExternalEvidenceEnvelope({...content, claim: {...content.claim,
    datePrecision: {...window, eventDate: '2012-10-26'} as never}})).toThrow();
});
