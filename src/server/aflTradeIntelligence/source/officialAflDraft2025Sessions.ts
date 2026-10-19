import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

/**
 * Completed-session parser v20 reads the 2025 national draft alone (issue 853, coordinator decision
 * 2026-10-16 under the owner's grant of 2026-10-14). No Official AFL page enumerates the 2025
 * selections, so each night's session is read from the boundary sentences of its dated night
 * report: where the session starts, where it ends, the night it ran and the draft's completed
 * total. This is a weaker standard than a numbered selection list. The claims prove the two
 * sessions (their ordinals, dates and number ranges) and never the draft's membership, which stays
 * proven by the reviewed Footyinfo board and the Draftguru year page (grade rule v5, #923). Every
 * other season keeps parser v19.
 */
export const OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION =
  'official-afl-completed-draft-session/v20';

const OFFICIAL_NAME = '2025 Telstra AFL Draft';

interface ReviewedBoundaryStatement {
  /** Matches once in exactly one paragraph; each capture group is one stated number. */
  pattern: RegExp;
  /** The numbers the statement must state, derived from the reviewed session range. */
  states: (session: { first: number; last: number }) => readonly number[];
}

interface ReviewedBoundaryReport {
  url: string;
  ordinal: number;
  /** The event date: the night the session ran. */
  date: string;
  /** The non-AMP template's `datetime` and the AMP template's displayed date of the same report. */
  stamp: string;
  displayed: string;
  first: number;
  last: number;
  statements: readonly ReviewedBoundaryStatement[];
}

// Exactly these Internet Archive snapshots (served raw, `id_`) are reviewed. The night-one snapshot
// is the non-AMP page; the night-two snapshot is the AMP page captured the morning after the draft.
// Both templates carry the same paragraphs, and the parser reads either template's date.
const reviewedReports: readonly ReviewedBoundaryReport[] = [
  {
    url: 'https://web.archive.org/web/20251216210602id_/https://www.afl.com.au/news/1454417/best-in-the-west-eagles-crown-no1-pick-tigers-surprise-shapes-draft',
    ordinal: 1,
    date: '2025-11-19',
    stamp: '2025-11-19T11:10:00Z',
    displayed: 'Nov 19, 2025',
    first: 1,
    last: 25,
    statements: [
      // The draft and its first selection.
      {
        pattern: /\bthe No\.(\d+) pick in the 2025 Telstra AFL Draft\b/g,
        states: ({ first }) => [first],
      },
      // The night the session ran and its size.
      {
        pattern: /\ba first round stretched to (\d+) picks on Wednesday night\b/g,
        states: ({ first, last }) => [last - first + 1],
      },
      // The session's last selection.
      {
        pattern: /\bat No\.(\d+), closing out the first round\b/g,
        states: ({ last }) => [last],
      },
      // The draft resumes the next night at the following pick, so the session is complete.
      {
        pattern:
          /\bthe draft continues on Thursday night, with [A-Z][A-Za-z ]+ holding the next live pick at No\.(\d+)\b/g,
        states: ({ last }) => [last + 1],
      },
    ],
  },
  {
    url: 'https://web.archive.org/web/20251120223457id_/https://www.afl.com.au/news/1455116/roos-fill-a-need-to-start-night-two-some-top-talent-left-in-limbo/amp',
    ordinal: 2,
    date: '2025-11-20',
    stamp: '2025-11-20T08:50:00Z',
    displayed: 'Nov 20, 2025',
    first: 26,
    last: 60,
    statements: [
      // The draft and the session.
      { pattern: /\bopened night two of the 2025 Telstra AFL Draft\b/g, states: () => [] },
      // The session's first selection, held over from the Wednesday night: the session ran the
      // night after it.
      {
        pattern: /\bhold their valuable No\.(\d+) selection overnight\b.*?\bon Wednesday night\b/g,
        states: ({ first }) => [first],
      },
      // The session's size and the draft's completed total: the session ends at the last selection.
      {
        pattern:
          /\bNight two of the Draft saw (\d+) players find AFL homes, making a total of (\d+) across the 2025 Draft\b/g,
        states: ({ first, last }) => [last - first + 1, last],
      },
    ],
  },
];

const ARTICLE_DATE = '.article__date > time, .article__byline-date > time, .amp-article__date';

export function isReviewedOfficialAflDraft2025SessionUrl(url: string): boolean {
  return reviewedReports.some((report) => report.url === url);
}

/** The reviewed 2025 night reports in session order, with the night each reports. */
export function reviewedOfficialAflDraft2025SessionPages(): { url: string; completedOn: string }[] {
  return reviewedReports.map(({ url, date }) => ({ url, completedOn: date }));
}

export function parseOfficialAflDraft2025Sessions(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture']; anchorSeasonYear?: number }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session', sourceKey: input.capture.sourceUrl, detail }],
  });
  const report = reviewedReports.find(({ url }) => url === input.capture.sourceUrl);
  if (!report || (input.anchorSeasonYear !== undefined && input.anchorSeasonYear !== 2025))
    return fail('The source is not a reviewed 2025 night report.');
  if (input.capture.parserVersion !== OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSION)
    return fail('The 2025 night reports are read only by completed-session parser v20.');
  const $ = load(html);
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const body = $('.article-body');
  const dates = $(ARTICLE_DATE);
  const contextualDate = dates.is('time') ? dates.attr('datetime') : clean(dates.text());
  if (
    body.length !== 1 ||
    dates.length !== 1 ||
    contextualDate !== (dates.is('time') ? report.stamp : report.displayed)
  )
    return fail('The reviewed article body or contextual date has changed.');
  const paragraphs = body
    .children('p')
    .map((_, paragraph) => clean($(paragraph).text()))
    .get();
  for (const statement of report.statements) {
    const found = paragraphs.flatMap((text) => [...text.matchAll(statement.pattern)]);
    if (found.length !== 1)
      return fail('A reviewed session boundary statement is missing or repeated.');
    const stated = found[0]!.slice(1).map(Number);
    const expected = statement.states(report);
    if (stated.length !== expected.length || stated.some((value, i) => value !== expected[i]))
      return fail('A reviewed session boundary statement disagrees with the session range.');
  }
  return {
    evidence: [
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: 'afl-trade-external-evidence/v1',
        provider: 'official_afl',
        capture: input.capture,
        sourceRow: { ordinal: 1, sourceKey: `national-draft:2025:session:${report.ordinal}` },
        claim: {
          kind: 'draft_session',
          draftYear: 2025,
          draftType: 'national',
          sessionOrdinal: report.ordinal,
          eventDate: report.date,
          officialName: OFFICIAL_NAME,
          selectionNumbers: Array.from(
            { length: report.last - report.first + 1 },
            (_, i) => report.first + i
          ),
        },
        publicationEligible: false,
      }),
    ],
    issues: [],
  };
}
