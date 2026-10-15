import {
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5,
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  type OfficialAflDraftOrderTableParserVersion,
} from './draftCorroborationAdapter';

/**
 * The exact reviewed Official AFL pre-draft national order pages for issue 853 (owner decision
 * 2026-10-09, recorded in the source policy): the order as it stood after each season's last
 * pick-swap deadline, which `official-afl-draft-order-parser/v4` reads as pick custody. 2023 to
 * 2025 were published only on the live `/draft/draft-order` page, since overwritten; exactly these
 * Internet Archive snapshots of it are reviewed, served raw (`id_`). 2025 is the first capture
 * after its pick-swap window closed on 7 November. 2026 (issue 789, owner direction 2026-10-14:
 * value a pick not yet selected from the live order) is the owner-requested 14 October 2026
 * snapshot of the live order as it stood that day, before the season's pick-swap deadline, read
 * by parser v5; every other season stays on v4. Inclusion grants no further rights, and no other
 * archive.org URL is reviewed.
 */
const reviewedOrders = [
  {
    season: 2019,
    url: 'https://www.afl.com.au/news/149224/final-draft-order-check-out-your-clubs-picks',
    // The article's publication date; the page states no as-of date.
    asOf: '2019-11-25',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2020,
    url: 'https://www.afl.com.au/news/523048/indicative-draft-order-your-club-s-picks-after-the-trade-period',
    asOf: '2020-12-04',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2021,
    url: 'https://www.afl.com.au/news/679302/indicative-draft-order-your-clubs-picks-as-they-stand',
    asOf: '2021-11-22',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2022,
    url: 'https://www.afl.com.au/news/867098/final-draft-order-check-out-your-clubs-picks',
    asOf: '2022-11-19',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2023,
    url: 'https://web.archive.org/web/20231119230530id_/https://www.afl.com.au/draft/draft-order',
    asOf: '2023-11-16',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2024,
    url: 'https://web.archive.org/web/20241119043700id_/https://www.afl.com.au/draft/draft-order',
    asOf: '2024-11-12',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2025,
    url: 'https://web.archive.org/web/20251113035435id_/https://www.afl.com.au/draft/draft-order',
    // The page states "As at conclusion of pick swaps window on November 7."
    asOf: '2025-11-07',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  },
  {
    season: 2026,
    url: 'https://web.archive.org/web/20261014083707id_/https://www.afl.com.au/draft/draft-order',
    // The page states "Updated: October 14, 2026" and no pick-swap as-of date.
    asOf: '2026-10-14',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_V5,
  },
] as const;

export interface ReviewedOfficialAflDraftOrderPage {
  season: number;
  url: string;
  /** The date the page states (or was published) as the order it shows. */
  asOf: string;
  /** The table parser reviewed for this page; a capture under any other version is refused. */
  parserVersion: OfficialAflDraftOrderTableParserVersion;
}

export function reviewedOfficialAflDraftOrderPages(
  season: number
): readonly ReviewedOfficialAflDraftOrderPage[] {
  return reviewedOrders.filter((page) => page.season === season);
}

export function reviewedOfficialAflDraftOrderPage(
  url: string
): ReviewedOfficialAflDraftOrderPage | null {
  return reviewedOrders.find((page) => page.url === url) ?? null;
}

/**
 * The parser of a season's reviewed pages, which names the owner's per-season decision key; `null`
 * when the season has no reviewed page.
 */
export function reviewedOfficialAflDraftOrderParserVersion(
  season: number
): OfficialAflDraftOrderTableParserVersion | null {
  const versions = new Set(
    reviewedOfficialAflDraftOrderPages(season).map((page) => page.parserVersion)
  );
  if (versions.size > 1) {
    throw new TypeError(`The reviewed ${season} pre-draft order pages name more than one parser.`);
  }
  return [...versions][0] ?? null;
}
