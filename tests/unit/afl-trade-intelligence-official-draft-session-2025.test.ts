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
  OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION,
  reviewedOfficialAflDraft2025SessionPages,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2025Sessions';
import {
  validateAflTradeExternalCaptureScope,
  validateAflTradeRetainedCaptureScope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { captureOfficialAflPage } from '@/server/aflTradeIntelligence/source/officialAflPageCapture';

// Synthetic pages: only the reviewed boundary sentences are kept, everything else is invented.
const [nightOne, nightTwo] = reviewedOfficialAflDraft2025SessionPages();
const V20 = OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION;

const capture = (sourceUrl: string, parserVersion: string = V20) => ({
  captureId: `source-capture:${'a'.repeat(64)}`,
  artifactId: `artifact:${'b'.repeat(64)}`,
  contentSha256: 'b'.repeat(64),
  mediaType: 'text/html' as const,
  sourceUrl,
  capturedAt: '2026-10-16T00:00:00.000Z',
  effectiveAt: '2025-11-19T00:00:00.000Z',
  parserVersion,
  fieldManifestSha256: 'c'.repeat(64),
});

type Template = 'date' | 'byline' | 'amp';
const dateOf = (template: Template, stamp: string, displayed: string) =>
  template === 'amp'
    ? `<div class="amp-article__date">${displayed}</div>`
    : `<div class="article__${template === 'byline' ? 'byline-date' : 'date'}"><time datetime="${stamp}"></time></div>`;
const page = (date: string, paragraphs: readonly string[]) =>
  `${date}<div class="article-body"><figure>A synthetic picture caption.</figure>${paragraphs
    .map((text) => `<p>${text}</p>`)
    .join('<div>A synthetic video.</div>')}</div>`;

const nightOneParagraphs = (
  numbers: { first?: number; size?: number; closing?: number; next?: number } = {}
) => [
  `A SYNTHETIC club named its player the No.${numbers.first ?? 1} pick in the 2025 Telstra AFL Draft.`,
  `Synthetic clubs bid in a first round stretched to ${numbers.size ?? 25} picks on Wednesday night.`,
  'A synthetic paragraph about a synthetic player at No.7.',
  `There will be more when the draft continues on Thursday night, with Synthetic Club holding the next live pick at No.${numbers.next ?? 26}.`,
  `Synthetic Club was the last club in at No.${numbers.closing ?? 25}, closing out the first round with a synthetic player.`,
];
const nightTwoParagraphs = (
  numbers: { first?: number; night?: number; total?: number; wednesday?: boolean } = {}
) => [
  'SYNTHETIC Club opened night two of the 2025 Telstra AFL Draft with a synthetic player.',
  `The synthetic club chose to hold their valuable No.${numbers.first ?? 26} selection overnight, having picked at No.16 ${numbers.wednesday === false ? 'earlier' : 'on Wednesday night'}.`,
  `Night two of the Draft saw ${numbers.night ?? 35} players find AFL homes, making a total of ${numbers.total ?? 60} across the 2025 Draft.`,
  'A synthetic paragraph about a synthetic player at No.60.',
];
const nightOnePage = (template: Template = 'date', paragraphs = nightOneParagraphs()) =>
  page(dateOf(template, '2025-11-19T11:10:00Z', 'Nov 19, 2025'), paragraphs);
const nightTwoPage = (template: Template = 'amp', paragraphs = nightTwoParagraphs()) =>
  page(dateOf(template, '2025-11-20T08:50:00Z', 'Nov 20, 2025'), paragraphs);

const parse = (html: string, url: string, parserVersion?: string, anchorSeasonYear = 2025) =>
  parseOfficialAflDraftSession(html, { capture: capture(url, parserVersion), anchorSeasonYear });
const range = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, index) => first + index);

