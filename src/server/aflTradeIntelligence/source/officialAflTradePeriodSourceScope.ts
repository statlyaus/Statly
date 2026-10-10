/**
 * The exact reviewed Official AFL announcements of each season's trade-period dates
 * (statlyaus/Statly#869, owner decision 2026-10-10: the yearly trade-period window is a traded
 * arrival's date precision). `official-afl-trade-period-parser/v1` reads one window per page. Each
 * entry records the window the reviewer read on the page, which the capture's `effectiveAt` repeats
 * and the parser must reproduce. Inclusion grants no further rights. 2019 and 2021 have no reviewed
 * page yet: no afl.com.au announcement of those seasons' dates was found on 2026-10-10, and the
 * owner has not approved a substitute source.
 */
const reviewedAnnouncements = [
  {
    season: 2020,
    url: 'https://www.afl.com.au/news/498142/player-movement-dates-second-tier-next-generation-academies',
    // "November 4-12: AFL Trade Period" (the 2020 period ran in November after the delayed season).
    earliestDate: '2020-11-04',
    latestDate: '2020-11-12',
  },
  {
    season: 2022,
    url: 'https://www.afl.com.au/news/811821/draft-bonanza-sign-and-trade-period-dates-confirmed-for-2022',
    earliestDate: '2022-10-03',
    latestDate: '2022-10-12',
  },
  {
    season: 2023,
    url: 'https://www.afl.com.au/news/1004881/afl-confirms-dates-for-2023-afl-trade-and-draft-period',
    earliestDate: '2023-10-09',
    latestDate: '2023-10-18',
  },
  {
    season: 2024,
    url: 'https://www.afl.com.au/news/1110249/afl-confirms-dates-for-2024-free-agency-trade-and-draft-period',
    earliestDate: '2024-10-07',
    latestDate: '2024-10-16',
  },
  {
    season: 2025,
    url: 'https://www.afl.com.au/news/1291626/dates-for-2025-trade-period-free-agency-mid-season-rookie-draft-national-draft-for-both-afl-and-aflw-revealed',
    earliestDate: '2025-10-06',
    latestDate: '2025-10-15',
  },
] as const;

export interface ReviewedOfficialAflTradePeriodPage {
  season: number;
  url: string;
  /** The first day of the trade period as the page states it. */
  earliestDate: string;
  /** The deadline day of the trade period as the page states it. */
  latestDate: string;
}

export function reviewedOfficialAflTradePeriodPages(
  season: number
): readonly ReviewedOfficialAflTradePeriodPage[] {
  return reviewedAnnouncements.filter((page) => page.season === season);
}

export function reviewedOfficialAflTradePeriodPage(
  url: string
): ReviewedOfficialAflTradePeriodPage | null {
  return reviewedAnnouncements.find((page) => page.url === url) ?? null;
}
