import { describe, expect, it, vi } from 'vitest';
import { captureOfficialAflPage } from '@/server/aflTradeIntelligence/source/officialAflPageCapture';
import { parseIngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
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
      const request = parseIngestAflTradeExternalPageRequest({
        environment: 'non_production',
        competition: 'AFLM',
        dataset: 'Historical completed draft sessions',
        datasetVersion: 'mini-2011',
        accessMechanism: 'automated_web',
        capturedAt: '2026-09-14T00:00:00Z',
        fieldManifestSha256: 'a'.repeat(64),
        maximumBytes: 2097152,
        capabilityId: 'official-afl-completed-draft-session',
        provider: 'official_afl',
        sourceUrl: source.url,
        anchorSeasonYear: 2011,
        draftPathway: 'mini_draft',
        discoveryFromSeasonYear: null,
        effectiveAt: source.time,
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      });
      expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
      for (const patch of [
        { draftPathway: 'national' },
        { provider: 'footywire', capabilityId: 'footywire-draft-results', sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2011&t=N' },
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


describe('reviewed mini-draft HTTP capture boundary', () => {
  for (const source of Object.values(OFFICIAL_AFL_MINI_2011_SOURCES)) {
    it(`captures only the approved club URL ${source.url}`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
        new Response('<html>retained fixture</html>', {headers: {'content-type': 'text/html'}}));
      const input = {url: source.url, validators: null, maximumBytes: 1024, timeoutMs: 1000, fetchImpl};
      const result = await captureOfficialAflPage(input);
      expect(result.status).toBe('captured');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(source.url, expect.objectContaining({redirect: 'error', method: 'GET'}));
      for (const url of [source.url + '?x=1', source.url + '#fragment', source.url + '-unreviewed',
        source.url.replace('https:', 'http:'), source.url.replace(new URL(source.url).hostname, 'unreviewed.example'),
        source.url.replace('/news/', ':8443/news/')]) {
        await expect(captureOfficialAflPage({...input, url})).rejects.toThrow('outside the approved article path');
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await expect(captureOfficialAflPage({...input, maximumBytes: 2})).rejects.toThrow('byte limit');
    });
  }
});
