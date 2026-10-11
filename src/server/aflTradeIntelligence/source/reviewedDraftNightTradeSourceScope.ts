/**
 * The reviewed draft-night pick trade statements (statlyaus/Statly#886, owner decision 2026-10-12: a
 * reviewed source class for the pick trades clubs make during the national draft, which no approved
 * provider states). A statement is Statly's own reviewed JSON file, committed in this repository and
 * pinned here by the sha256 of its exact bytes; its source URL is its location in the repository,
 * and the local runner reads it from the checkout, never over the network. A corrected statement is a
 * new file with a new version, never an edit of a registered one. Inclusion grants no rights.
 */
export const REVIEWED_DRAFT_NIGHT_TRADES_PROVIDER = 'statly_reviewed' as const;

const REPOSITORY_BLOB = 'https://github.com/statlyaus/Statly/blob/main/';

/** Statements live in this repository; `statly_reviewed` evidence must cite one. */
export function isReviewedStatementSourceUrl(sourceUrl: string): boolean {
  return sourceUrl.startsWith(REPOSITORY_BLOB) && sourceUrl.endsWith('.json');
}

export function reviewedStatementSourceUrl(repositoryPath: string): string {
  return `${REPOSITORY_BLOB}${repositoryPath}`;
}

export interface ReviewedDraftNightTradeSeason {
  season: number;
  /** The national draft's nights, as the AFL states them. A deal's date must be one of them. */
  draftNights: readonly string[];
  /** The last slot of the season's final pre-draft national order: a dealt slot is 1 to this. */
  selectionCount: number;
  /** Where the reviewer read the nights and the order. */
  sources: readonly string[];
}

const seasons: readonly ReviewedDraftNightTradeSeason[] = [
  {
    season: 2024,
    // "the first round to be conducted on Wednesday, November 20 ... the rest of the national draft
    // to follow on Thursday, November 21".
    draftNights: ['2024-11-20', '2024-11-21'],
    // The AFL Media final draft order ends at pick 92 (West Coast).
    selectionCount: 92,
    sources: [
      'https://www.afl.com.au/news/1110249/afl-confirms-dates-for-2024-free-agency-trade-and-draft-period',
      'https://www.richmondfc.com.au/news/1694565/afl-draft-explainer-everything-you-need-to-know',
    ],
  },
];

export interface ReviewedDraftNightTradeStatementEntry extends ReviewedDraftNightTradeSeason {
  /** The statement's path in this repository. */
  repositoryPath: string;
  url: string;
  /** The sha256 of the statement's exact bytes. */
  sha256: string;
  /** A synthetic statement for the outcomes integration suite is admitted only in test_fixture. */
  environments: readonly ('test_fixture' | 'non_production')[];
}

const statements: readonly {
  season: number;
  repositoryPath: string;
  sha256: string;
  environments: readonly ('test_fixture' | 'non_production')[];
}[] = [
  {
    // Synthetic: one deal between synthetic clubs, staged only by the outcomes integration suite.
    season: 2024,
    repositoryPath: 'tests/fixtures/reviewed-draft-night-trades/2024-synthetic-v1.json',
    sha256: '3798c4c6756d5f0f5da60aaf3cc13f2c44fcc3e7b601cb4792b79091c6ee8bd2',
    environments: ['test_fixture'],
  },
];

export function reviewedDraftNightTradeSeason(
  season: number
): ReviewedDraftNightTradeSeason | null {
  return seasons.find((entry) => entry.season === season) ?? null;
}

function withSeason(statement: (typeof statements)[number]) {
  const season = reviewedDraftNightTradeSeason(statement.season);
  return season === null
    ? null
    : { ...season, ...statement, url: reviewedStatementSourceUrl(statement.repositoryPath) };
}

export function reviewedDraftNightTradeStatements(
  season: number,
  environment: 'test_fixture' | 'non_production'
): readonly ReviewedDraftNightTradeStatementEntry[] {
  return statements
    .filter((entry) => entry.season === season && entry.environments.includes(environment))
    .flatMap((entry) => withSeason(entry) ?? []);
}

export function reviewedDraftNightTradeStatement(
  url: string
): ReviewedDraftNightTradeStatementEntry | null {
  const entry = statements.find(
    (statement) => reviewedStatementSourceUrl(statement.repositoryPath) === url
  );
  return entry === undefined ? null : withSeason(entry);
}
