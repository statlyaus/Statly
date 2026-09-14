import { describe, expect, it } from 'vitest';

import {
  OFFICIAL_AFL_2016_SESSION_FACT_URLS,
  isReviewedOfficialAflDraft2016SessionFactUrl,
  parseOfficialAflDraft2016SessionFacts,
} from '@/server/aflTradeIntelligence/source/officialAflDraft2016SessionFacts';
import {
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
  isReviewedOfficialAflDraftSessionUrl,
  parseOfficialAflDraftSession,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import type { IngestAflTradeExternalPageRequest } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';

const digest = (value: string) => value.repeat(64);
const displayedDates = {
  completedWrap: '2016-11-25T10:40:03Z',
  prospectiveSchedule: '2016-11-25T00:53:50Z',
  independentTotal: '2019-11-28T11:30:00Z',
} as const;
const wrapParagraphs = [
  'ESSENDON has crowned Sandringham Dragons speedster Andrew McGrath as the No.1 pick in the 2016 NAB AFL Draft, ending a week of a secrecy and anticipation.',
  'There were five Sandringham Dragons players recruited in the first round on Friday night, with pick No.11 Oliver Florent (Sydney) joining McGrath, Taranto, Setterfield and Scrimshaw from the TAC Cup club.',
  'West Coast used the last pick in the Draft (No.77) to secure Jake Waterman, the son of premiership Eagle Chris.',
  "Fremantle's need for a young ruckman was addressed at pick No.40 when it selected Sean Darcy.",
] as const;
const scheduleParagraph =
  'Below is the final order of selection for the 2016 NAB AFL Draft. The draft will be held in Sydney on Friday, November 25.';
const totalParagraph =
  'With just 65 players being drafted, 2019 represented the lowest number in six years. Whether it was the mid-season draft taking away a few lists spots or clubs delisting less players, the number is significantly down. Last year 78 players were drafted, in 2017 it was also 78 and 77 got a chance in 2016. The last time the number dropped below 70 was in 2013, when 62 new players were drafted. Back then, rookie elevations were also announced on draft night, artificially boosting the numbers.';

function capture(url: string) {
  return {
    captureId: `source-capture:${digest('a')}`,
    artifactId: `artifact:${digest('b')}`,
    contentSha256: digest('b'),
    mediaType: 'text/html' as const,
    sourceUrl: url,
    capturedAt: '2026-09-11T00:00:00.000Z',
    effectiveAt: '2016-11-25T00:00:00.000Z',
    parserVersion: 'official-afl-completed-draft-session/v9',
    fieldManifestSha256: digest('c'),
  };
}
function page(displayedDate: string, paragraphs: readonly string[]) {
  return `<time datetime="2000-01-01T00:00:00Z"></time><div class="article__date"><time datetime="${displayedDate}"></time></div><div class="article-body">${paragraphs.map((value) => `<p>${value}</p>`).join('')}</div>`;
}
function parse(url: string, displayedDate: string, paragraphs: readonly string[]) {
  return parseOfficialAflDraft2016SessionFacts(page(displayedDate, paragraphs), {
    capture: capture(url),
  });
}

describe('reviewed Official AFL 2016 combined draft-session facts', () => {
  it('keeps the three reviewed articles within six exact source-bound proof roles', () => {
    const wrap = parse(
      OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap,
      displayedDates.completedWrap,
      wrapParagraphs
    );
    const schedule = parse(
      OFFICIAL_AFL_2016_SESSION_FACT_URLS.prospectiveSchedule,
      displayedDates.prospectiveSchedule,
      [scheduleParagraph]
    );
    const total = parse(
      OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal,
      displayedDates.independentTotal,
      [totalParagraph]
    );
    expect(wrap.issues).toEqual([]);
    expect(schedule.issues).toEqual([]);
    expect(total.issues).toEqual([]);
    expect(wrap.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'draft_session_date',
        draftYear: 2016,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2016-11-25',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2016,
        draftType: 'national',
        sessionOrdinal: 1,
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2016,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Andrew McGrath' },
        selectedByClub: { nativeId: null, recordedName: 'Essendon' },
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2016,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 77,
        player: { nativeId: null, recordedName: 'Jake Waterman' },
        selectedByClub: { nativeId: null, recordedName: 'West Coast' },
      },
    ]);
    expect(schedule.evidence.map(({ content }) => content.claim)).toEqual([
      {
        kind: 'draft_session_date',
        draftYear: 2016,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2016-11-25',
      },
    ]);
    expect(total.evidence.map(({ content }) => content.claim)).toEqual([
      { kind: 'draft_completed_total', draftYear: 2016, draftType: 'national', selectionCount: 77 },
    ]);
  });

  it('fails closed when wrap context, order, identity, or boundaries change', () => {
    const url = OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap;
    const joined = [...wrapParagraphs];
    const invalid = [
      joined.slice(1),
      [joined[0]!, joined[2]!, joined[1]!],
      [joined[0]!, joined[1]!, joined[1]!, joined[2]!],
      joined.map((value) => value.replace('Friday night', 'Thursday night')),
      joined.map((value) => value.replace('Andrew McGrath', 'Changed Player')),
      joined.map((value) => value.replace('No.1 pick', 'No.2 pick')),
      joined.map((value) => value.replace('West Coast', 'Changed Club')),
      joined.map((value) => value.replace('Jake Waterman', 'Changed Player')),
      joined.map((value) => value.replace('No.77', 'No.76')),
      joined.map((value, index) =>
        index === 2 ? `${value} Correction: the last pick was No.78.` : value
      ),
    ];
    for (const paragraphs of invalid) {
      const result = parse(url, displayedDates.completedWrap, paragraphs);
      expect(result.evidence).toEqual([]);
      expect(result.issues[0]?.code).toBe('invalid_draft_session');
    }
  });

  it('binds the 2019 retrospective timestamp to its scoped 2016 total only', () => {
    const url = OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal;
    for (const changed of [
      totalParagraph.replace('2019 represented', '2018 represented'),
      totalParagraph.replace('65 players', '66 players'),
      totalParagraph.replace('Last year 78', 'Last year 79'),
      totalParagraph.replace('2017 it was also 78', '2017 it was also 79'),
      totalParagraph.replace('77 got a chance in 2016', '77 got a chance in 2015'),
      totalParagraph.replace('77 got a chance in 2016', '76 got a chance in 2016'),
    ])
      expect(parse(url, displayedDates.independentTotal, [changed]).evidence).toEqual([]);
    expect(parse(url, '2016-11-25T11:30:00Z', [totalParagraph]).evidence).toEqual([]);
    expect(
      parse(url, displayedDates.independentTotal, [
        `${totalParagraph} Correction: 76 players were drafted in 2016.`,
      ]).evidence
    ).toEqual([]);
  });

  it('fails closed for duplicated, nested, or missing article structure', () => {
    const url = OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap;
    const validBody = `<div class="article-body">${wrapParagraphs.map((value) => `<p>${value}</p>`).join('')}</div>`;
    const validDate = `<div class="article__date"><time datetime="${displayedDates.completedWrap}"></time></div>`;
    for (const html of [
      validDate,
      validBody,
      validDate + validBody + validBody,
      validDate + validDate + validBody,
      validDate +
        `<div class="article-body"><section>${wrapParagraphs.map((value) => `<p>${value}</p>`).join('')}</section></div>`,
      validDate + '<div class="article-body"></div>',
    ]) {
      const result = parseOfficialAflDraft2016SessionFacts(html, { capture: capture(url) });
      expect(result.evidence).toEqual([]);
      expect(result.issues[0]?.code).toBe('invalid_draft_session');
    }
  });

  it('fails closed for changed or duplicated schedule and retrospective statements', () => {
    const scheduleUrl = OFFICIAL_AFL_2016_SESSION_FACT_URLS.prospectiveSchedule;
    for (const changed of [
      scheduleParagraph.replace('2016 NAB', '2017 NAB'),
      scheduleParagraph.replace('Friday', 'Thursday'),
      scheduleParagraph.replace('November 25', 'November 26'),
      `${scheduleParagraph} Correction: the draft will be held on November 26.`,
    ])
      expect(parse(scheduleUrl, displayedDates.prospectiveSchedule, [changed]).evidence).toEqual(
        []
      );
    expect(parse(scheduleUrl, '2016-11-26T00:53:50Z', [scheduleParagraph]).evidence).toEqual([]);
    expect(
      parse(scheduleUrl, displayedDates.prospectiveSchedule, [scheduleParagraph, scheduleParagraph])
        .evidence
    ).toEqual([]);
    const totalUrl = OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal;
    expect(parse(totalUrl, displayedDates.independentTotal, []).evidence).toEqual([]);
    expect(
      parse(totalUrl, displayedDates.independentTotal, [totalParagraph, totalParagraph]).evidence
    ).toEqual([]);
  });

  it.each([
    'toString',
    'constructor',
    '__proto__',
    'https://www.afl.com.au/news/123233/2016-afl-draft-verdict-how-did-your-club-fare',
  ])('rejects an unreviewed direct parser URL: %s', (url) => {
    expect(isReviewedOfficialAflDraft2016SessionFactUrl(url)).toBe(false);
    const result = parseOfficialAflDraft2016SessionFacts(
      page(displayedDates.completedWrap, wrapParagraphs),
      { capture: capture(url) }
    );
    expect(result.evidence).toEqual([]);
    expect(result.issues[0]?.code).toBe('invalid_draft_session');
  });

  it('excludes Sean Darcy incidental prose and the club verdict from membership evidence', () => {
    const url = OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap;
    const at40 = parse(url, displayedDates.completedWrap, wrapParagraphs);
    const at38 = parse(
      url,
      displayedDates.completedWrap,
      wrapParagraphs.map((value) => value.replace('pick No.40', 'pick No.38'))
    );
    expect(at38.evidence).toEqual(at40.evidence);
    expect(at40.evidence.some(({ content }) => content.claim.kind === 'draft_selection')).toBe(
      false
    );
    expect(
      isReviewedOfficialAflDraftSessionUrl(
        'https://www.afl.com.au/news/123233/2016-afl-draft-verdict-how-did-your-club-fare',
        2016
      )
    ).toBe(false);
  });

  it('routes and admits only the exact URLs for anchor year 2016', () => {
    for (const [key, url] of Object.entries(OFFICIAL_AFL_2016_SESSION_FACT_URLS)) {
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2016)).toBe(true);
      expect(isReviewedOfficialAflDraftSessionUrl(url, 2019)).toBe(false);
      expect(isReviewedOfficialAflDraftSessionUrl(`${url}?other=1`, 2016)).toBe(false);
      const request: IngestAflTradeExternalPageRequest = {
        ...capture(url),
        parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
        effectiveAt: displayedDates[key as keyof typeof displayedDates],
        environment: 'non_production',
        provider: 'official_afl',
        competition: 'AFLM',
        anchorSeasonYear: 2016,
        draftPathway: 'national',
        dataset: `2016-${key}`,
        datasetVersion: 'v1',
        accessMechanism: 'automated_web',
        capabilityId: 'official-afl-completed-draft-session',
        maximumBytes: 2097152,
      };
      expect(() => validateAflTradeExternalCaptureScope(request)).not.toThrow();
      expect(() =>
        validateAflTradeExternalCaptureScope({
          ...request,
          parserVersion: 'official-afl-completed-draft-session/v17',
        })
      ).toThrow();
      expect(() =>
        validateAflTradeExternalCaptureScope({ ...request, anchorSeasonYear: 2019 })
      ).toThrow();
    }
    const routed = parseOfficialAflDraftSession(
      page(displayedDates.completedWrap, wrapParagraphs),
      { capture: capture(OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap) }
    );
    expect(routed.issues).toEqual([]);
    expect(routed.evidence).toHaveLength(4);
  });
});
