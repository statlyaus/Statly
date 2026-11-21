import type { AflTradeExternalEvidenceContent } from './externalDraftTradeEvidenceContracts';
import {
  OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS,
  parseOfficialAflDraftBoundarySession,
  type ReviewedBoundaryReport,
} from './officialAflDraftBoundarySessions';

/**
 * Completed-session parser v21 reads the 2026 national draft alone, from the boundary sentences of
 * its two dated night reports, as v20 reads 2025. The owner dropped Footyinfo for 2026 on 2026-11-21
 * ("Skip it, use AFL reports"): these reports confirm which numbers each night used. No Official AFL
 * page enumerates the 2026 selections in its HTML, so the claims prove the two sessions (ordinals,
 * dates and number ranges) and never the draft's membership. With no Footyinfo board either, no
 * 2026 matched bid is counted (owner: 2026 matched bids stay pending).
 */
export const OFFICIAL_AFL_DRAFT_2026_SESSION_PARSER_VERSION =
  OFFICIAL_AFL_DRAFT_SESSION_BOUNDARY_PARSER_VERSIONS[2026];

// Exactly these live afl.com.au non-AMP reports are reviewed (read 2026-11-21; no Internet Archive
// snapshot existed). The draft ran on Thursday 19 and Friday 20 November 2026.
const reviewedReports: readonly ReviewedBoundaryReport[] = [
  {
    url: 'https://www.afl.com.au/news/1642128/power-play-port-adelaide-lands-nga-talent-dougie-cochrane-as-clubs-first-ever-no1-pick',
    ordinal: 1,
    date: '2026-11-19',
    stamp: '2026-11-19T08:33:00Z',
    first: 1,
    last: 19,
    statements: [
      // The draft, its first selection and the night the session ran.
      {
        pattern: /\bfirst ever No\.(\d+) pick in the 2026 Telstra AFL Draft on Thursday night\b/g,
        states: ({ first }) => [first],
      },
      // The session's size.
      {
        pattern:
          /\bIn an exciting opening round that included\b[^.]*?\band (\d+) overall selections\b/g,
        states: ({ first, last }) => [last - first + 1],
      },
      // The session's last selection.
      {
        pattern: /\bhad the final selection, using No\.(\d+) to select\b/g,
        states: ({ last }) => [last],
      },
      // The draft resumes the next night at the following pick, so the session is complete.
      {
        pattern:
          /\bholding pick No\.(\d+), which will be the first selection of the second night of the draft on Friday\b/g,
        states: ({ last }) => [last + 1],
      },
    ],
  },
  {
    url: 'https://www.afl.com.au/news/1642270/port-adelaide-power-add-electric-forward-wil-malady-to-draft-haul-north-melbourne-kangaroos-make-move',
    ordinal: 2,
    date: '2026-11-20',
    stamp: '2026-11-20T08:52:00Z',
    first: 20,
    last: 65,
    statements: [
      // The session and the night it ran. The body never names the year; the contextual date does.
      {
        pattern: /\bon Friday after\b.*?\bon night two of the Telstra AFL Draft\b/g,
        states: () => [],
      },
      // The session's first selection, stated only in the report's own summary.
      {
        pattern: /\bat pick No\.(\d+), the opening selection on night two\b/g,
        states: ({ first }) => [first],
        in: 'description',
      },
      // The draft's completed total: the session ends at the draft's last selection.
      { pattern: /\bin a draft that saw (\d+) total selections\b/g, states: ({ last }) => [last] },
      // The session's last selection.
      {
        pattern: /\bthen used pick No\.(\d+) as the final selection\b/g,
        states: ({ last }) => [last],
      },
    ],
  },
];

export function isReviewedOfficialAflDraft2026SessionUrl(url: string): boolean {
  return reviewedReports.some((report) => report.url === url);
}

/** The reviewed 2026 night reports in session order, with the night each reports. */
export function reviewedOfficialAflDraft2026SessionPages(): { url: string; completedOn: string }[] {
  return reviewedReports.map(({ url, date }) => ({ url, completedOn: date }));
}

export function parseOfficialAflDraft2026Sessions(
  html: string,
  input: { capture: AflTradeExternalEvidenceContent['capture']; anchorSeasonYear?: number }
) {
  return parseOfficialAflDraftBoundarySession(
    { draftYear: 2026, officialName: '2026 Telstra AFL Draft', reports: reviewedReports },
    html,
    input
  );
}
