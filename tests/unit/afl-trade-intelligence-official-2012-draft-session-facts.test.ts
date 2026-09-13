import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_AFL_2012_SESSION_URLS,
  reviewedOfficialAflDraft2012EffectiveYear,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2012SessionFacts';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';

describe('reviewed 2012 session source scope', () => {
  it('keeps event year separate from retrospective publication years', () => {
    expect(reviewedOfficialAflDraft2012EffectiveYear(OFFICIAL_AFL_2012_SESSION_URLS.event)).toBe(
      2012
    );
    expect(
      reviewedOfficialAflDraft2012EffectiveYear(OFFICIAL_AFL_2012_SESSION_URLS.membership)
    ).toBe(2014);
    expect(
      reviewedOfficialAflDraft2012EffectiveYear(OFFICIAL_AFL_2012_SESSION_URLS.classifications)
    ).toBe(2012);
    for (const url of Object.values(OFFICIAL_AFL_2012_SESSION_URLS)) {
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2012)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2013)).toBe(false);
      expect(reviewedOfficialAflDraft2012EffectiveYear(url + '?other=1')).toBeNull();
    }
  });
  it('does not infer inventory or date from an article shell', () => {
    for (const sourceUrl of Object.values(OFFICIAL_AFL_2012_SESSION_URLS)) {
      const digest = 'a'.repeat(64);
      const result = parseOfficialAflDraftSession(
        '<div class="article-body"><p>2012 NAB AFL Draft: 62 players</p></div>',
        {
          anchorSeasonYear: 2012,
          capture: {
            captureId: `source-capture:${digest}`,
            artifactId: `artifact:${digest}`,
            contentSha256: digest,
            mediaType: 'text/html',
            sourceUrl,
            capturedAt: '2026-09-13T00:00:00.000Z',
            effectiveAt: '2012-11-21T00:00:00.000Z',
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