describe('2025 national draft sessions from the night reports’ boundary sentences (parser v20)', () => {
  it.each<Template>(['date', 'byline', 'amp'])(
    'reads both nights from the %s template as two completed sessions',
    (template) => {
      const one = parse(nightOnePage(template), nightOne!.url);
      const two = parse(nightTwoPage(template), nightTwo!.url);
      expect(one.issues).toEqual([]);
      expect(two.issues).toEqual([]);
      expect(one.evidence.map(({ content }) => content.sourceRow.sourceKey)).toEqual([
        'national-draft:2025:session:1',
      ]);
      expect(one.evidence[0]!.content.claim).toEqual({
        kind: 'draft_session',
        draftYear: 2025,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2025-11-19',
        officialName: '2025 Telstra AFL Draft',
        selectionNumbers: range(1, 25),
      });
      expect(two.evidence[0]!.content.claim).toEqual({
        kind: 'draft_session',
        draftYear: 2025,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2025-11-20',
        officialName: '2025 Telstra AFL Draft',
        selectionNumbers: range(26, 60),
      });
    }
  );

  it('reviews two contiguous sessions on a Wednesday and the Thursday after it', () => {
    expect(reviewedOfficialAflDraft2025SessionPages()).toEqual([
      { url: nightOne!.url, completedOn: '2025-11-19' },
      { url: nightTwo!.url, completedOn: '2025-11-20' },
    ]);
    expect(new Date(`${nightOne!.completedOn}T00:00:00Z`).getUTCDay()).toBe(3);
    expect(new Date(`${nightTwo!.completedOn}T00:00:00Z`).getUTCDay()).toBe(4);
    for (const { url } of reviewedOfficialAflDraft2025SessionPages()) {
      expect(url).toMatch(
        /^https:\/\/web\.archive\.org\/web\/\d{14}id_\/https:\/\/www\.afl\.com\.au\/news\/\d+\//
      );
    }
  });

  it.each<[string, () => string, string]>([
    [
      'a session-one boundary sentence is missing',
      () =>
        nightOnePage(
          'date',
          nightOneParagraphs().filter((_, index) => index !== 4)
        ),
      'missing or repeated',
    ],
    [
      'a session-one boundary sentence is repeated in another paragraph',
      () => nightOnePage('date', [...nightOneParagraphs(), nightOneParagraphs()[3]!]),
      'missing or repeated',
    ],
    [
      'the next live pick does not follow the last selection',
      () => nightOnePage('date', nightOneParagraphs({ next: 27 })),
      'disagrees',
    ],
    [
      'the first round’s size disagrees with its last selection',
      () => nightOnePage('date', nightOneParagraphs({ size: 24 })),
      'disagrees',
    ],
    [
      'the first round closes at another number',
      () => nightOnePage('date', nightOneParagraphs({ closing: 24 })),
      'disagrees',
    ],
    [
      'the draft does not open at No.1',
      () => nightOnePage('date', nightOneParagraphs({ first: 2 })),
      'disagrees',
    ],
    [
      'the contextual date differs',
      () => page(dateOf('date', '2025-11-20T11:10:00Z', ''), nightOneParagraphs()),
      'contextual date',
    ],
    [
      'the page carries two date templates',
      () =>
        page(
          dateOf('date', '2025-11-19T11:10:00Z', '') + dateOf('amp', '', 'Nov 19, 2025'),
          nightOneParagraphs()
        ),
      'contextual date',
    ],
    ['the page carries no date', () => page('', nightOneParagraphs()), 'contextual date'],
  ])('refuses night one when %s', (_label, html, detail) => {
    const result = parse(html(), nightOne!.url);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid_draft_session',
        detail: expect.stringContaining(detail),
      }),
    ]);
  });

  it.each<[string, Parameters<typeof nightTwoParagraphs>[0]]>([
    ['the night’s count and the total disagree with its first selection', { night: 36 }],
    ['the total disagrees with the reviewed last selection', { night: 36, total: 61 }],
    ['the held-over selection is another number', { first: 27 }],
    ['the held-over selection does not name the night before', { wednesday: false }],
  ])('refuses night two when %s', (_label, numbers) => {
    const result = parse(nightTwoPage('amp', nightTwoParagraphs(numbers)), nightTwo!.url);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toHaveLength(1);
  });

  it('refuses the reports under any other parser, season or night', () => {
    expect(
      parse(nightOnePage(), nightOne!.url, OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION).issues
    ).toEqual([expect.objectContaining({ detail: expect.stringContaining('parser v20') })]);
    expect(parse(nightOnePage(), nightOne!.url, V20, 2024).evidence).toEqual([]);
    // Each night's page read as the other night's report.
    expect(parse(nightOnePage('amp'), nightTwo!.url).evidence).toEqual([]);
    expect(parse(nightTwoPage('date'), nightOne!.url).evidence).toEqual([]);
    // The live afl.com.au URL is not the reviewed snapshot.
    expect(
      parse(
        nightOnePage(),
        nightOne!.url.replace(/^https:\/\/web\.archive\.org\/web\/\d{14}id_\//, '')
      ).evidence
    ).toEqual([]);
  });
});

