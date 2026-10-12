/**
 * The exact reviewed Footyinfo national draft boards for issues 853 and 789 (owner Gate 0A decision
 * 2026-10-12, recorded in the source policy): one page per draft year, 2019 to 2025, read by
 * `footyinfo-draft-board-parser/v1` from the board data the page embeds. Inclusion grants no further
 * rights; no other Footyinfo path, query or year is reviewed.
 */
export const FOOTYINFO_DRAFT_BOARD_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;

export function footyinfoDraftBoardUrl(season: number): string {
  return `https://www.footyinfo.com/draft/${season}`;
}

/** The season of an exact reviewed board URL, or null. */
export function reviewedFootyinfoDraftBoardSeason(url: string): number | null {
  return (
    FOOTYINFO_DRAFT_BOARD_SEASONS.find((season) => footyinfoDraftBoardUrl(season) === url) ?? null
  );
}
