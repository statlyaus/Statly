export const AUTOSUB_ACTIVE_SLOT_ORDER = ['DEF', 'MID', 'RUC', 'FWD', 'UTIL'] as const;

export type AutosubActiveSlot = (typeof AUTOSUB_ACTIVE_SLOT_ORDER)[number];
export type AutosubReason = 'CONFIRMED_DID_NOT_PLAY';

export interface AutosubActiveAssignment {
  playerId: string;
  slot: AutosubActiveSlot;
  slotIndex: number;
}

export interface AutosubInterchangeAssignment {
  playerId: string;
  slot: 'INTERCHANGE';
  slotIndex: number;
}

export interface ResolveAutosubsInput {
  activeAssignments: readonly AutosubActiveAssignment[];
  interchangeAssignments: readonly AutosubInterchangeAssignment[];
  confirmedDidNotPlayPlayerIds: readonly string[];
}

export interface AutosubDecision {
  outgoingPlayerId: string;
  originalSlot: AutosubActiveSlot;
  originalSlotIndex: number;
  replacementPlayerId: string;
  reason: AutosubReason;
  interchangeIndex: number;
}

export interface AutosubResolution {
  activeAssignments: AutosubActiveAssignment[];
  interchangeAssignments: AutosubInterchangeAssignment[];
  decisions: AutosubDecision[];
}

const ACTIVE_SLOT_PRIORITY = new Map<AutosubActiveSlot, number>(
  AUTOSUB_ACTIVE_SLOT_ORDER.map((slot, index) => [slot, index])
);

function compareActiveAssignments(
  left: AutosubActiveAssignment,
  right: AutosubActiveAssignment
): number {
  return (
    ACTIVE_SLOT_PRIORITY.get(left.slot)! - ACTIVE_SLOT_PRIORITY.get(right.slot)! ||
    left.slotIndex - right.slotIndex
  );
}

function compareInterchangeAssignments(
  left: AutosubInterchangeAssignment,
  right: AutosubInterchangeAssignment
): number {
  return left.slotIndex - right.slotIndex;
}

function assertValidPlayerId(playerId: string): void {
  if (playerId.trim() === '') {
    throw new Error('Autosub assignments require a non-empty playerId.');
  }
}

function assertValidSlotIndex(slotIndex: number): void {
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) {
    throw new Error('Autosub assignment slotIndex must be a non-negative safe integer.');
  }
}

function validateAssignments(input: ResolveAutosubsInput): void {
  const playerIds = new Set<string>();
  const occupiedSlots = new Set<string>();

  for (const assignment of input.activeAssignments) {
    assertValidPlayerId(assignment.playerId);
    assertValidSlotIndex(assignment.slotIndex);

    if (!ACTIVE_SLOT_PRIORITY.has(assignment.slot)) {
      throw new Error(`Unsupported active autosub slot: ${String(assignment.slot)}.`);
    }

    const slotKey = `${assignment.slot}:${assignment.slotIndex}`;
    if (occupiedSlots.has(slotKey)) {
      throw new Error(`Duplicate autosub assignment slot: ${slotKey}.`);
    }
    if (playerIds.has(assignment.playerId)) {
      throw new Error(`Duplicate autosub player assignment: ${assignment.playerId}.`);
    }

    occupiedSlots.add(slotKey);
    playerIds.add(assignment.playerId);
  }

  for (const assignment of input.interchangeAssignments) {
    assertValidPlayerId(assignment.playerId);
    assertValidSlotIndex(assignment.slotIndex);

    if (assignment.slot !== 'INTERCHANGE') {
      throw new Error(`Unsupported interchange autosub slot: ${String(assignment.slot)}.`);
    }

    const slotKey = `INTERCHANGE:${assignment.slotIndex}`;
    if (occupiedSlots.has(slotKey)) {
      throw new Error(`Duplicate autosub assignment slot: ${slotKey}.`);
    }
    if (playerIds.has(assignment.playerId)) {
      throw new Error(`Duplicate autosub player assignment: ${assignment.playerId}.`);
    }

    occupiedSlots.add(slotKey);
    playerIds.add(assignment.playerId);
  }
}

export function resolveAutosubs(input: ResolveAutosubsInput): AutosubResolution {
  validateAssignments(input);

  const confirmedDidNotPlay = new Set(input.confirmedDidNotPlayPlayerIds);
  const activeAssignments = input.activeAssignments
    .map((assignment) => ({ ...assignment }))
    .sort(compareActiveAssignments);
  const interchangeAssignments = input.interchangeAssignments
    .map((assignment) => ({ ...assignment }))
    .sort(compareInterchangeAssignments);
  const availableReplacements = interchangeAssignments.filter(
    (assignment) => !confirmedDidNotPlay.has(assignment.playerId)
  );
  const decisions: AutosubDecision[] = [];

  for (const activeAssignment of activeAssignments) {
    if (!confirmedDidNotPlay.has(activeAssignment.playerId)) continue;

    const replacement = availableReplacements.shift();
    if (!replacement) break;

    const outgoingPlayerId = activeAssignment.playerId;
    activeAssignment.playerId = replacement.playerId;
    replacement.playerId = outgoingPlayerId;

    decisions.push({
      outgoingPlayerId,
      originalSlot: activeAssignment.slot,
      originalSlotIndex: activeAssignment.slotIndex,
      replacementPlayerId: activeAssignment.playerId,
      reason: 'CONFIRMED_DID_NOT_PLAY',
      interchangeIndex: replacement.slotIndex,
    });
  }

  return {
    activeAssignments,
    interchangeAssignments,
    decisions,
  };
}
