import { expect, it } from 'vitest';
import { OFFICIAL_AFL_2010_SESSION_SOURCES } from '@/server/aflTradeIntelligence/source/officialAflDraft2010SessionFacts';
import { OFFICIAL_AFL_2010_REPORT } from '@/server/aflTradeIntelligence/source/officialAflDraft2010PdfFacts';
import {
  reviewedOfficialAflDraft2010Source,
  OFFICIAL_AFL_2010_ADDITIONS_URL,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2010SourceScope';
import {
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
  isReviewedOfficialAflDraftSessionUrl,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { parseIngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
const urls = [
  ...Object.values(OFFICIAL_AFL_2010_SESSION_SOURCES).map((s) => s.url),
  OFFICIAL_AFL_2010_ADDITIONS_URL,
  OFFICIAL_AFL_2010_REPORT.url,
];
it.each(urls)(
  'requires exact2010 URL, publication/observation and parser scope: %s',
  (sourceUrl) => {
    const source = reviewedOfficialAflDraft2010Source(sourceUrl)!;
    const capturedAt = '2026-09-14T00:00:00Z';
    const request = parseIngestAflTradeExternalPageRequest({
      environment: 'non_production',
      competition: 'AFLM',
      dataset: 'Historical completed draft sessions',
      datasetVersion: '2010',
      accessMechanism: 'automated_web',
      capturedAt,
      effectiveAt: source.effectiveAt ?? capturedAt,
      fieldManifestSha256: 'a'.repeat(64),
      maximumBytes: 8000000,
      capabilityId: 'official-afl-completed-draft-session',
      provider: 'official_afl',
      sourceUrl,
      anchorSeasonYear: 2010,
      draftPathway: 'national',
      discoveryFromSeasonYear: null,
      parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
    });
    expect(isReviewedOfficialAflDraftSessionUrl(sourceUrl, 2010)).toBe(true);
    expect(isReviewedOfficialAflDraftSessionUrl(sourceUrl, 2011)).toBe(false);
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    for (const patch of [
      { sourceUrl: sourceUrl + '?x=1' },
      { anchorSeasonYear: 2011 },
      { provider: 'draftguru' },
      { draftPathway: 'rookie' },
      { effectiveAt: '2010-01-01T00:00:00Z' },
      { parserVersion: 'old-parser' },
      { discoveryFromSeasonYear: 2009 },
    ])
      expect(() =>
        validateAflTradeExternalCaptureScope({ ...request, ...patch } as never)
      ).toThrow();
  }
);
