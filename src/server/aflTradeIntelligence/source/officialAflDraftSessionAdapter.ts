import {
  reviewedOfficialAflDraft2012EffectiveYear,
  parseOfficialAflDraft2012SessionFacts,
} from './officialAflDraft2012SessionFacts';
import {
  reviewedOfficialAflDraft2014EffectiveYear,
  parseOfficialAflDraft2014SessionFacts,
} from './officialAflDraft2014SessionFacts';
import {
  reviewedOfficialAflDraft2013EffectiveYear,
  parseOfficialAflDraft2013SessionFacts,
} from './officialAflDraft2013SessionFacts';
import {
  isReviewedOfficialAflDraft2015SessionFactUrl,
  parseOfficialAflDraft2015SessionFacts,
} from './officialAflDraft2015SessionFacts';
import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';
import {
  isReviewedOfficialAflDraft2016SessionFactUrl,
  parseOfficialAflDraft2016SessionFacts,
} from './officialAflDraft2016SessionFacts';
import {
  isReviewedOfficialAflDraft2017SessionFactUrl,
  parseOfficialAflDraft2017SessionFacts,
} from './officialAflDraft2017SessionFacts';
import {
  isReviewedOfficialAflDraft2018SessionFactUrl,
  parseOfficialAflDraft2018SessionFacts,
} from './officialAflDraft2018SessionFacts';
import {
  OFFICIAL_AFL_2019_CLUB_REVIEW_URL,
  parseOfficialAflDraft2019Sessions,
} from './officialAflDraft2019Sessions';

export const OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION = 'official-afl-completed-draft-session/v13';

