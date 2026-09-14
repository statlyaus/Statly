import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AFL_2011_SESSION_URLS,
  reviewedOfficialAflDraft2011EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2011SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';

describe('reviewed 2011 session source scope', () => {
  it('keeps the retrospective total publication year separate from the event', () => {
    for (const [key, year] of [
      ['membership', 2011],
      ['sutcliffe', 2011],
      ['saints', 2011],
      ['total', 2013],
    ] as const) {
      const url = OFFICIAL_AFL_2011_SESSION_URLS[key];
      expect(reviewedOfficialAflDraft2011EffectiveYear(url)).toBe(year);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2011)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2012)).toBe(false);
      expect(reviewedOfficialAflDraft2011EffectiveYear(url + '?other=1')).toBeNull();
    }
  });
  it('recognizes the four reviewed source identities and rejects unknown articles', () => {
    for (const [key, id] of [
      ['membership', '506746'],
      ['sutcliffe', '75034'],
      ['saints', '469214'],
      ['total', '453197'],
    ] as const) {
      expect(
        combinedDraftDocumentId(
          'official_afl',
          OFFICIAL_AFL_2011_SESSION_URLS[key],
          'non_production'
        )
      ).toBe(`official_afl:news:${id}`);
    }
    expect(() =>
      combinedDraftDocumentId(
        'official_afl',
        'https://www.afl.com.au/news/999999/unreviewed',
        'non_production'
      )
    ).toThrow();
  });
  it('does not infer inventory or date from an article shell', () => {
    for (const sourceUrl of Object.values(OFFICIAL_AFL_2011_SESSION_URLS)) {
      const digest = 'a'.repeat(64);
      const result = parseOfficialAflDraftSession(
        '<div class="article-body"><p>2011 NAB AFL Draft: 62 players</p></div>',
        {
          anchorSeasonYear: 2011,
          capture: {
            captureId: `source-capture:${digest}`,
            artifactId: `artifact:${digest}`,
            contentSha256: digest,
            mediaType: 'text/html',
            sourceUrl,
            capturedAt: '2026-09-13T00:00:00.000Z',
            effectiveAt: '2011-11-21T00:00:00.000Z',
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
