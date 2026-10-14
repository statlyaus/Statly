/**
 * Read-only classification of one unscored side of a finalized matchup (bug-report #10).
 *
 * A side is "late" when at least one of its players was set after that player's game had started.
 * Those players score zero under the repair rule; the rest of the lineup scores normally.
 *
 * Each player is judged by its own set time (`LeagueLineupPlayer.createdAt`), not the lineup's: a save
 * deletes and recreates every player whose game has not started and keeps the rows of players whose
 * game has, so a player row's `createdAt` is the last save that set that player.
 */

export type UnscoredSideClassification =
  | 'NO_LINEUP'
  | 'EMPTY_LINEUP'
  | 'LINEUP_SCOPE_AMBIGUOUS'
  | 'TIMING_UNAVAILABLE'
  | 'UNKNOWN_START'
  | 'LATE_SET'
  | 'PRE_START_SET';

export interface UnscoredSideInput {
  /** When the lineup was first saved, or null when the member has no lineup for the round. */
  lineupCreatedAt: Date | null;
  lineupUpdatedAt: Date | null;
  /** Each player with the time that player was last set. */
  players: readonly { playerId: string; setAt: Date }[];
  /**
   * True when the league has another competition round with the same round number (another season
   * or fixture version). Lineups are keyed by league, member and round only, so the lineup found may
   * belong to that other round.
   */
  lineupScopeAmbiguous: boolean;
  /** Null when official AFL timing could not be loaded for the round. */
  gameStartsByPlayerId: ReadonlyMap<string, Date> | null;
}

export interface UnscoredSideAssessment {
  classification: UnscoredSideClassification;
  playerCount: number;
  startedBeforeSet: number;
  notStarted: number;
  unknownStart: number;
  /** True when the lineup changed well after it was first saved. Informational: players carry their own set times. */
  edited: boolean;
}

const EDITED_AFTER_MS = 60_000;

export function classifyUnscoredSide(input: UnscoredSideInput): UnscoredSideAssessment {
  const playerCount = input.players.length;
  const base = {
    playerCount,
    startedBeforeSet: 0,
    notStarted: 0,
    unknownStart: 0,
    edited: false,
  };

  if (!input.lineupCreatedAt) return { ...base, classification: 'NO_LINEUP' };

  const edited =
    input.lineupUpdatedAt !== null &&
    input.lineupUpdatedAt.getTime() - input.lineupCreatedAt.getTime() > EDITED_AFTER_MS;

  if (input.lineupScopeAmbiguous) {
    return { ...base, edited, classification: 'LINEUP_SCOPE_AMBIGUOUS' };
  }
  if (playerCount === 0) return { ...base, edited, classification: 'EMPTY_LINEUP' };
  if (!input.gameStartsByPlayerId) {
    return { ...base, edited, classification: 'TIMING_UNAVAILABLE' };
  }

  let startedBeforeSet = 0;
  let notStarted = 0;
  let unknownStart = 0;
  for (const player of input.players) {
    const startsAt = input.gameStartsByPlayerId.get(player.playerId);
    if (!startsAt) {
      unknownStart += 1;
    } else if (startsAt.getTime() < player.setAt.getTime()) {
      startedBeforeSet += 1;
    } else {
      notStarted += 1;
    }
  }

  const counts = { playerCount, startedBeforeSet, notStarted, unknownStart, edited };
  if (unknownStart > 0) return { ...counts, classification: 'UNKNOWN_START' };
  if (startedBeforeSet > 0) return { ...counts, classification: 'LATE_SET' };
  return { ...counts, classification: 'PRE_START_SET' };
}