// Exact reviewed completed reports: contextual date, event-day narrative and full
// selection coverage must agree. Publication time alone is never an event date.
const reviewedReports = [
  {
    url: 'https://www.afl.com.au/news/528411/every-pick-every-player-check-out-who-your-club-drafted',
    year: 2020,
    name: '2020 NAB AFL Draft',
    firstRound: 'First Round',
    numberedParagraphHeadings: true,
    tableFirst: 1,
    recapFirstRound: false,
    contextualDateSelector: '.article__date > time',
    ordinal: 1,
    date: '2020-12-09',
    displayedDate: '2020-12-09T12:30:00Z',
    first: 1,
    last: 59,
    narrative: /JAMARRA Ugle-Hagan is the No\.1 selection in the 2020 NAB AFL Draft/,
    coverage: /every pick in a draft full of twists and turns/,
  },
  {
    url: 'https://www.afl.com.au/news/688959/the-horne-supremacy-north-melbourne-makes-jason-horne-francis-its-no1-pick-for-the-2021-nab-afl-draft',
    year: 2021,
    name: '2021 NAB AFL Draft',
    firstRound: 'First Round',
    tableFirst: 1,
    recapFirstRound: false,
    contextualDateSelector: '.article__date > time',
    ordinal: 1,
    date: '2021-11-24',
    displayedDate: '2021-11-24T10:36:00Z',
    first: 1,
    last: 20,
    narrative: /Wednesday night's NAB AFL Draft/,
    coverage: /final selection of the first round, No\.20/,
  },
  {
    url: 'https://www.afl.com.au/news/689491/matt-johnson-wa-product-lands-at-fremantle-after-nervous-wait',
    year: 2021,
    name: '2021 NAB AFL Draft',
    firstRound: 'Second Round',
    paragraphMarker: 'NAB AFL DRAFT NIGHT TWO',
    tableFirst: 21,
    recapFirstRound: false,
    contextualDateSelector: '.article__date > time',
    ordinal: 2,
    date: '2021-11-25',
    displayedDate: '2021-11-25T11:45:00Z',
    first: 21,
    last: 65,
    narrative:
      /NIGHT two of the NAB AFL Draft started with.*?Matthew Johnson and ended with Taj Woewodin/,
    coverage: /65 players found their way on to AFL lists/,
  },
  {
    url: 'https://www.afl.com.au/news/869842/giants-grab-prized-forward-at-no-1-dons-hold-firm-sa-gun-slips-to-10',
    year: 2022,
    name: '2022 NAB AFL Draft',
    firstRound: 'First Round',
    tableFirst: 1,
    recapFirstRound: false,
    contextualDateSelector: '.article__date > time',
    ordinal: 1,
    date: '2022-11-28',
    displayedDate: '2022-11-28T10:30:00Z',
    first: 1,
    last: 21,
    narrative: /Monday night/,
    coverage: /rounded out the first round with pick No\.21/,
  },
  {
    url: 'https://www.afl.com.au/news/870364/giants-nab-versatile-tall-with-pick-22-eagles-add-exciting-ruckman/amp',
    year: 2022,
    name: '2022 NAB AFL Draft',
    firstRound: 'Second Round',
    heading: 'NAB AFL DRAFT - Second round',
    roundNames: ['Second round', 'Third round', 'Fourth round'],
    tableFirst: 22,
    recapFirstRound: false,
    contextualDateSelector: '.amp-article__date',
    ordinal: 2,
    date: '2022-11-29',
    displayedDate: 'Nov 29, 2022',
    first: 22,
    last: 59,
    narrative: /opening pick on night two.*?pick No\.22/,
    coverage: /No\.59, which was the final pick in the draft/,
  },
  {
    url: 'https://www.afl.com.au/news/1257161/new-tiger-king-richmond-snares-powerful-mid-sam-lalor-at-no1/amp',
    year: 2024,
    name: '2024 Telstra AFL Draft',
    firstRound: 'First Round',
    tableFirst: 1,
    recapFirstRound: false,
    contextualDateSelector: '.amp-article__date',
    ordinal: 1,
    date: '2024-11-20',
    displayedDate: 'Nov 20, 2024',
    first: 1,
    last: 27,
    narrative: /Wednesday night's opening round/,
    coverage: /last pick.*?No\.27/,
  },
  {
    url: 'https://www.afl.com.au/news/1257674/afl-draft-night-two-tigers-hold-firm-to-pounce-on-199cm-forward-dogs-pick-twice/amp',
    year: 2024,
    name: '2024 Telstra AFL Draft',
    firstRound: 'First Round',
    tableFirst: 1,
    recapFirstRound: true,
    contextualDateSelector: '.amp-article__date',
    ordinal: 2,
    date: '2024-11-21',
    displayedDate: 'Nov 21, 2024',
    first: 28,
    last: 71,
    narrative: /Thursday night/,
    coverage: /(?=[\s\S]*night two)(?=[\s\S]*total of 71)/,
  },
  {
    url: 'https://www.afl.com.au/news/1065734/need-for-harley-reid-eagles-swoop-on-prodigious-midfielder-at-no1-afl-draft/amp',
    year: 2023,
    name: '2023 AFL Draft',
    firstRound: 'First Round',
    tableFirst: 1,
    recapFirstRound: false,
    contextualDateSelector: '.amp-article__date',
    ordinal: 1,
    date: '2023-11-20',
    displayedDate: 'Nov 20, 2023',
    first: 1,
    last: 29,
    narrative: /Monday night/,
    coverage: /opening round.*?29 players/,
  },
  {
    url: 'https://www.afl.com.au/news/1066247/eagles-land-203cm-forward-to-open-night-two-lions-grab-goalkicker-afl-draft',
    year: 2023,
    name: '2023 AFL Draft',
    firstRound: 'Second Round',
    tableFirst: 30,
    recapFirstRound: false,
    contextualDateSelector: '.article__date > time',
    ordinal: 2,
    date: '2023-11-21',
    displayedDate: '2023-11-21T10:43:00Z',
    first: 30,
    last: 64,
    narrative: /second round got underway at pick No\.30 on Tuesday/,
    coverage: /64 players were selected across the two nights/,
  },
] as const;

