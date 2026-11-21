import { load } from 'cheerio';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
  type AflTradeExternalEvidenceEnvelope,
} from './externalDraftTradeEvidenceContracts';
import type { AflTradeExternalPageIssue } from './externalDraftTradeIngestion';

/**
 * Completed-session parsers that read a national draft's sessions from the boundary sentences of its
 * dated night reports, because no Official AFL page enumerates that draft's selections: v20 for 2025
 * (`officialAflDraft2025Sessions.ts`) and v21 for 2026 (`officialAflDraft2026Sessions.ts`). Their
 * claims prove the sessions (ordinals, dates and number ranges) and never the draft's membership, so
 * reconciliation never counts them toward a membership proof.
 */
export const OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS = {
  2025: 'official-afl-completed-draft-session/v20',
  2026: 'official-afl-completed-draft-session/v21',
} as const;

export function isOfficialAflDraftSessionBoundaryParserVersion(parserVersion: string): boolean {
  return Object.values<string>(OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS).includes(
    parserVersion
  );
}

export interface ReviewedBoundaryStatement {
  /** Matches once in exactly one paragraph; each capture group is one stated number. */
  pattern: RegExp;
  /** The numbers the statement must state, derived from the reviewed session range. */
  states: (session: { first: number; last: number }) => readonly number[];
  /**
   * Where the statement is read: the article body's paragraphs (the default), or the report's own
   * summary, its single `<meta name="description">`.
   */
  in?: 'description';
}

export interface ReviewedBoundaryReport {
  url: string;
  ordinal: number;
  /** The event date: the night the session ran. */
  date: string;
  /**
   * The non-AMP template's `datetime` and, when an AMP page was reviewed, the AMP template's
   * displayed date of the same report. Without `displayed` an AMP page is refused.
   */
  stamp: string;
  displayed?: string;
  first: number;
  last: number;
  statements: readonly ReviewedBoundaryStatement[];
}

export interface ReviewedBoundaryDraft {
  draftYear: keyof typeof OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS;
  officialName: string;
  reports: readonly ReviewedBoundaryReport[];
}

const ARTICLE_DATE = '.article__date > time, .article__byline-date > time, .amp-article__date';

export function parseOfficialAflDraftBoundarySession(
  draft: ReviewedBoundaryDraft,
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture']; anchorSeasonYear?: number }
): { evidence: AflTradeExternalEvidenceEnvelope[]; issues: AflTradeExternalPageIssue[] } {
  const { draftYear } = draft;
  const parserVersion = OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS[draftYear];
  const fail = (detail: string) => ({
    evidence: [],
    issues: [{ code: 'invalid_draft_session', sourceKey: input.capture.sourceUrl, detail }],
  });
  const report = draft.reports.find(({ url }) => url === input.capture.sourceUrl);
  if (!report || (input.anchorSeasonYear !== undefined && input.anchorSeasonYear !== draftYear))
    return fail(`The source is not a reviewed ${draftYear} night report.`);
  if (input.capture.parserVersion !== parserVersion)
    return fail(
      `The ${draftYear} night reports are read only by completed-session parser ${parserVersion.slice(parserVersion.lastIndexOf('/') + 1)}.`
    );
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
  const descriptions = $('meta[name="description"]')
    .map((_, meta) => clean($(meta).attr('content') ?? ''))
    .get();
  for (const statement of report.statements) {
    // A summary is read only from a report with exactly one.
    const texts =
      statement.in !== 'description' ? paragraphs : descriptions.length === 1 ? descriptions : [];
    const found = texts.flatMap((text) => [...text.matchAll(statement.pattern)]);
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
        sourceRow: {
          ordinal: 1,
          sourceKey: `national-draft:${draftYear}:session:${report.ordinal}`,
        },
        claim: {
          kind: 'draft_session',
          draftYear,
          draftType: 'national',
          sessionOrdinal: report.ordinal,
          eventDate: report.date,
          officialName: draft.officialName,
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
