import { load } from 'cheerio';

import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2016_SESSION_FACT_URLS = {
  completedWrap:
    'https://www.afl.com.au/news/157359/draft-wrap-bombers-take-mcgrath-with-no1-draft-pick',
  prospectiveSchedule: 'https://www.afl.com.au/news/49872/indicative-2016-afl-draft-order',
  independentTotal:
    'https://www.afl.com.au/news/149290/10-things-we-learned-from-the-2019-nab-afl-draft',
} as const;

export function reviewedOfficialAflDraft2016EffectiveYear(url: string): number | null {
  if (url === OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal) return 2019;
  if (
    url === OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap ||
    url === OFFICIAL_AFL_2016_SESSION_FACT_URLS.prospectiveSchedule
  )
    return 2016;
  return null;
}

type PartialSessionClaim = Extract<
  AflTradeExternalEvidenceContent['claim'],
  {
    kind:
      | 'draft_session_date'
      | 'draft_session_completion'
      | 'draft_session_boundary'
      | 'draft_completed_total';
  }
>;

const reports = new Map<
  string,
  { displayedDate: string; statements: readonly string[]; claims: readonly PartialSessionClaim[] }
>([
  [
    OFFICIAL_AFL_2016_SESSION_FACT_URLS.completedWrap,
    {
      displayedDate: '2016-11-25T10:40:03Z',
      statements: [
        'ESSENDON has crowned Sandringham Dragons speedster Andrew McGrath as the No.1 pick in the 2016 NAB AFL Draft, ending a week of a secrecy and anticipation.',
        'There were five Sandringham Dragons players recruited in the first round on Friday night, with pick No.11 Oliver Florent (Sydney) joining McGrath, Taranto, Setterfield and Scrimshaw from the TAC Cup club.',
        'West Coast used the last pick in the Draft (No.77) to secure Jake Waterman, the son of premiership Eagle Chris.',
      ],
      claims: [
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
      ],
    },
  ],
  [
    OFFICIAL_AFL_2016_SESSION_FACT_URLS.prospectiveSchedule,
    {
      displayedDate: '2016-11-25T00:53:50Z',
      statements: [
        'Below is the final order of selection for the 2016 NAB AFL Draft. The draft will be held in Sydney on Friday, November 25.',
      ],
      claims: [
        {
          kind: 'draft_session_date',
          draftYear: 2016,
          draftType: 'national',
          sessionOrdinal: 1,
          eventDate: '2016-11-25',
        },
      ],
    },
  ],
  [
    OFFICIAL_AFL_2016_SESSION_FACT_URLS.independentTotal,
    {
      displayedDate: '2019-11-28T11:30:00Z',
      statements: [
        'With just 65 players being drafted, 2019 represented the lowest number in six years. Whether it was the mid-season draft taking away a few lists spots or clubs delisting less players, the number is significantly down. Last year 78 players were drafted, in 2017 it was also 78 and 77 got a chance in 2016. The last time the number dropped below 70 was in 2013, when 62 new players were drafted. Back then, rookie elevations were also announced on draft night, artificially boosting the numbers.',
      ],
      claims: [
        {
          kind: 'draft_completed_total',
          draftYear: 2016,
          draftType: 'national',
          selectionCount: 77,
        },
      ],
    },
  ],
]);

export function isReviewedOfficialAflDraft2016SessionFactUrl(url: string): boolean {
  return reports.has(url);
}

export function parseOfficialAflDraft2016SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [
      { code: 'invalid_draft_session' as const, sourceKey: input.capture.sourceUrl, detail },
    ],
  });
  const report = reports.get(input.capture.sourceUrl);
  if (!report) return fail('No reviewed 2016 partial-session report matches this exact URL.');
  const $ = load(html);
  const body = $('.article-body');
  const dates = $('.article__date > time');
  const paragraphs = body
    .children('p')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get();
  const indexes = report.statements.map((statement) =>
    paragraphs.flatMap((paragraph, index) => (statement === paragraph ? [index] : []))
  );
  const uniquelyOrdered =
    indexes.every((matches) => matches.length === 1) &&
    indexes.every((matches, index) => index === 0 || matches[0]! > indexes[index - 1]![0]!);
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== report.displayedDate ||
    !uniquelyOrdered
  )
    return fail('The reviewed 2016 partial-session article structure or scoped statement changed.');
  return {
    evidence: report.claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2016:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
