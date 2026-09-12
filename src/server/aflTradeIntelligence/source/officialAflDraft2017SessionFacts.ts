import { load } from 'cheerio';

import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2017_SESSION_FACT_URLS = {
  completedWrap:
    'https://www.afl.com.au/news/142762/draft-wrap-lions-reveal-top-pick-freos-big-call',
  completedTotal: 'https://www.afl.com.au/news/83698/broadcast-guide-premiership',
  prospectiveSchedule:
    'https://www.afl.com.au/news/46107/final-draft-order-check-out-all-of-your-clubs-picks',
} as const;

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

const reports: Record<
  string,
  {
    displayedDate: string;
    statements: readonly RegExp[];
    claims: readonly PartialSessionClaim[];
  }
> = {
  [OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedWrap]: {
    displayedDate: '2017-11-24T10:22:00Z',
    statements: [
      /BRISBANE Lions have crowned Western Jets powerhouse Cameron Rayner as the No\.1 pick of the 2017 NAB AFL Draft.*night of surprises/,
      /big honour to be named the No\.1 pick, just after 7pm AEDT at the Sydney Showground on Friday night/,
      /former Gold Coast utility Jarrod Garlett joined Carlton with the last pick in the draft at No\.78/,
    ],
    claims: [
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2017-11-24',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Cameron Rayner' },
        selectedByClub: { nativeId: null, recordedName: 'Brisbane Lions' },
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'last',
        selectionNumber: 78,
        player: { nativeId: null, recordedName: 'Jarrod Garlett' },
        selectedByClub: { nativeId: null, recordedName: 'Carlton' },
      },
    ],
  },
  [OFFICIAL_AFL_2017_SESSION_FACT_URLS.completedTotal]: {
    displayedDate: '2017-11-24T22:00:00Z',
    statements: [/78 [–-] 78 players were selected by clubs in this year's NAB AFL Draft/],
    claims: [
      {
        kind: 'draft_completed_total',
        draftYear: 2017,
        draftType: 'national',
        selectionCount: 78,
      },
    ],
  },
  [OFFICIAL_AFL_2017_SESSION_FACT_URLS.prospectiveSchedule]: {
    displayedDate: '2017-11-22T03:22:00Z',
    statements: [
      /final order of selection for the 2017 NAB AFL Draft following the trade period/,
      /draft will be held in Sydney on Friday night from 6:30pm AEDT/,
    ],
    claims: [
      {
        kind: 'draft_session_date',
        draftYear: 2017,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2017-11-24',
      },
    ],
  },
};

export function isReviewedOfficialAflDraft2017SessionFactUrl(url: string): boolean {
  return reports[url] !== undefined;
}

export function parseOfficialAflDraft2017SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session' as const, sourceKey: input.capture.sourceUrl, detail }],
  });
  const report = reports[input.capture.sourceUrl];
  if (!report) return fail('No reviewed 2017 partial-session report matches this exact URL.');
  const $ = load(html);
  const body = $('.article-body');
  const dates = $('.article__date > time');
  const paragraphs = body
    .children('p')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get();
  const statementsMatch = report.statements.every(
    (statement) => paragraphs.filter((paragraph) => statement.test(paragraph)).length === 1
  );
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== report.displayedDate ||
    !statementsMatch
  ) {
    return fail('The reviewed 2017 partial-session article structure or scoped statement changed.');
  }
  return {
    evidence: report.claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2017:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
