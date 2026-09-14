import { describe, expect, it } from 'vitest';
import { validateAflTradeExternalCaptureScope } from '../../src/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '../../src/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { OFFICIAL_AFL_COMPENSATION_PARSER_VERSION } from '../../src/server/aflTradeIntelligence/source/officialAflCompensationPdfFacts';

const sources = [
  ['https://www.afl.com.au/news/537729/nab-afl-draft-order-locked-in', 2010],
  ['https://www.lions.com.au/news/730793/descendent-from-the-merger', 2011],
  ['https://www.afl.com.au/news/103376/statement-suns-giants-activate-compo-draft-picks', 2014],
  ['https://www.afl.com.au/news/93491/gold-coast-activate-compensation-pick-for-2015-draft', 2015],
  ['https://www.afl.com.au/news/81535/gold-coast-draft-rules-explained', 2014],
  ['https://www.melbournefc.com.au/news/774653/afl-compensation-explained', 2015],
  [
    'https://resources.afl.com.au/afl/document/2019/12/05/961d597e-b5d8-42b6-9f66-f2518cdd279b/2013-AFL-Annual-Report-min.pdf',
    2013,
  ],
  [
    'https://resources.afl.com.au/afl/document/2019/12/05/59317d2f-a338-4833-a242-21f858d6fa81/AFL-Annual-Report-2012_web-min.pdf',
    2012,
  ],
] as const;
const request = (sourceUrl: string, anchorSeasonYear: number) =>
  ({
    provider: 'official_afl',
    capabilityId: 'official-afl-compensation-lifecycle',
    sourceUrl,
    anchorSeasonYear,
    draftPathway: null,
    discoveryFromSeasonYear: null,
    parserVersion: OFFICIAL_AFL_COMPENSATION_PARSER_VERSION,
    effectiveAt: '2026-09-14T00:00:00.000Z',
  }) as IngestAflTradeExternalPageRequest;

describe('compensation lifecycle capture scope', () => {
  it.each(sources)('accepts only the reviewed reference scope: %s', (url, year) => {
    expect(() => validateAflTradeExternalCaptureScope(request(url, year))).not.toThrow();
    expect(() => validateAflTradeExternalCaptureScope(request(url + '?other=1', year))).toThrow();
    expect(() => validateAflTradeExternalCaptureScope(request(url, 2000))).toThrow();
  });
  it.each([
    { provider: 'draftguru' },
    { draftPathway: 'national' },
    { discoveryFromSeasonYear: 2010 },
    { parserVersion: 'official-afl-issuing-award/v1' },
    { effectiveAt: 'invalid' },
    { effectiveAt: '2009-01-01T00:00:00.000Z' },
  ])('rejects incompatible provider, parser and chronology: %j', (override) => {
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...request(...sources[0]),
        ...override,
      } as IngestAflTradeExternalPageRequest)
    ).toThrow();
  });
  it('does not admit historical activation articles as issuing awards', () => {
    const input = request(...sources[0]);
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...input,
        capabilityId: 'official-afl-issuing-award',
        parserVersion: 'official-afl-issuing-award/v1',
      })
    ).toThrow();
  });
});
