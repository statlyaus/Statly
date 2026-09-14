import { describe, expect, it } from 'vitest';

import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { OFFICIAL_AFL_2016_SESSION_FACT_URLS } from '@/server/aflTradeIntelligence/source/officialAflDraft2016SessionFacts';

function request(
  sourceUrl: string,
  capabilityId = 'draftguru-trade-detail'
): IngestAflTradeExternalPageRequest {
  return {
    environment: 'test_fixture',
    provider: 'draftguru',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftPathway: null,
    dataset: 'scope-validation-fixture',
    datasetVersion: 'v1',
    accessMechanism: 'automated_web',
    capabilityId,
    sourceUrl,
    capturedAt: '2026-09-08T00:00:00.000Z',
    effectiveAt: '2025-10-01T00:00:00.000Z',
    parserVersion: 'scope-validation-fixture/v1',
    fieldManifestSha256: 'a'.repeat(64),
    maximumBytes: 1000,
  };
}

describe('Draftguru exact external capture scope', () => {
  it.each(['draftguru-trade-detail', 'draftguru-player-trade-detail'])(
    'accepts a native underscore detail slug for %s without changing the URL',
    (capability) => {
      // Actual retained 2025 trade-index href; this test grants no capture authority.
      const input = request(
        'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan',
        capability
      );
      expect(() => validateAflTradeExternalCaptureScope(input)).not.toThrow();
      expect(input.sourceUrl).toBe('https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan');
    }
  );

  it.each([
    'https://www.draftguru.com.au/trades/2025-picks-greater_western_sydney-western_bulldogs-11',
    'https://www.draftguru.com.au/trades/2025-christian-petracca',
  ])('accepts an exact season detail URL: %s', (url) => {
    expect(() => validateAflTradeExternalCaptureScope(request(url))).not.toThrow();
  });

  it.each([
    'https://example.com/trades/2025-jamarra-ugle_hagan',
    'https://www.draftguru.com.au.example.com/trades/2025-jamarra-ugle_hagan',
    'https://www.draftguru.com.au/trades/2024-jamarra-ugle_hagan',
    'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan?other=1',
    'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan#other',
    'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan/extra',
    'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan/../outside',
    'https://www.draftguru.com.au/trades/2025-jamarra_%2e%2e%2foutside',
    'https://www.draftguru.com.au/trades/2025-jamarra-ugle%5fhagan',
  ])('still rejects a detail URL outside exact scope: %s', (url) => {
    expect(() => validateAflTradeExternalCaptureScope(request(url))).toThrow(
      expect.objectContaining({ code: 'INVALID_SCOPE' })
    );
  });

  it('does not allow an underscore detail path through the year-page capability', () => {
    expect(() =>
      validateAflTradeExternalCaptureScope(
        request(
          'https://www.draftguru.com.au/trades/2025-jamarra-ugle_hagan',
          'draftguru-year-page'
        )
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_SCOPE' }));
  });
});

describe('Official AFL retrospective draft-session scope', () => {
  const officialRequest = (sourceUrl: string, effectiveAt: string) => ({
    ...request(sourceUrl, 'official-afl-completed-draft-session'),
    provider: 'official_afl' as const,
    parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
    anchorSeasonYear: 2016,
    draftPathway: 'national' as const,
    effectiveAt,
  });

  it('accepts the exact reviewed 2019 retrospective article for the 2016 draft', () => {
    expect(() =>
      validateAflTradeExternalCaptureScope(
        officialRequest(
          OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal,
          '2019-11-28T11:30:00.000Z'
        )
      )
    ).not.toThrow();
  });

  it('rejects a placeholder parser version for the reviewed retrospective URL', () => {
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...officialRequest(
          OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal,
          '2019-11-28T11:30:00.000Z'
        ),
        parserVersion: 'scope-validation-fixture/v1',
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_SCOPE' }));
  });

  it('rejects a different effective year for the reviewed retrospective URL', () => {
    expect(() =>
      validateAflTradeExternalCaptureScope(
        officialRequest(
          OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal,
          '2020-11-28T11:30:00.000Z'
        )
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_SCOPE' }));
  });
});
