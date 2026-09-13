import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AFL_2014_SESSION_URLS,
  reviewedOfficialAflDraft2014EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2014SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';

describe('reviewed 2014 session source scope', () => {
  it('keeps event year separate from retrospective publication years', () => {
    expect(reviewedOfficialAflDraft2014EffectiveYear(OFFICIAL_AFL_2014_SESSION_URLS.event)).toBe(
      2014
    );
    expect(
      reviewedOfficialAflDraft2014EffectiveYear(OFFICIAL_AFL_2014_SESSION_URLS.membership)
    ).toBe(2019);
    expect(reviewedOfficialAflDraft2014EffectiveYear(OFFICIAL_AFL_2014_SESSION_URLS.total)).toBe(
      2016
    );
    for (const url of Object.values(OFFICIAL_AFL_2014_SESSION_URLS)) {
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2014)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2013)).toBe(false);
      expect(reviewedOfficialAflDraft2014EffectiveYear(url + '?other=1')).toBeNull();
    }
    expect(reviewedOfficialAflDraft2014EffectiveYear(OFFICIAL_AFL_2014_SESSION_URLS.steele)).toBe(
      2016
    );
    expect(
      reviewedOfficialAflDraft2014EffectiveYear(OFFICIAL_AFL_2014_SESSION_URLS.finlayson)
    ).toBe(2018);
  });
  it('recognizes the exact reviewed document identities without admitting unknown articles', () => {
    expect(
      combinedDraftDocumentId(
        'official_afl',
        OFFICIAL_AFL_2014_SESSION_URLS.membership,
        'non_production'
      )
    ).toBe('official_afl:news:149034');
    expect(
      combinedDraftDocumentId(
        'official_afl',
        OFFICIAL_AFL_2014_SESSION_URLS.event,
        'non_production'
      )
    ).toBe('official_afl:news:68212');
    expect(() =>
      combinedDraftDocumentId(
        'official_afl',
        'https://www.afl.com.au/news/999999/unknown',
        'non_production'
      )
    ).toThrow();
  });
  it('does not infer inventory or date from an article shell', () => {
    for (const sourceUrl of Object.values(OFFICIAL_AFL_2014_SESSION_URLS)) {
      const digest = 'a'.repeat(64);
      const result = parseOfficialAflDraftSession(
        '<div class="article-body"><p>2014 NAB AFL Draft: 62 players</p></div>',
        {
          anchorSeasonYear: 2014,
          capture: {
            captureId: `source-capture:${digest}`,
            artifactId: `artifact:${digest}`,
            contentSha256: digest,
            mediaType: 'text/html',
            sourceUrl,
            capturedAt: '2026-09-13T00:00:00.000Z',
            effectiveAt: '2014-11-21T00:00:00.000Z',
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
