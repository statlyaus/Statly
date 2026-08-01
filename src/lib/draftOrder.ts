export type DraftOrderType = 'SNAKE' | 'LINEAR';
export type DraftOrderDirection = 'FORWARD' | 'REVERSE';

export type DraftPickCoordinate = {
  round: number;
  slot: number;
  direction: DraftOrderDirection;
};

/**
 * Returns the round, slot, and direction for an overall draft pick.
 *
 * This helper intentionally owns only order arithmetic. Callers remain responsible
 * for validating that the calculated slot belongs to a persisted participant.
 */
export function getDraftPickCoordinate(
  draftType: DraftOrderType,
  overall: number,
  teamCount: number
): DraftPickCoordinate {
  if (draftType !== 'SNAKE' && draftType !== 'LINEAR') {
    throw new Error(`Unsupported draft order type: ${String(draftType)}`);
  }

  if (!Number.isInteger(teamCount) || teamCount <= 0) {
    throw new Error('Draft has no participants');
  }

  if (!Number.isInteger(overall) || overall <= 0) {
    throw new Error('Draft pick must be a positive integer');
  }

  const round = Math.ceil(overall / teamCount);
  const pickIndex = (overall - 1) % teamCount;
  const isReverse = draftType === 'SNAKE' && round % 2 === 0;

  return {
    round,
    slot: isReverse ? teamCount - pickIndex : pickIndex + 1,
    direction: isReverse ? 'REVERSE' : 'FORWARD',
  };
}
