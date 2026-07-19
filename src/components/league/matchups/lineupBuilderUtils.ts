import type { LineupSlotSettings } from '@/server/leagues/scoringTypes';

import {
  DEFAULT_LINEUP_BUILDER_SLOTS,
  LINEUP_BUILDER_SLOT_ORDER,
  type LineupAssignment,
  type LineupFieldSpot,
  type LineupRosterPlayer,
} from './lineupBuilderTypes';

export function normalizeLineupBuilderSlots(input: unknown): LineupSlotSettings {
  if (!input || typeof input !== 'object') return DEFAULT_LINEUP_BUILDER_SLOTS;

  const source = input as Partial<Record<keyof LineupSlotSettings, unknown>>;
  const normalized: LineupSlotSettings = { ...DEFAULT_LINEUP_BUILDER_SLOTS };
  let hasValidValue = false;

  for (const slot of LINEUP_BUILDER_SLOT_ORDER) {
    const value = source[slot];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      normalized[slot] = value;
      hasValidValue = true;
    }
  }

  return hasValidValue ? normalized : DEFAULT_LINEUP_BUILDER_SLOTS;
}

export function buildLineupFieldSpots(lineupSlots: LineupSlotSettings): LineupFieldSpot[] {
  return LINEUP_BUILDER_SLOT_ORDER.flatMap((slot) =>
    Array.from({ length: lineupSlots[slot] }, (_, index) => ({
      id: `${slot}:${index}`,
      slot,
      slotIndex: index,
      label: `${slot} ${index + 1}`,
    }))
  );
}

export function buildInterchangeSpots(interchangeSlots: number): LineupFieldSpot[] {
  return Array.from({ length: Math.max(0, interchangeSlots) }, (_, index) => ({
    id: `INTERCHANGE:${index}`,
    slot: 'INTERCHANGE',
    slotIndex: index,
    label: `Interchange ${index + 1}`,
  }));
}

export function getAssignedPlayerIds(assignments: readonly LineupAssignment[]): Set<string> {
  return new Set(assignments.map((assignment) => assignment.playerId));
}

export function getAvailableRosterPlayers(
  rosterPlayers: readonly LineupRosterPlayer[],
  assignments: readonly LineupAssignment[]
): LineupRosterPlayer[] {
  const assignedPlayerIds = getAssignedPlayerIds(assignments);
  return rosterPlayers.filter((player) => !assignedPlayerIds.has(player.playerId));
}

export function getAssignmentForSpot(
  assignments: readonly LineupAssignment[],
  spot: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment | undefined {
  return assignments.find(
    (assignment) => assignment.slot === spot.slot && assignment.slotIndex === spot.slotIndex
  );
}

export function assignPlayerToSpot(
  assignments: readonly LineupAssignment[],
  playerId: string,
  spot: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment[] {
  return assignments
    .filter(
      (assignment) =>
        assignment.playerId !== playerId &&
        (assignment.slot !== spot.slot || assignment.slotIndex !== spot.slotIndex)
    )
    .concat({
      playerId,
      slot: spot.slot,
      slotIndex: spot.slotIndex,
    });
}

export function removeAssignmentFromSpot(
  assignments: readonly LineupAssignment[],
  spot: Pick<LineupFieldSpot, 'slot' | 'slotIndex'>
): LineupAssignment[] {
  return assignments.filter(
    (assignment) => assignment.slot !== spot.slot || assignment.slotIndex !== spot.slotIndex
  );
}

export function findRosterPlayer(
  rosterPlayers: readonly LineupRosterPlayer[],
  playerId: string | null | undefined
): LineupRosterPlayer | undefined {
  if (!playerId) return undefined;
  return rosterPlayers.find((player) => player.playerId === playerId);
}