export function isReviewedOfficialAflDraftSessionUrl(url: string, seasonYear: number): boolean {
  if (seasonYear === 2012 && reviewedOfficialAflDraft2012EffectiveYear(url) !== null) return true;
  if (seasonYear === 2014 && reviewedOfficialAflDraft2014EffectiveYear(url) !== null) return true;
  if (seasonYear === 2013 && reviewedOfficialAflDraft2013EffectiveYear(url) !== null) return true;
  if (seasonYear === 2015 && isReviewedOfficialAflDraft2015SessionFactUrl(url)) return true;
  if (seasonYear === 2016 && isReviewedOfficialAflDraft2016SessionFactUrl(url)) return true;
  if (seasonYear === 2017 && isReviewedOfficialAflDraft2017SessionFactUrl(url)) return true;
  if (seasonYear === 2018 && isReviewedOfficialAflDraft2018SessionFactUrl(url)) return true;
  if (url === OFFICIAL_AFL_2019_CLUB_REVIEW_URL) return seasonYear === 2019;
  return reviewedReports.some((report) => report.year === seasonYear && report.url === url);
}

export function parseOfficialAflDraftSession(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture']; anchorSeasonYear?: number }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  if (
    input.anchorSeasonYear === 2012 &&
    reviewedOfficialAflDraft2012EffectiveYear(input.capture.sourceUrl) !== null
  )
    return parseOfficialAflDraft2012SessionFacts(html, input);
  if (
    input.anchorSeasonYear === 2014 &&
    reviewedOfficialAflDraft2014EffectiveYear(input.capture.sourceUrl) !== null
  ) {
    return parseOfficialAflDraft2014SessionFacts(html, input);
  }
  if (
    input.anchorSeasonYear === 2013 &&
    reviewedOfficialAflDraft2013EffectiveYear(input.capture.sourceUrl) !== null
  )
    return parseOfficialAflDraft2013SessionFacts(html, input);
  if (isReviewedOfficialAflDraft2015SessionFactUrl(input.capture.sourceUrl))
    return parseOfficialAflDraft2015SessionFacts(html, input);
  if (isReviewedOfficialAflDraft2016SessionFactUrl(input.capture.sourceUrl))
    return parseOfficialAflDraft2016SessionFacts(html, input);
  if (isReviewedOfficialAflDraft2017SessionFactUrl(input.capture.sourceUrl))
    return parseOfficialAflDraft2017SessionFacts(html, input);
  if (isReviewedOfficialAflDraft2018SessionFactUrl(input.capture.sourceUrl))
    return parseOfficialAflDraft2018SessionFacts(html, input);
  if (input.capture.sourceUrl === OFFICIAL_AFL_2019_CLUB_REVIEW_URL)
    return parseOfficialAflDraft2019Sessions(html, input);
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session', sourceKey: input.capture.sourceUrl, detail }],
  });
  const report = reviewedReports.find((value) => value.url === input.capture.sourceUrl);
  if (!report) return fail('No reviewed completed-session report matches this exact URL.');
  const $ = load(html);
  const body = $('.article-body');
  const dates = $(report.contextualDateSelector);
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const contextualDate = dates.is('time') ? dates.attr('datetime') : clean(dates.text());
  if (body.length !== 1 || dates.length !== 1 || contextualDate !== report.displayedDate)
    return fail('The reviewed article body or contextual date has changed.');
  const narrative = clean(body.children('p').text());
  if (!report.narrative.test(narrative) || !report.coverage.test(narrative))
    return fail('The report no longer establishes the completed session and exact coverage.');
  let headings = body.children('h4');
  const paragraphLayout = 'paragraphMarker' in report;
  const numberedParagraphLayout = 'numberedParagraphHeadings' in report;
  if (numberedParagraphLayout) {
    if (body.children('h2,h3,h4').length !== 0)
      return fail('Unexpected headings in the reviewed numbered paragraph list.');
    headings = body
      .children('p')
      .children('strong')
      .filter((_, element) => /^\d+[.:]/.test(clean($(element).text())));
  } else if (paragraphLayout) {
    if (headings.length !== 0) return fail('Unexpected headings in the reviewed paragraph list.');
    headings = body
      .children('p')
      .filter((_, element) => clean($(element).text()) === report.paragraphMarker);
    if (headings.length !== 1)
      return fail('The reviewed session list marker is absent or ambiguous.');
  }
  const firstHeading = clean(headings.first().text());
  const expectedHeading =
    'heading' in report ? report.heading : `${report.name} - ${report.firstRound}`;
  if (
    !paragraphLayout &&
    !numberedParagraphLayout &&
    (firstHeading.replace('–', '-') !== expectedHeading ||
      (report.ordinal === 1 && headings.length !== 1) ||
      (report.ordinal === 2 && headings.length < 2))
  )
    return fail('The reviewed draft round headings are absent or ambiguous.');
  const roundNames: readonly string[] =
    'roundNames' in report
      ? report.roundNames
      : [
          'Second Round',
          'Third Round',
          'Fourth Round',
          'Fifth Round',
          'Sixth Round',
          'Seventh Round',
          'Eighth Round',
        ];
  const allNumbers: number[] = [];
  const selectedNumbers: number[] = [];
  let previousRound = report.firstRound === 'Second Round' ? 0 : -1;
  for (const [index, heading] of headings.toArray().entries()) {
    if (numberedParagraphLayout) {
      const paragraph = $(heading).parent();
      let headingText = clean($(heading).text());
      const splitHeading = [19, 21, 22, 27].includes(Number(/^\d+/.exec(headingText)?.[0]));
      if (
        paragraph.children('strong').length !== (splitHeading ? 2 : 1) ||
        paragraph.children().first().get(0) !== heading
      )
        return fail('The numbered selection paragraph has an ambiguous heading.');
      if (splitHeading) {
        const continuation = $(heading).next();
        const text = clean(continuation.text());
        if (!continuation.is('strong') || !text || /^\d+[.:]/.test(text))
          return fail('The reviewed split selection heading is incomplete or ambiguous.');
        headingText = clean(`${headingText} ${text}`);
      }
      // Only the heading establishes membership. Other paragraph fields include
      // biography and predicted draft ranges and are outside this capability.
      const match = /^(\d+)([.:])\s+([^:]+):\s+([^:]+)$/.exec(headingText);
      if (
        !match ||
        !match[3]!.trim() ||
        !match[4]!.trim() ||
        match[2] !== (Number(match[1]) === 28 ? ':' : '.')
      )
        return fail('The numbered selection heading no longer matches the reviewed report.');
      allNumbers.push(Number(match[1]));
      selectedNumbers.push(Number(match[1]));
      continue;
    }
    if (index > 0) {
      const round = roundNames.indexOf(clean($(heading).text()));
      if (round <= previousRound) return fail('Unexpected or duplicate draft round heading.');
      previousRound = round;
    }
    const paragraph = $(heading).next();
    if (!paragraph.is('p'))
      return fail('A reviewed draft round no longer has its selection paragraph.');
    const fragments = (paragraph.html() ?? '').split(/<br\s*\/?\s*>/i);
    const numbers: number[] = [];
    for (const fragment of fragments) {
      const text = clean(load(fragment).text());
      const match = /^(\d+)\.\s+\S.+\([^()]+\)$/.exec(text);
      if (!match)
        return fail('A draft selection line is missing its number or reported player/club text.');
      numbers.push(Number(match[1]));
    }
    allNumbers.push(...numbers);
    if (!report.recapFirstRound || index > 0) selectedNumbers.push(...numbers);
  }
  if (
    allNumbers.length !== report.last - report.tableFirst + 1 ||
    allNumbers.some((number, i) => number !== i + report.tableFirst) ||
    selectedNumbers.length !== report.last - report.first + 1 ||
    selectedNumbers.some((number, i) => number !== report.first + i)
  )
    return fail('Session selection membership is incomplete, duplicated or out of sequence.');
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: 1,
          sourceKey: `national-draft:${report.year}:session:${report.ordinal}`,
        },
        claim: {
          kind: 'draft_session',
          draftYear: report.year,
          draftType: 'national',
          sessionOrdinal: report.ordinal,
          eventDate: report.date,
          officialName: report.name,
          selectionNumbers: selectedNumbers,
        },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
