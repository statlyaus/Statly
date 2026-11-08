/**
 * Role outlook injury input: a stored injury report row as the share of his team's next 5 games a
 * player is expected to miss (the role model's input) and the games he is expected to miss in all
 * (the rest-of-season input). Replaces the sheet's wording rules (`readInjuries_`) for the
 * provider's status and return date. Pure and isomorphic.
 */

import type { EasternDate } from './fantasyWeeks';
import type { RoleInjury } from './roleModel';

/** An injury report row, provider-neutral. */
export interface PlayerInjury {
  status: 'OUT' | 'DAY_TO_DAY';
  expectedReturnOn: EasternDate | null;
  /** The report says he is out for the season. */
  seasonEnding: boolean;
}

export interface InjuryOutlook extends RoleInjury {
  /** Expected games missed, uncapped; 999 for the rest of the season. */
  gamesOut: number;
}

const OUT_FOR_SEASON: InjuryOutlook = { fracNext5: 1, gamesOut: 999 };
const DUE_BACK: InjuryOutlook = { fracNext5: 0.1, gamesOut: 0.5 };

/**
 * `upcoming` holds the dates of his team's remaining games (not final, today or later). A return
 * date counts the team's games before it (at least one); no date: OUT misses 2 of the next 5,
 * day-to-day 0.5.
 */
export function injuryOutlook(
  injury: PlayerInjury,
  upcoming: readonly EasternDate[],
  today: EasternDate
): InjuryOutlook {
  if (injury.seasonEnding) return OUT_FOR_SEASON;
  const back = injury.expectedReturnOn;
  if (back === null) return injury.status === 'OUT' ? { fracNext5: 0.4, gamesOut: 2 } : DUE_BACK;
  if (back <= today) return DUE_BACK;
  const missed = upcoming.filter((date) => date < back).length;
  if (missed === upcoming.length) return OUT_FOR_SEASON;
  const gamesOut = Math.max(missed, 1);
  return { fracNext5: Math.min(gamesOut, 5) / 5, gamesOut };
}
