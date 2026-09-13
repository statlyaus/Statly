import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AFL_MINI_2011_SOURCES,
  reviewedOfficialAflMiniDraft2011EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflMiniDraft2011SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';

describe('2011 mini-draft exact source routing', () => {
  for (const [key, source] of Object.entries(OFFICIAL_AFL_MINI_2011_SOURCES)) {
    it(`keeps event, publication year, pathway and host scoped for ${key}`, () => {
      expect(isReviewedOfficialAflDraftSessionUrl(source.url, 2011)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(source.url, 2012)).toBe(false);
      expect(reviewedOfficialAflMiniDraft2011EffectiveYear(source.url)).toBe(
        Number(source.time.slice(0, 4))
      );
      expect(combinedDraftDocumentId('official_afl', source.url, 'non_production')).toBe(
        source.url
      );
      const request = {
        capabilityId: 'official-afl-completed-draft-session',
        provider: 'official_afl',
        sourceUrl: source.url,
        anchorSeasonYear: 2011,
        draftPathway: 'mini_draft',
        discoveryFromSeasonYear: null,
        effectiveAt: source.time,
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      };
      expect(() => validateAflTradeExternalCaptureScope(request as never)).not.toThrow();
      for (const patch of [
        { draftPathway: 'national' },
        { draftPathway: 'rookie' },
        { anchorSeasonYear: 2012 },
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
