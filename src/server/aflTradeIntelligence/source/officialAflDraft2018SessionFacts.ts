import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

export const OFFICIAL_AFL_2018_SESSION_FACT_URLS = {
  nightOne: 'https://www.afl.com.au/news/53184/draft-wrap-blues-claim-walsh-suns-triple-treat',
  dayTwoFirst:
    'https://www.afl.com.au/news/39763/they-were-my-no1-preference-draftee-happy-at-suns',
  finalSelection:
    'https://www.afl.com.au/news/99499/draft-talking-points-racing-royalty-and-bluebloods',
  completedLessons:
    'https://www.afl.com.au/news/140672/nine-things-we-learned-from-the-nab-afl-draft',
  prospectiveSchedule:
    'https://www.afl.com.au/news/98796/final-draft-order-all-of-your-clubs-picks',
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
    scopes: readonly {
      heading?: RegExp;
      paragraph: RegExp;
      followedBy?: RegExp;
    }[];
    claims: readonly PartialSessionClaim[];
  }
> = {
  [OFFICIAL_AFL_2018_SESSION_FACT_URLS.nightOne]: {
    displayedDate: '2018-11-22T08:05:00Z',
    scopes: [
      {
        paragraph:
          /CARLTON has crowned Sam Walsh the new No\.1 pick at the 2018 NAB AFL Draft.*at Marvel Stadium on Thursday night/,
      },
    ],
    claims: [
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2018-11-22',
      },
    ],
  },
  [OFFICIAL_AFL_2018_SESSION_FACT_URLS.dayTwoFirst]: {
    displayedDate: '2018-11-28T00:34:00Z',
    scopes: [
      {
        paragraph:
          /rebounding defender Jez McLennan \(No\.23\).*the first selection on day two/,
        followedBy: /Gold Coast traded up to get the South Australian teenager/,
      },
    ],
    claims: [
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'first',
        selectionNumber: 23,
        player: { nativeId: null, recordedName: 'Jez McLennan' },
        selectedByClub: { nativeId: null, recordedName: 'Gold Coast' },
      },
    ],
  },
  [OFFICIAL_AFL_2018_SESSION_FACT_URLS.finalSelection]: {
    displayedDate: '2018-11-23T06:22:00Z',
    scopes: [
      {
        heading: /Racing royalty at the Dogs/,
        paragraph:
          /with the final selection the Western Bulldogs rewarded hard-working Will Hayes.*pick 78/,
      },
      {
        heading: /Live pick trading divides opinions/,
        paragraph:
          /first round on Thursday night.*Carlton's recruiting team.*selecting Sam Walsh.*pick No\.1.*Once the second round got underway on Friday/,
      },
    ],
    claims: [
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
        boundary: 'first',
        selectionNumber: 1,
        player: { nativeId: null, recordedName: 'Sam Walsh' },
        selectedByClub: { nativeId: null, recordedName: 'Carlton' },
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
      },
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2018-11-23',
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
      },
      {
        kind: 'draft_session_boundary',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        boundary: 'last',
        selectionNumber: 78,
        player: { nativeId: null, recordedName: 'Will Hayes' },
        selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
      },
    ],
  },
  [OFFICIAL_AFL_2018_SESSION_FACT_URLS.completedLessons]: {
    displayedDate: '2018-11-27T00:18:00Z',
    scopes: [
      {
        heading: /1\. Pick 19 is arguably worth more than pick 18/,
        paragraph:
          /completion of Thursday's first round to the start of the rest of the draft on Friday/,
      },
      {
        heading: /7\. More live trades than predicted/,
        paragraph: /Seventeen of 78 players taken in the National Draft/,
      },
      {
        heading: /8\. Recruiters need to bank their sleep/,
        paragraph: /The introduction of a two-day draft/,
      },
    ],
    claims: [
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
      },
      {
        kind: 'draft_session_completion',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
      },
      {
        kind: 'draft_completed_total',
        draftYear: 2018,
        draftType: 'national',
        selectionCount: 78,
      },
    ],
  },
  [OFFICIAL_AFL_2018_SESSION_FACT_URLS.prospectiveSchedule]: {
    displayedDate: '2018-11-19T22:56:00Z',
    scopes: [
      {
        paragraph: /confirmed the final order for the NAB AFL Draft on November 22 and 23/,
      },
    ],
    claims: [
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 1,
        eventDate: '2018-11-22',
      },
      {
        kind: 'draft_session_date',
        draftYear: 2018,
        draftType: 'national',
        sessionOrdinal: 2,
        eventDate: '2018-11-23',
      },
    ],
  },
};

export function isReviewedOfficialAflDraft2018SessionFactUrl(url: string): boolean {
  return reports[url] !== undefined;
}

export function parseOfficialAflDraft2018SessionFacts(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture'] }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session', sourceKey: input.capture.sourceUrl, detail }],
  });
  const report = reports[input.capture.sourceUrl];
  if (!report) return fail('No reviewed 2018 partial-session report matches this exact URL.');
  const $ = load(html);
  const body = $('.article-body');
  const dates = $('.article__date > time');
  const children = body
    .children('h2,h3,h4,p')
    .map((_, element) => ({
      tag: element.tagName,
      text: $(element).text().replace(/\s+/g, ' ').trim(),
    }))
    .get();
  const scopeMatches = report.scopes.every((scope) => {
    const headingIndexes = scope.heading
      ? children.flatMap((child, index) =>
          child.tag !== 'p' && scope.heading!.test(child.text) ? [index] : []
        )
      : [-1];
    if (headingIndexes.length !== 1) return false;
    const start = headingIndexes[0]! + 1;
    const end = scope.heading
      ? children.findIndex((child, index) => index >= start && child.tag !== 'p')
      : children.length;
    const paragraphs = children.slice(start, end === -1 ? children.length : end);
    const matches = paragraphs.flatMap((child, index) =>
      child.tag === 'p' && scope.paragraph.test(child.text) ? [index] : []
    );
    if (matches.length !== 1) return false;
    if (!scope.followedBy) return true;
    const next = paragraphs[matches[0]! + 1];
    return next?.tag === 'p' && scope.followedBy.test(next.text);
  });
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    dates.attr('datetime') !== report.displayedDate ||
    !scopeMatches
  ) {
    return fail('The reviewed 2018 partial-session article structure or scoped statement changed.');
  }
  return {
    evidence: report.claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: {
          ordinal: index + 1,
          sourceKey: `national-draft:2018:${claim.kind}:${index + 1}`,
        },
        claim,
        publicationEligible: false,
      })
    ),
    issues: [],
  };
}
