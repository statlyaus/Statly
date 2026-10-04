import { describe, expect, it } from 'vitest';

import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';

const detail = (sourceUrl: string, anchorSeasonYear = 2014) =>
  ({
    provider: 'draftguru',
    capabilityId: 'draftguru-trade-detail',
    sourceUrl,
    anchorSeasonYear,
    draftPathway: null,
    discoveryFromSeasonYear: null,
  }) as IngestAflTradeExternalPageRequest;

describe('Draftguru trade-detail URL scope', () => {
  it.each([
    "https://www.draftguru.com.au/trades/2014-jaeger-o'meara",
    'https://www.draftguru.com.au/trades/2014-jaeger-o%27meara',
    'https://www.draftguru.com.au/trades/2014-jamarra-ugle_hagan',
  ])('admits the index-emitted slug %s', (url) => {
    expect(() => validateAflTradeExternalCaptureScope(detail(url))).not.toThrow();
  });

  it.each([
    'https://www.draftguru.com.au/trades/2014-o%2e%2e%2fyears',
    'https://www.draftguru.com.au/trades/2014-o%22meara',
    'https://www.draftguru.com.au/trades/2014-o"meara',
    'https://www.draftguru.com.au/trades/2014-',
    "https://www.draftguru.com.au/trades/2015-jaeger-o'meara",
    "https://www.draftguru.com.au/trades/2014-jaeger-o'meara?x=1",
  ])('still rejects %s', (url) => {
    expect(() => validateAflTradeExternalCaptureScope(detail(url))).toThrow(/do not exactly match/);
  });
});
