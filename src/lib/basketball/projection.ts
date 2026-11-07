/**
 * Per-game projections: this season blended with last season by games played.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import { NBA_STAT_KEYS, type NbaStatKey, type NbaStatLine } from '@/types/basketball';
import { scaleStatLine } from './statLine';

/** A player's season totals, summed from box scores. */
export interface PlayerSeasonTotals extends NbaStatLine {
  playerId: string;
  gamesPlayed: number;
  secondsPlayed: number;
}

export interface PlayerProjection {
  playerId: string;
  gamesThisSeason: number;
  gamesLastSeason: number;
  /** `min(1, gamesThisSeason / 15)`; 0 when the projection is last season alone. */
  weightThisSeason: number;
  minutesPerGame: number;
  perGame: NbaStatLine;
}

/** Games this season after which last season no longer counts. */
export const BLEND_GAMES = 15;

/**
 * The league-baseline per-game line a rookie is blended with (the sheet's Rosters row 2). It has no
 * minutes or three-point attempts: a rookie's own numbers stand for those.
 */
export const ROOKIE_BASELINE_PER_GAME: Readonly<Partial<NbaStatLine>> = {
  fieldGoalsMade: 3,
  fieldGoalsAttempted: 7,
  freeThrowsMade: 1.1,
  freeThrowsAttempted: 1.5,
  threePointersMade: 0.9,
  points: 8,
  rebounds: 3.2,
  assists: 1.6,
  steals: 0.6,
  blocks: 0.4,
  turnovers: 1,
};

/** Per-game averages from season totals, or null when the player has no games. */
export function seasonPerGame(
  totals: PlayerSeasonTotals
): { minutesPerGame: number; perGame: NbaStatLine } | null {
  if (!(totals.gamesPlayed > 0)) return null;
  const perGameFactor = 1 / totals.gamesPlayed;
  const statLine = Object.fromEntries(
    NBA_STAT_KEYS.map((key) => [key, totals[key]])
  ) as NbaStatLine;
  return {
    minutesPerGame: (totals.secondsPlayed / 60) * perGameFactor,
    perGame: scaleStatLine(statLine, perGameFactor),
  };
}

/**
 * Blends this season's per-game line with last season's: `w·now + (1 − w)·last`, `w = min(1, g/15)`.
 * Every stat, makes and attempts included, is blended as a count, so a percentage is blended makes
 * over blended attempts. A player with no last season is blended with the rookie baseline (minutes
 * and three-point attempts are his own). Returns null with no games in either season.
 */
export function blendProjection(
  thisSeason: PlayerSeasonTotals | undefined,
  lastSeason: PlayerSeasonTotals | undefined
): PlayerProjection | null {
  const now = thisSeason ? seasonPerGame(thisSeason) : null;
  const last = lastSeason ? seasonPerGame(lastSeason) : null;
  const gamesLastSeason = last && lastSeason ? lastSeason.gamesPlayed : 0;

  if (!now || !thisSeason) {
    if (!last || !lastSeason) return null;
    return {
      playerId: lastSeason.playerId,
      gamesThisSeason: 0,
      gamesLastSeason,
      weightThisSeason: 0,
      ...last,
    };
  }

  const gamesThisSeason = thisSeason.gamesPlayed;
  const weight = Math.min(1, gamesThisSeason / BLEND_GAMES);
  const prior = (key: NbaStatKey): number =>
    last ? last.perGame[key] : (ROOKIE_BASELINE_PER_GAME[key] ?? now.perGame[key]);
  const perGame = Object.fromEntries(
    NBA_STAT_KEYS.map((key) => [key, weight * now.perGame[key] + (1 - weight) * prior(key)])
  ) as NbaStatLine;
  const minutesPerGame = last
    ? weight * now.minutesPerGame + (1 - weight) * last.minutesPerGame
    : now.minutesPerGame;

  return {
    playerId: thisSeason.playerId,
    gamesThisSeason,
    gamesLastSeason,
    weightThisSeason: weight,
    minutesPerGame,
    perGame,
  };
}
