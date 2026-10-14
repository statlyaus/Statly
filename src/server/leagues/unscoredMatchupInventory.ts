/**
 * Read-only classification of one unscored side of a finalized matchup (bug-report #10).
 *
 * A side is "late" when its lineup was saved after at least one of its players' games had started.
 * Those players score zero under the repair rule; the rest of the lineup scores normally.
 */

export type UnscoredSideClassification =
  'NO_LINEUP' | 'TIMING_UNAVAILABLE' | 'UNKNOWN_START' | 'LATE_SET' | 'PRE_START_SET';

export interface UnscoredSideInput {
  /** When the lineup was first saved, or null when the member has no lineup for the round. */
  lineupCreatedAt: Date | null;
  lineupUpdatedAt: Date | null;
  players: readonly { playerId: string }[];
  /** Null when official AFL timing could not be loaded for the round. */
  gameStartsByPlayerId: ReadonlyMap<string, Date> | null;
}

export interface UnscoredSideAssessment {
  classification: UnscoredSideClassification;
  playerCount: number;
  startedBeforeSet: number;
  notStarted: number;
  unknownStart: number;
  /** True when the lineup changed well after it was first saved, so createdAt may not be the set time. */
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

  if (!input.lineupCreatedAt || playerCount === 0) {
    return { ...base, classification: 'NO_LINEUP' };
  }

  const createdAt = input.lineupCreatedAt;
  const edited =
    input.lineupUpdatedAt !== null &&
    input.lineupUpdatedAt.getTime() - createdAt.getTime() > EDITED_AFTER_MS;

  if (!input.gameStartsByPlayerId) {
    return { ...base, playerCount, edited, classification: 'TIMING_UNAVAILABLE' };
  }

  let startedBeforeSet = 0;
  let notStarted = 0;
  let unknownStart = 0;
  for (const player of input.players) {
    const startsAt = input.gameStartsByPlayerId.get(player.playerId);
    if (!startsAt) {
      unknownStart += 1;
    } else if (startsAt.getTime() < createdAt.getTime()) {
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
