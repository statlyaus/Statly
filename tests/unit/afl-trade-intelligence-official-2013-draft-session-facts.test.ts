import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AFL_2013_SESSION_URLS,
  reviewedOfficialAflDraft2013EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2013SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';

describe('reviewed 2013 session source scope', () => {
  it('keeps event year separate from retrospective publication years', () => {
    expect(reviewedOfficialAflDraft2013EffectiveYear(OFFICIAL_AFL_2013_SESSION_URLS.event)).toBe(
      2013
    );
    expect(
      reviewedOfficialAflDraft2013EffectiveYear(OFFICIAL_AFL_2013_SESSION_URLS.membership)
    ).toBe(2018);
    expect(reviewedOfficialAflDraft2013EffectiveYear(OFFICIAL_AFL_2013_SESSION_URLS.total)).toBe(
      2019
    );
    for (const url of Object.values(OFFICIAL_AFL_2013_SESSION_URLS)) {
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2013)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2014)).toBe(false);
      expect(reviewedOfficialAflDraft2013EffectiveYear(url + '?other=1')).toBeNull();
    }
    expect(isReviewedOfficialAflDraftSessionUrl(OFFICIAL_AFL_2013_SESSION_URLS.total, 2016)).toBe(
      true
    );
  });
  it('recognizes the exact reviewed document identities without admitting unknown articles', () => {
    expect(
      combinedDraftDocumentId(
        'official_afl',
        OFFICIAL_AFL_2013_SESSION_URLS.membership,
        'non_production'
      )
    ).toBe('official_afl:news:117263');
    expect(
      combinedDraftDocumentId(
        'official_afl',
        OFFICIAL_AFL_2013_SESSION_URLS.event,
        'non_production'
      )
    ).toBe('official_afl:news:452467');
    expect(() =>
      combinedDraftDocumentId(
        'official_afl',
        'https://www.afl.com.au/news/999999/unknown',
        'non_production'
      )
    ).toThrow();
  });
  it('does not infer inventory or date from an article shell', () => {
    for (const sourceUrl of Object.values(OFFICIAL_AFL_2013_SESSION_URLS)) {
      const digest = 'a'.repeat(64);
      const result = parseOfficialAflDraftSession(
        '<div class="article-body"><p>2013 NAB AFL Draft: 62 players</p></div>',
        {
          anchorSeasonYear: 2013,
          capture: {
            captureId: `source-capture:${digest}`,
            artifactId: `artifact:${digest}`,
            contentSha256: digest,
            mediaType: 'text/html',
            sourceUrl,
            capturedAt: '2026-09-13T00:00:00.000Z',
            effectiveAt: '2013-11-21T00:00:00.000Z',
            parserVersion: 'test',
            fieldManifestSha256: digest,
          },
        }
      );
      expect(result.evidence).toEqual([]);
      expect(result.issues).toHaveLength(1);
    }
  });
});
