export type DraftDirection = 'FORWARD' | 'REVERSE';

/**
 * Calculates round, direction and slot for a given pick in a snake draft.
 * @param currentPick global pick number starting at 1
 * @param teamCount number of teams participating
 */
export function computeSnakeState(
  currentPick: number,
  teamCount: number,
): { round: number; direction: DraftDirection; slot: number } {
  if (teamCount <= 0) throw new Error('teamCount must be positive');
  if (currentPick <= 0) throw new Error('currentPick must be positive');

  const round = Math.ceil(currentPick / teamCount);
  const direction: DraftDirection = round % 2 === 1 ? 'FORWARD' : 'REVERSE';
  const indexInRound = (currentPick - 1) % teamCount;
  const slot = direction === 'FORWARD' ? indexInRound + 1 : teamCount - indexInRound;
  return { round, direction, slot };
}

/**
 * Generates the full snake draft order given a number of teams and starter size (active roster spots).
 * Returns an array of rounds, each round being an array of team slots in pick order.
 */
export function generateSnakeDraftOrder(
  teamCount: number,
  starterSize: number,
  benchSize = 0,
): number[][] {
  if (teamCount <= 0) throw new Error('teamCount must be positive');
  if (!Number.isInteger(rosterSize) || rosterSize < 0) throw new Error('rosterSize must be a non-negative integer');
  if (!Number.isInteger(benchSize) || benchSize < 0) throw new Error('benchSize must be a non-negative integer');
  const rounds = starterSize + benchSize;
  const order: number[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const roundOrder: number[] = [];
    if (r % 2 === 1) {
      for (let i = 1; i <= teamCount; i++) roundOrder.push(i);
    } else {
      for (let i = teamCount; i >= 1; i--) roundOrder.push(i);
    }
    order.push(roundOrder);
  }
  return order;
}
