import type { AflTradeStorySampleSummary } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import { AFL_GENERAL_MANAGER_TENURES, type AflGeneralManagerTenure } from './generalManagers';

/**
 * The general managers ladder (/afl/trades/general-managers, owner 2026-11-26): each club's side of
 * each trade is credited to the club's head of football in that trade period, at the net the trade
 * pages show (what the club received minus what it gave, in first-stint PAV). A side no season has
 * been played since is a projection and is left out until one has, as on the trade ladder.
 * Two people in the role at once split the side equally and each counts the deal. Totals are plain
 * sums; with the uncredited sides added back they come to zero, like the trades.
 */

export interface GeneralManagerLadderRow {
  readonly person: string;
  readonly club: string;
  readonly firstYear: number;
  readonly lastYear: number;
  /** Club sides credited, a shared side counted whole. */
  readonly deals: number;
  /** Net PAV over those sides, a shared side at its share. */
  readonly net: number;
  readonly perDeal: number;
  /** A credited tenure rests on one source or an inferred month. */
  readonly unconfirmed: boolean;
}

export interface GeneralManagerLadder {
  /** Highest net first. */
  readonly rows: readonly GeneralManagerLadderRow[];
  /** Club sides with nobody known in the role, left out of every total. */
  readonly uncredited: number;
  /** Club sides left out because they are still projections. */
  readonly projected: number;
}

/** The month each trade period ran: October, except 2020's (COVID), which ran in November. */
const tradePeriodMonth = (year: number) => `${year}-${year === 2020 ? '11' : '10'}`;

/**
 * Who ran the club's football department in that year's trade period. Months are `YYYY-MM`, so they
 * compare as text. When one person leaves and another starts in the trade month, the one leaving ran
 * it: appointments are announced after the period.
 */
export function generalManagersAt(
  tenures: readonly AflGeneralManagerTenure[],
  club: string,
  year: number
): AflGeneralManagerTenure[] {
  const month = tradePeriodMonth(year);
  const holders = tenures.filter(
    (row) => row.club === club && row.start <= month && (row.end === null || month <= row.end)
  );
  const leaving = holders.filter(({ end }) => end === month);
  return leaving.length > 0 ? holders.filter(({ start }) => start !== month) : holders;
}

export function generalManagerLadder(
  stories: readonly AflTradeStorySampleSummary[],
  tenures: readonly AflGeneralManagerTenure[] = AFL_GENERAL_MANAGER_TENURES
): GeneralManagerLadder {
  const totals = new Map<
    string,
    {
      person: string;
      club: string;
      years: number[];
      deals: number;
      net: number;
      unconfirmed: boolean;
    }
  >();
  let uncredited = 0;
  let projected = 0;
  for (const story of stories)
    for (const result of story.results ?? []) {
      if (result.projected) {
        projected += 1;
        continue;
      }
      const holders = generalManagersAt(tenures, result.clubName, story.year);
      if (holders.length === 0) {
        uncredited += 1;
        continue;
      }
      for (const holder of holders) {
        const key = `${holder.person}\u0000${holder.club}`;
        const total = totals.get(key) ?? {
          person: holder.person,
          club: holder.club,
          years: [],
          deals: 0,
          net: 0,
          unconfirmed: false,
        };
        total.years.push(story.year);
        total.deals += 1;
        total.net += result.net / holders.length;
        total.unconfirmed ||= !holder.confirmed;
        totals.set(key, total);
      }
    }
  const rows = [...totals.values()]
    .map((total): GeneralManagerLadderRow => ({
      person: total.person,
      club: total.club,
      firstYear: Math.min(...total.years),
      lastYear: Math.max(...total.years),
      deals: total.deals,
      net: total.net,
      perDeal: total.net / total.deals,
      unconfirmed: total.unconfirmed,
    }))
    .sort((left, right) => right.net - left.net || left.person.localeCompare(right.person));
  return { rows, uncredited, projected };
}
