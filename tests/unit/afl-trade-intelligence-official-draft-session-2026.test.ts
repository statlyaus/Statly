// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalOfficialAflDraftSessionTargets,
  officialAflDraftSessionDecisionKey,
} from '@/server/aflTradeIntelligence/development/localOfficialAflDraftSessionCapture';
import {
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
  officialAflDraftSessionParserVersion,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import {
  OFFICIAL_AFL_DRAFT_2026_SESSION_PARSER_VERSION,
  reviewedOfficialAflDraft2026SessionPages,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2026Sessions';
import { OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/officialAflDraft2025Sessions';
import { isOfficialAflDraftSessionBoundaryParserVersion } from '@/server/aflTradeIntelligence/source/officialAflDraftBoundarySessions';
import {
  validateAflTradeExternalCaptureScope,
  validateAflTradeRetainedCaptureScope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { captureOfficialAflPage } from '@/server/aflTradeIntelligence/source/officialAflPageCapture';
import {
  nightOnePage,
  nightOneParagraphs,
  nightTwoDescription,
  nightTwoPage,
  nightTwoParagraphs,
  type NightTwoNumbers,
} from '../fixtures/officialAflDraft2026NightReports';

const [nightOne, nightTwo] = reviewedOfficialAflDraft2026SessionPages();
const V21 = OFFICIAL_AFL_DRAFT_2026_SESSION_PARSER_VERSION;

const capture = (sourceUrl: string, parserVersion: string = V21) => ({
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl,
  capturedAt: '2026-11-21T00:00:00.000Z',
  effectiveAt: '2026-11-19T00:00:00.000Z',
  parserVersion,
  fieldManifestSha256: 'c'.repeat(64),
});

const parse = (html: string, url: string, parserVersion?: string, anchorSeasonYear = 2026) =>
  parseOfficialAflDraftSession(html, { capture: capture(url, parserVersion), anchorSeasonYear });
const range = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);
const refusal = (detail: string) => [
  expect.objectContaining({
    code: 'invalid_draft_session',
    detail: expect.stringContaining(detail),
  }),
];

describe('2026 national draft sessions from the night reports’ boundary sentences (parser v21)', () => {
  it('reads both nights as two completed sessions', () => {
    const one = parse(nightOnePage(), nightOne!.url);
    const two = parse(nightTwoPage(), nightTwo!.url);
    expect(one.issues).toEqual([]);
    expect(two.issues).toEqual([]);
    expect(one.evidence.map(({ content }) => content.sourceRow.sourceKey)).toEqual([
      'national-draft:2026:session:1',
    ]);
    expect(one.evidence[0]!.content.claim).toEqual({
      kind: 'draft_session',
      draftYear: 2026,
      draftType: 'national',
      sessionOrdinal: 1,
      eventDate: '2026-11-19',
      officialName: '2026 Telstra AFL Draft',
      selectionNumbers: range(1, 19),
    });
    expect(two.evidence[0]!.content.claim).toEqual({
      kind: 'draft_session',
      draftYear: 2026,
      draftType: 'national',
      sessionOrdinal: 2,
      eventDate: '2026-11-20',
      officialName: '2026 Telstra AFL Draft',
      selectionNumbers: range(20, 65),
    });
    expect(one.evidence[0]!.content.publicationEligible).toBe(false);
  });

  it('reviews two contiguous sessions on a Thursday and the Friday after it, on afl.com.au', () => {
    expect(reviewedOfficialAflDraft2026SessionPages()).toEqual([
      { url: nightOne!.url, completedOn: '2026-11-19' },
      { url: nightTwo!.url, completedOn: '2026-11-20' },
    ]);
    expect(new Date(`${nightOne!.completedOn}T00:00:00Z`).getUTCDay()).toBe(4);
    expect(new Date(`${nightTwo!.completedOn}T00:00:00Z`).getUTCDay()).toBe(5);
    for (const { url } of reviewedOfficialAflDraft2026SessionPages()) {
      expect(url).toMatch(/^https:\/\/www\.afl\.com\.au\/news\/\d+\/[a-z0-9-]+$/);
    }
  });

  it.each<[string, () => string, string]>([
    [
      'a boundary sentence is missing',
      () => nightOnePage({ paragraphs: nightOneParagraphs().slice(0, 3) }),
      'missing or repeated',
    ],
    [
      'a boundary sentence is repeated in another paragraph',
      () => nightOnePage({ paragraphs: [...nightOneParagraphs(), nightOneParagraphs()[1]!] }),
      'missing or repeated',
    ],
    [
      'the draft does not open at No.1',
      () => nightOnePage({ paragraphs: nightOneParagraphs({ first: 2 }) }),
      'disagrees',
    ],
    [
      'the opening round’s size disagrees with its last selection',
      () => nightOnePage({ paragraphs: nightOneParagraphs({ size: 18 }) }),
      'disagrees',
    ],
    [
      'the final selection is another number',
      () => nightOnePage({ paragraphs: nightOneParagraphs({ last: 20 }) }),
      'disagrees',
    ],
    [
      'night two does not open at the following pick',
      () => nightOnePage({ paragraphs: nightOneParagraphs({ next: 21 }) }),
      'disagrees',
    ],
    [
      'the contextual date differs',
      () => nightOnePage({ stamp: '2026-11-20T08:33:00Z' }),
      'contextual date',
    ],
    ['the page carries no date', () => nightOnePage({ stamp: null }), 'contextual date'],
  ])('refuses night one when %s', (_label, html, detail) => {
    const result = parse(html(), nightOne!.url);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toEqual(refusal(detail));
  });

  it.each<[string, NightTwoNumbers]>([
    ['the draft’s total disagrees with the reviewed last selection', { total: 66 }],
    ['the final selection is another number', { last: 64 }],
  ])('refuses night two when %s', (_label, numbers) => {
    const result = parse(nightTwoPage({ paragraphs: nightTwoParagraphs(numbers) }), nightTwo!.url);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toEqual(refusal('disagrees'));
  });

  it.each<[string, readonly string[], string]>([
    ['its summary opens night two at another pick', [nightTwoDescription(21)], 'disagrees'],
    ['it has no summary', [], 'missing or repeated'],
    [
      'it has two summaries',
      [nightTwoDescription(), 'Another synthetic summary'],
      'missing or repeated',
    ],
  ])('refuses night two when %s', (_label, descriptions, detail) => {
    const result = parse(nightTwoPage({ descriptions }), nightTwo!.url);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toEqual(refusal(detail));
  });

  it('reads the night-two opening pick from the summary only, never from the body', () => {
    const html = nightTwoPage({
      descriptions: ['A synthetic summary'],
      paragraphs: [...nightTwoParagraphs(), nightTwoDescription()],
    });
    expect(parse(html, nightTwo!.url).issues).toEqual(refusal('missing or repeated'));
  });

  it('refuses the reports under any other parser, season or night', () => {
    expect(
      parse(nightOnePage(), nightOne!.url, OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION).issues
    ).toEqual(refusal('parser v21'));
    expect(
      parse(nightOnePage(), nightOne!.url, OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION)
        .issues
    ).toEqual(refusal('parser v21'));
    expect(parse(nightOnePage(), nightOne!.url, V21, 2025).evidence).toEqual([]);
    // Each night's page read as the other night's report.
    expect(parse(nightOnePage({ stamp: '2026-11-20T08:52:00Z' }), nightTwo!.url).evidence).toEqual(
      []
    );
    expect(parse(nightTwoPage({ stamp: '2026-11-19T08:33:00Z' }), nightOne!.url).evidence).toEqual(
      []
    );
    // The AMP page is not the reviewed report.
    expect(parse(nightOnePage(), `${nightOne!.url}/amp`).evidence).toEqual([]);
  });

  it('marks v21, like v20, as a boundary parser whose claims never prove membership', () => {
    expect(isOfficialAflDraftSessionBoundaryParserVersion(V21)).toBe(true);
    expect(
      isOfficialAflDraftSessionBoundaryParserVersion(
        OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION
      )
    ).toBe(true);
    expect(
      isOfficialAflDraftSessionBoundaryParserVersion(OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION)
    ).toBe(false);
  });
});

describe('the 2026 completed-session capture scope', () => {
  const request: IngestAflTradeExternalPageRequest = {
    ...capture(nightOne!.url),
    environment: 'non_production',
    provider: 'official_afl',
    competition: 'AFLM',
    anchorSeasonYear: 2026,
    draftPathway: 'national',
    dataset: 'Synthetic completed draft session',
    datasetVersion: 'v1',
    accessMechanism: 'automated_web',
    capabilityId: 'official-afl-completed-draft-session',
    maximumBytes: 2097152,
  };

  it('pins 2026 to parser v21 and its own decision key', () => {
    expect(officialAflDraftSessionParserVersion(2026)).toBe(
      'official-afl-completed-draft-session/v21'
    );
    expect(officialAflDraftSessionDecisionKey(2026)).toBe(
      'official-afl-completed-draft-session-issue579-private-2026-session-v21'
    );
    expect(officialAflDraftSessionParserVersion(2027)).toBe(
      OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION
    );
  });

  it('admits exactly the two reviewed reports under v21', () => {
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({
        ...request,
        sourceUrl: nightTwo!.url,
        effectiveAt: '2026-11-20T00:00:00.000Z',
      })
    ).not.toThrow();
    expect(() => validateAflTradeRetainedCaptureScope(request)).not.toThrow();
    for (const change of [
      { parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION },
      { parserVersion: OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION },
      { anchorSeasonYear: 2025 },
      { sourceUrl: `${nightOne!.url}/amp` },
      { draftPathway: null },
      { effectiveAt: '2025-11-19T00:00:00.000Z' },
    ]) {
      expect(() => validateAflTradeExternalCaptureScope({ ...request, ...change })).toThrow();
    }
  });

  it('enumerates the two night reports as the 2026 capture targets', () => {
    expect(createLocalOfficialAflDraftSessionTargets([2026])).toEqual([
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2026,
        sourceUrl: nightOne!.url,
        effectiveAt: '2026-11-19T00:00:00.000Z',
      },
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2026,
        sourceUrl: nightTwo!.url,
        effectiveAt: '2026-11-20T00:00:00.000Z',
      },
    ]);
  });

  it.each(reviewedOfficialAflDraft2026SessionPages().map(({ url }) => url))(
    'fetches the exact reviewed report as HTML without following redirects: %s',
    async (url) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<article>fixture</article>', {
          headers: { 'content-type': 'text/html;charset=utf-8' },
        })
      );
      await expect(
        captureOfficialAflPage({
          url,
          fetchImpl,
          maximumBytes: 1024,
          timeoutMs: 1000,
          validators: null,
        })
      ).resolves.toMatchObject({ status: 'captured' });
      expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }));
    }
  );
});
