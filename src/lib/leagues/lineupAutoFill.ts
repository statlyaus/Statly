import type { LeagueLineupSlot } from '@/server/leagues/scoringTypes';

/**
 * Lineup auto-fill shared by the My Team page and the server's default lineups.
 *
 * Position rules: DEF, MID, RUC and FWD spots take only players listed in that position
 * (dual-position players such as `DEF/MID` suit either). UTIL and interchange take anyone.
 */

export interface AutoFillSpot {
  slot: LeagueLineupSlot;
  slotIndex: number;
}

export interface AutoFillAssignment {
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
}

export interface AutoFillPlayer {
  playerId: string;
  position: string | null;
  /** False for players on a bye, listed injured, or whose game has already started. */
  available: boolean;
  /** Higher is better. */
  score: number;
}

const POSITION_ALIASES: Record<string, string> = {
  RUCK: 'RUC',
  DEFENDER: 'DEF',
  DEFENCE: 'DEF',
  MIDFIELD: 'MID',
  MIDFIELDER: 'MID',
  FORWARD: 'FWD',
};

export function isPositionSlot(slot: LeagueLineupSlot): boolean {
  return slot === 'DEF' || slot === 'MID' || slot === 'RUC' || slot === 'FWD';
}

/** True when the player's listed position suits the slot. UTIL and interchange suit anyone. */
export function positionSuitsSlot(position: string | null | undefined, slot: LeagueLineupSlot) {
  if (!isPositionSlot(slot)) return true;
  if (!position) return false;
  return position
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .map((part) => POSITION_ALIASES[part] ?? part)
    .includes(slot);
}

function sameSpot(left: AutoFillSpot, right: AutoFillSpot) {
  return left.slot === right.slot && left.slotIndex === right.slotIndex;
}

/**
 * Fills empty spots with available players who are not already selected.
 *
 * Position spots are filled first, scarcest position first (so a DEF/RUC player is not spent on
 * DEF when they are the only ruck), each taking the best eligible player. A position spot with
 * no eligible player stays empty rather than taking someone out of position. UTIL spots then
 * take the best remaining players, and interchange spots after that.
 */
export function autoFillLineup({
  assignments,
  spots,
  players,
}: {
  assignments: readonly AutoFillAssignment[];
  spots: readonly AutoFillSpot[];
  players: readonly AutoFillPlayer[];
}): AutoFillAssignment[] {
  const next = [...assignments];
  const used = new Set(next.map((assignment) => assignment.playerId));
  const pool = players
    .filter((player) => player.available && !used.has(player.playerId))
    .sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId));
  const empty = spots.filter((spot) => !next.some((assignment) => sameSpot(assignment, spot)));

  const place = (spot: AutoFillSpot, index: number) => {
    const [player] = pool.splice(index, 1);
    next.push({ playerId: player.playerId, slot: spot.slot, slotIndex: spot.slotIndex });
  };

  const positionSpots = empty.filter((spot) => isPositionSlot(spot.slot));
  while (positionSpots.length > 0) {
    let bestSpotIndex = -1;
    let fewestCandidates = Number.POSITIVE_INFINITY;
    positionSpots.forEach((spot, index) => {
      const candidates = pool.filter((player) => positionSuitsSlot(player.position, spot.slot));
      if (candidates.length < fewestCandidates) {
        fewestCandidates = candidates.length;
        bestSpotIndex = index;
      }
    });
    const [spot] = positionSpots.splice(bestSpotIndex, 1);
    if (fewestCandidates === 0) continue;
    place(
      spot,
      pool.findIndex((player) => positionSuitsSlot(player.position, spot.slot))
    );
  }

  for (const slot of ['UTIL', 'INTERCHANGE'] as const) {
    for (const spot of empty.filter((entry) => entry.slot === slot)) {
      if (pool.length === 0) break;
      place(spot, 0);
    }
  }
  return next;
}

/**
 * The lineup a team gets when its manager has not saved one for the round: their previous
 * lineup (keeping players still in the squad and in a valid position), with any gaps filled.
 * Without a previous lineup, the whole team is picked by position.
 */
export function buildDefaultLineup({
  spots,
  players,
  previous,
}: {
  spots: readonly AutoFillSpot[];
  players: readonly AutoFillPlayer[];
  previous?: readonly AutoFillAssignment[] | null;
}): { assignments: AutoFillAssignment[]; source: 'CARRIED' | 'AUTO' } {
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const kept: AutoFillAssignment[] = [];
  for (const assignment of previous ?? []) {
    const player = byId.get(assignment.playerId);
    if (!player) continue;
    if (!spots.some((spot) => sameSpot(spot, assignment))) continue;
    if (!positionSuitsSlot(player.position, assignment.slot)) continue;
    if (kept.some((entry) => entry.playerId === assignment.playerId || sameSpot(entry, assignment)))
      continue;
    kept.push({
      playerId: assignment.playerId,
      slot: assignment.slot,
      slotIndex: assignment.slotIndex,
    });
  }
  return {
    assignments: autoFillLineup({ assignments: kept, spots, players }),
    source: kept.length > 0 ? 'CARRIED' : 'AUTO',
  };
}

export interface StatColumnLike {
  key: string;
  direction?: string;
}

/**
 * Ranks players by season per-game averages across the league's categories. Each category is
 * scaled by its average across these players so categories count equally; categories where
 * lower wins count against. Players with few games are discounted.
 */
export function scorePlayersByStats(
  columns: readonly StatColumnLike[],
  playersById: Readonly<
    Record<string, { gamesPlayed?: number; values: Partial<Record<string, number | null>> }>
  >
): Map<string, number> {
  const means = new Map<string, number>();
  for (const column of columns) {
    const values = Object.values(playersById)
      .map((line) => line.values[column.key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    if (mean > 0) means.set(column.key, mean);
  }
  const scores = new Map<string, number>();
  for (const [playerId, line] of Object.entries(playersById)) {
    let score = 0;
    for (const column of columns) {
      const mean = means.get(column.key);
      const value = line.values[column.key];
      if (!mean || typeof value !== 'number' || !Number.isFinite(value)) continue;
      score += (column.direction === 'LOW_WINS' ? -1 : 1) * (value / mean);
    }
    const games = line.gamesPlayed ?? 0;
    scores.set(playerId, score * Math.min(1, games / 5));
  }
  return scores;
}