describe('the 2025 completed-session capture scope', () => {
  const request: IngestAflTradeExternalPageRequest = {
    ...capture(nightOne!.url),
    environment: 'non_production',
    provider: 'official_afl',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftPathway: 'national',
    dataset: 'Synthetic completed draft session',
    datasetVersion: 'v1',
    accessMechanism: 'automated_web',
    capabilityId: 'official-afl-completed-draft-session',
    maximumBytes: 2097152,
  };

  it('pins 2025 to parser v20 and every other season to v19', () => {
    expect(officialAflDraftSessionParserVersion(2025)).toBe(
      'official-afl-completed-draft-session/v20'
    );
    for (const season of [2010, 2019, 2024, 2026]) {
      expect(officialAflDraftSessionParserVersion(season)).toBe(
        'official-afl-completed-draft-session/v19'
      );
    }
    expect(officialAflDraftSessionDecisionKey(2025)).toBe(
      'official-afl-completed-draft-session-issue579-private-2025-session-v20'
    );
    expect(officialAflDraftSessionDecisionKey(2024)).toBe(
      'official-afl-completed-draft-session-issue579-private-2024-session-v19'
    );
  });

  it('admits exactly the two reviewed snapshots under v20', () => {
    expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...request, sourceUrl: nightTwo!.url })
    ).not.toThrow();
    expect(() => validateAflTradeRetainedCaptureScope(request)).not.toThrow();
    for (const change of [
      { parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION },
      { anchorSeasonYear: 2024 },
      { sourceUrl: `${nightOne!.url}?other=true` },
      { draftPathway: null },
      { effectiveAt: '2024-11-19T00:00:00.000Z' },
    ]) {
      expect(() => validateAflTradeExternalCaptureScope({ ...request, ...change })).toThrow();
    }
    // A v19 2025 capture is refused on retention too: v19 never read a 2025 report.
    expect(() =>
      validateAflTradeRetainedCaptureScope({
        ...request,
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
      })
    ).toThrow();
  });

  it('keeps 2024 on v19, refusing v20, and retains its earlier captures', () => {
    const report2024 = {
      ...request,
      anchorSeasonYear: 2024,
      effectiveAt: '2024-11-20T00:00:00.000Z',
      sourceUrl:
        'https://www.afl.com.au/news/1257161/new-tiger-king-richmond-snares-powerful-mid-sam-lalor-at-no1/amp',
      parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
    };
    expect(() => validateAflTradeExternalCaptureScope(report2024)).not.toThrow();
    expect(() =>
      validateAflTradeExternalCaptureScope({ ...report2024, parserVersion: V20 })
    ).toThrow();
    expect(() =>
      validateAflTradeRetainedCaptureScope({
        ...report2024,
        parserVersion: 'official-afl-completed-draft-session/v18',
      })
    ).not.toThrow();
  });

  it('enumerates the two night reports as the 2025 capture targets', () => {
    expect(createLocalOfficialAflDraftSessionTargets([2025])).toEqual([
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2025,
        sourceUrl: nightOne!.url,
        effectiveAt: '2025-11-19T00:00:00.000Z',
      },
      {
        capabilityId: 'official-afl-completed-draft-session',
        season: 2025,
        sourceUrl: nightTwo!.url,
        effectiveAt: '2025-11-20T00:00:00.000Z',
      },
    ]);
  });
});

describe('fetching the 2025 night-report snapshots', () => {
  const capturePage = (url: string, fetchImpl: typeof fetch) =>
    captureOfficialAflPage({
      url,
      fetchImpl,
      maximumBytes: 1024,
      timeoutMs: 1000,
      validators: null,
    });

  it.each(reviewedOfficialAflDraft2025SessionPages().map(({ url }) => url))(
    'fetches the exact reviewed snapshot as HTML without following redirects: %s',
    async (url) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<article>fixture</article>', {
          headers: { 'content-type': 'text/html;charset=utf-8' },
        })
      );
      await expect(capturePage(url, fetchImpl)).resolves.toMatchObject({ status: 'captured' });
      expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }));
    }
  );

  it.each([
    nightOne!.url.replace('20251216210602', '20251216210603'),
    nightOne!.url.replace('id_/', '/'),
    nightTwo!.url.replace(/\/amp$/, ''),
  ])('refuses any other archive.org URL before fetch: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(capturePage(url, fetchImpl)).rejects.toThrow('outside the approved article path');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
