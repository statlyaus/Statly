import { describe, expect, it } from 'vitest';
import { parseIngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import {
  OFFICIAL_AFL_MINI_2012_SOURCES,
  reviewedOfficialAflMiniDraft2012EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflMiniDraft2012SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';

describe('2012 mini-draft exact source routing', () => {
  for (const [key, source] of Object.entries(OFFICIAL_AFL_MINI_2012_SOURCES)) {
    it(`keeps event, publication year, pathway and host scoped for ${key}`, () => {
      expect(isReviewedOfficialAflDraftSessionUrl(source.url, 2012)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(source.url, 2013)).toBe(false);
      expect(reviewedOfficialAflMiniDraft2012EffectiveYear(source.url)).toBe(
        Number(source.time.slice(0, 4))
      );
      expect(combinedDraftDocumentId('official_afl', source.url, 'non_production')).toBe(
        key === 'completed' ? 'official_afl:news:453694' : source.url
      );
      const request = parseIngestAflTradeExternalPageRequest({
        environment: 'non_production',
        competition: 'AFLM',
        dataset: 'Historical completed draft sessions',
        datasetVersion: 'mini-2012',
        accessMechanism: 'automated_web',
        capturedAt: '2026-09-14T00:00:00Z',
        fieldManifestSha256: 'a'.repeat(64),
        maximumBytes: 2097152,
        capabilityId: 'official-afl-completed-draft-session',
        provider: 'official_afl',
        sourceUrl: source.url,
        anchorSeasonYear: 2012,
        draftPathway: 'mini_draft',
        discoveryFromSeasonYear: null,
        effectiveAt: source.time,
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      });
      expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
      for (const patch of [
        { draftPathway: 'national' },
        {
          provider: 'footywire',
          capabilityId: 'footywire-draft-results',
          sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2011&t=N',
        },
        { draftPathway: 'rookie' },
        { anchorSeasonYear: 2013 },
        { sourceUrl: source.url + '?x=1' },
        { provider: 'draftguru' },
        { effectiveAt: '2010-01-01T00:00:00Z' },
      ]) {
        expect(() =>
          validateAflTradeExternalCaptureScope({ ...request, ...patch } as never)
        ).toThrow();
      }
      const otherHost = source.url.replace(new URL(source.url).hostname, 'unreviewed.example');
      expect(() => combinedDraftDocumentId('official_afl', otherHost, 'non_production')).toThrow();
    });
  }
});
