import { positionSuitsSlot } from '@/lib/leagues/lineupAutoFill';
import type { LeagueLineupSlot, LineupSlotSettings } from '@/server/leagues/scoringTypes';

import type { LineupAssignment, LineupFieldSpot } from '../matchups/lineupBuilderTypes';

export { positionSuitsSlot };

/** On-field groups in the order a team sheet reads: back line to forward line, then utility. */
export const MY_TEAM_SLOT_ORDER = ['DEF', 'MID', 'RUC', 'FWD', 'UTIL'] as const;

export const SLOT_GROUP_NAMES: Record<LeagueLineupSlot, string> = {
  DEF: 'Defence',
  MID: 'Midfield',
  RUC: 'Ruck',
  FWD: 'Forward',
  UTIL: 'Utility',
  INTERCHANGE: 'Interchange',
  BENCH: 'Bench',
};

export interface MyTeamSquadPlayer {
  playerId: string;
  name: string;
  position: string | null;
  club: string | null;
  gameStartsAt: string | null;
}

export function buildMyTeamSpots(
  lineupSlots: LineupSlotSettings,
  interchangeSlots: number
): LineupFieldSpot[] {
  const field = MY_TEAM_SLOT_ORDER.flatMap((slot) =>
    Array.from({ length: Math.max(0, lineupSlots[slot] ?? 0) }, (_, index) => ({
      id: `${slot}:${index}`,
      slot,
      slotIndex: index,
      label: `${slot} ${index + 1}`,
    }))
  );
  const interchange = Array.from({ length: Math.max(0, interchangeSlots) }, (_, index) => ({
    id: `INTERCHANGE:${index}`,
    slot: 'INTERCHANGE' as const,
    slotIndex: index,
    label: `INT ${index + 1}`,
  }));
  return [...field, ...interchange];
}

export function findAssignment(
  assignments: readonly LineupAssignment[],
  spot: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment | undefined {
  return assignments.find(
    (assignment) => assignment.slot === spot.slot && assignment.slotIndex === spot.slotIndex
  );
}

/**
 * Puts `playerId` into `target`. If the target is occupied and the player came from another
 * spot, the two swap; if the player came from the squad, the occupant goes back to the squad.
 */
export function placePlayer(
  assignments: readonly LineupAssignment[],
  playerId: string,
  target: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment[] {
  const source = assignments.find((assignment) => assignment.playerId === playerId);
  const occupant = findAssignment(assignments, target);
  if (occupant?.playerId === playerId) return [...assignments];

  const next = assignments.filter(
    (assignment) => assignment.playerId !== playerId && assignment !== occupant
  );
  next.push({ playerId, slot: target.slot, slotIndex: target.slotIndex });
  if (occupant && source) {
    next.push({ playerId: occupant.playerId, slot: source.slot, slotIndex: source.slotIndex });
  }
  return next;
}

/**
 * True when `placePlayer` would leave everyone in a position they can play: the moving player
 * suits the target, and on a swap the occupant suits the spot the moving player leaves.
 */
export function canPlacePlayer(
  assignments: readonly LineupAssignment[],
  playerId: string,
  target: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>,
  positionOf: (playerId: string) => string | null | undefined
): boolean {
  if (!positionSuitsSlot(positionOf(playerId), target.slot)) return false;
  const source = assignments.find((assignment) => assignment.playerId === playerId);
  const occupant = findAssignment(assignments, target);
  if (occupant && source && occupant.playerId !== playerId) {
    return positionSuitsSlot(positionOf(occupant.playerId), source.slot);
  }
  return true;
}

export function removeFromSpot(
  assignments: readonly LineupAssignment[],
  spot: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment[] {
  return assignments.filter(
    (assignment) => assignment.slot !== spot.slot || assignment.slotIndex !== spot.slotIndex
  );
}

export function hasGameStarted(player: Pick<MyTeamSquadPlayer, 'gameStartsAt'>, now: Date) {
  return Boolean(player.gameStartsAt && new Date(player.gameStartsAt).getTime() <= now.getTime());
}

/** Spots whose player differs between two lineups (the changes waiting to be confirmed). */
export function countLineupChanges(
  before: readonly LineupAssignment[],
  after: readonly LineupAssignment[]
): number {
  const key = (assignment: Pick<LineupAssignment, 'slot' | 'slotIndex'>) =>
    `${assignment.slot}:${assignment.slotIndex}`;
  const beforeBySpot = new Map(before.map((assignment) => [key(assignment), assignment.playerId]));
  const afterBySpot = new Map(after.map((assignment) => [key(assignment), assignment.playerId]));
  let changes = 0;
  for (const spot of new Set([...beforeBySpot.keys(), ...afterBySpot.keys()])) {
    if (beforeBySpot.get(spot) !== afterBySpot.get(spot)) changes += 1;
  }
  return changes;
}

export function summarizeLineup(
  assignments: readonly LineupAssignment[],
  spots: readonly LineupFieldSpot[]
) {
  const fieldSpots = spots.filter((spot) => spot.slot !== 'INTERCHANGE');
  const interchangeSpots = spots.filter((spot) => spot.slot === 'INTERCHANGE');
  const onField = fieldSpots.filter((spot) => findAssignment(assignments, spot)).length;
  const interchange = interchangeSpots.filter((spot) => findAssignment(assignments, spot)).length;
  return {
    onField,
    fieldSpots: fieldSpots.length,
    interchange,
    interchangeSpots: interchangeSpots.length,
    emptyField: fieldSpots.length - onField,
    emptyInterchange: interchangeSpots.length - interchange,
  };
}
