import { combinedDraftDocumentId } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { expect, it } from 'vitest';
import {
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
const wrap = 'https://www.afl.com.au/news/78408/afl-draft-blues-lock-in-weitering-with-no1-pick';
const total =
  'https://www.afl.com.au/news/39972/nine-things-we-learned-from-the-2015-nab-afl-draft';
it('limits 2015 facts to the two reviewed reports and their actual year', () => {
  for (const url of [wrap, total]) {
    expect(isReviewedOfficialAflDraftSessionUrl(url, 2015)).toBe(true);
    expect(isReviewedOfficialAflDraftSessionUrl(url, 2016)).toBe(false);
    expect(isReviewedOfficialAflDraftSessionUrl(url + '/amp', 2015)).toBe(false);
  }
});
it('does not derive session facts from date metadata or plausible substituted prose', () => {
  for (const sourceUrl of [wrap, total]) {
    const result = parseOfficialAflDraftSession(
      '<div class="article__date"><time datetime="2015-11-24T10:38:54Z"></time></div><div class="article-body"><p>Seventy players joined clubs during a completed draft tonight.</p></div>',
      {
        capture: {
          captureId: `source-capture:${'a'.repeat(64)}`,
          artifactId: `artifact:${'b'.repeat(64)}`,
          contentSha256: 'b'.repeat(64),
          mediaType: 'text/html',
          sourceUrl,
          capturedAt: '2026-09-13T00:00:00.000Z',
          effectiveAt: '2015-11-24T10:38:54.000Z',
          parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
          fieldManifestSha256: 'c'.repeat(64),
        },
      }
    );
    expect(result.evidence).toEqual([]);
    expect(result.issues).toHaveLength(1);
  }
});

it('uses distinct reviewed document identities for the 2015 wrap and total', () => {
  expect(combinedDraftDocumentId('official_afl', wrap, 'non_production')).toBe(
    'official_afl:news:78408'
  );
  expect(combinedDraftDocumentId('official_afl', total, 'non_production')).toBe(
    'official_afl:news:39972'
  );
  expect(() =>
    combinedDraftDocumentId('official_afl', wrap.replace('78408', '78409'), 'non_production')
  ).toThrow();
});
