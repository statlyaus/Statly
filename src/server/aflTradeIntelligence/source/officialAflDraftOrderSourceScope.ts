/**
 * The exact reviewed Official AFL pre-draft national order pages for issue 853 (owner decision
 * 2026-10-09, recorded in the source policy): the order as it stood after each season's last
 * pick-swap deadline, which `official-afl-draft-order-parser/v3` reads as pick custody. 2023 and
 * 2024 were published only on the live `/draft/draft-order` page, since overwritten; the owner
 * approved exactly these two Internet Archive snapshots of it, served raw (`id_`). Inclusion grants
 * no further rights, and no other archive.org URL is reviewed.
 */
const reviewedOrders = [
  {
    season: 2019,
    url: 'https://www.afl.com.au/news/149224/final-draft-order-check-out-your-clubs-picks',
    // The article's publication date; the page states no as-of date.
    asOf: '2019-11-25',
  },
  {
    season: 2020,
    url: 'https://www.afl.com.au/news/523048/indicative-draft-order-your-club-s-picks-after-the-trade-period',
    asOf: '2020-12-04',
  },
  {
    season: 2021,
    url: 'https://www.afl.com.au/news/679302/indicative-draft-order-your-clubs-picks-as-they-stand',
    asOf: '2021-11-22',
  },
  {
    season: 2022,
    url: 'https://www.afl.com.au/news/867098/final-draft-order-check-out-your-clubs-picks',
    asOf: '2022-11-19',
  },
  {
    season: 2023,
    url: 'https://web.archive.org/web/20231119230530id_/https://www.afl.com.au/draft/draft-order',
    asOf: '2023-11-16',
  },
  {
    season: 2024,
    url: 'https://web.archive.org/web/20241119043700id_/https://www.afl.com.au/draft/draft-order',
    asOf: '2024-11-12',
  },
] as const;

export interface ReviewedOfficialAflDraftOrderPage {
  season: number;
  url: string;
  /** The date the page states (or was published) as the order it shows. */
  asOf: string;
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
