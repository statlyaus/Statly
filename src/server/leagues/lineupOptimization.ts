import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { ActiveLineupSlot, CategoryDirection, LeagueLineupSlot, LineupSlotSettings } from './scoringTypes';

/**
 * Deterministic lineup assignment for a member's roster.
 *
 * The module owns *assignment*, not valuation: the caller supplies each candidate's projected
 * contribution because the optimising objective depends on the league's categories and scoring
 * mode. Given that value, slot types are interchangeable at the scoring boundary
 * (`matchupScoringEngine` only excludes `BENCH` and `INTERCHANGE`), so filling the contestable
 * active slots with the highest-value unlocked players is optimal. Locked players are pinned in
 * place and their slot is not contested.
 */

export const ACTIVE_SLOT_FILL_ORDER = [
  'FWD',
  'DEF',
  'MID',
  'RUC',
  'UTIL',
] as const satisfies readonly ActiveLineupSlot[];

const NON_SCORING_SLOTS = new Set<LeagueLineupSlot>(['INTERCHANGE', 'BENCH']);
const SUPPORTED_SLOTS = new Set<LeagueLineupSlot>([
  ...ACTIVE_SLOT_FILL_ORDER,
  'INTERCHANGE',
  'BENCH',
]);

export interface LineupOptimizationCandidate {
  playerId: string;
  /** Projected contribution supplied by the caller. Higher is better. */
  value: number;
  isLocked: boolean;
  /** Required when `isLocked`: the slot the player must keep. */
  lockedSlot?: LeagueLineupSlot;
  /** Required when `isLocked`: the slot index the player must keep. */
  lockedSlotIndex?: number;
  /** Current assignment, used to report what actually moved. */
  previousSlot?: LeagueLineupSlot;
  previousSlotIndex?: number;
}

export interface LineupOptimizationAssignment {
  playerId: string;
  slot: LeagueLineupSlot;
  slotIndex: number;
}

export interface LineupOptimizationResult {
  assignments: LineupOptimizationAssignment[];
  promotedPlayerIds: string[];
  demotedPlayerIds: string[];
  unchangedPlayerIds: string[];
  activeProjectedValue: number;
}

export interface OptimizeLineupAssignmentInput {
  candidates: readonly LineupOptimizationCandidate[];
  lineupSlots: LineupSlotSettings;
  interchangeSlots: number;
}

function readSlotCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assertCandidates(candidates: readonly LineupOptimizationCandidate[]): void {
  const seenPlayerIds = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.playerId.trim() === '') {
      throw new Error('Lineup optimisation requires a non-empty playerId.');
    }
    if (seenPlayerIds.has(candidate.playerId)) {
      throw new Error(`Duplicate lineup optimisation candidate: ${candidate.playerId}.`);
    }
    seenPlayerIds.add(candidate.playerId);

    if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) {
      throw new Error(
        `Lineup optimisation candidate ${candidate.playerId} requires a finite value.`
      );
    }

    if (!candidate.isLocked) continue;

    if (!candidate.lockedSlot || !SUPPORTED_SLOTS.has(candidate.lockedSlot)) {
      throw new Error(
        `Locked lineup optimisation candidate ${candidate.playerId} requires a supported lockedSlot.`
      );
    }
    if (
      candidate.lockedSlot === 'BENCH' ||
      !Number.isSafeInteger(candidate.lockedSlotIndex) ||
      (candidate.lockedSlotIndex as number) < 0
    ) {
      throw new Error(
        `Locked lineup optimisation candidate ${candidate.playerId} requires a non-negative lockedSlotIndex in an active or interchange slot.`
      );
    }
  }
}

function isScoringSlot(slot: LeagueLineupSlot): boolean {
  return !NON_SCORING_SLOTS.has(slot);
}

/**
 * Scalarises a player's projected per-category line into the objective the optimiser maximises.
 *
 * Direction is honoured because a league can score a category in either direction, so a raw sum
 * would reward a player for losing a `LOW_WINS` category. Missing or non-finite values contribute
 * nothing, matching the scoring boundary's zero-normalisation.
 */
export function calculateLineupContributionValue({
  categories,
  categoryDirections,
  valuesByCategory,
}: {
  categories: readonly FantasyCategoryKey[];
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  valuesByCategory: Partial<Record<FantasyCategoryKey, number | null>>;
}): number {
  return categories.reduce((total, category) => {
    const value = valuesByCategory[category];
    if (typeof value !== 'number' || !Number.isFinite(value)) return total;

    return total + (categoryDirections[category] === 'LOW_WINS' ? -value : value);
  }, 0);
}

export function optimizeLineupAssignment({
  candidates,
  lineupSlots,
  interchangeSlots,
}: OptimizeLineupAssignmentInput): LineupOptimizationResult {
  assertCandidates(candidates);

  const interchangeCapacity = readSlotCount(interchangeSlots);
  const assignments: LineupOptimizationAssignment[] = [];
  const occupiedSlotKeys = new Set<string>();
  const lockedCandidates = candidates.filter((candidate) => candidate.isLocked);
  const unlockedCandidates = candidates.filter((candidate) => !candidate.isLocked);

  for (const candidate of lockedCandidates) {
    const slot = candidate.lockedSlot as LeagueLineupSlot;
    const slotIndex = candidate.lockedSlotIndex as number;
    const slotKey = `${slot}:${slotIndex}`;
    if (occupiedSlotKeys.has(slotKey)) {
      throw new Error(`Locked lineup optimisation candidates share slot ${slotKey}.`);
    }
    occupiedSlotKeys.add(slotKey);
    assignments.push({ playerId: candidate.playerId, slot, slotIndex });
  }

  const contestableActivePositions: Array<{ slot: ActiveLineupSlot; slotIndex: number }> = [];
  for (const slot of ACTIVE_SLOT_FILL_ORDER) {
    for (let slotIndex = 0; slotIndex < readSlotCount(lineupSlots[slot]); slotIndex += 1) {
      if (!occupiedSlotKeys.has(`${slot}:${slotIndex}`)) {
        contestableActivePositions.push({ slot, slotIndex });
      }
    }
  }

  const rankedUnlocked = [...unlockedCandidates].sort(
    (left, right) => right.value - left.value || left.playerId.localeCompare(right.playerId)
  );

  const activeAdditions = rankedUnlocked.slice(0, contestableActivePositions.length);
  activeAdditions.forEach((candidate, index) => {
    assignments.push({ playerId: candidate.playerId, ...contestableActivePositions[index] });
  });

  const remainingUnlocked = rankedUnlocked.slice(activeAdditions.length);
  const lockedInterchangeCount = lockedCandidates.filter(
    (candidate) => candidate.lockedSlot === 'INTERCHANGE'
  ).length;
  const contestableInterchangeIndexes: number[] = [];
  for (let slotIndex = 0; slotIndex < interchangeCapacity - lockedInterchangeCount; slotIndex += 1) {
    if (!occupiedSlotKeys.has(`INTERCHANGE:${slotIndex}`)) {
      contestableInterchangeIndexes.push(slotIndex);
    }
  }

  const interchangeAdditions = remainingUnlocked.slice(0, contestableInterchangeIndexes.length);
  interchangeAdditions.forEach((candidate, index) => {
    assignments.push({
      playerId: candidate.playerId,
      slot: 'INTERCHANGE',
      slotIndex: contestableInterchangeIndexes[index],
    });
  });

  let nextBenchIndex = 0;
  for (const candidate of remainingUnlocked.slice(interchangeAdditions.length)) {
    while (occupiedSlotKeys.has(`BENCH:${nextBenchIndex}`)) nextBenchIndex += 1;
    occupiedSlotKeys.add(`BENCH:${nextBenchIndex}`);
    assignments.push({ playerId: candidate.playerId, slot: 'BENCH', slotIndex: nextBenchIndex });
    nextBenchIndex += 1;
  }

  const candidateByPlayerId = new Map(
    candidates.map((candidate) => [candidate.playerId, candidate])
  );
  const promotedPlayerIds: string[] = [];
  const demotedPlayerIds: string[] = [];
  const unchangedPlayerIds: string[] = [];
  let activeProjectedValue = 0;

  for (const assignment of assignments) {
    const candidate = candidateByPlayerId.get(assignment.playerId) as LineupOptimizationCandidate;
    if (isScoringSlot(assignment.slot)) activeProjectedValue += candidate.value;

    if (
      candidate.previousSlot === assignment.slot &&
      candidate.previousSlotIndex === assignment.slotIndex
    ) {
      unchangedPlayerIds.push(assignment.playerId);
      continue;
    }

    const wasScoring = candidate.previousSlot ? isScoringSlot(candidate.previousSlot) : false;
    if (isScoringSlot(assignment.slot) && !wasScoring) promotedPlayerIds.push(assignment.playerId);
    if (!isScoringSlot(assignment.slot) && wasScoring) demotedPlayerIds.push(assignment.playerId);
  }

  return {
    assignments,
    promotedPlayerIds,
    demotedPlayerIds,
    unchangedPlayerIds,
    activeProjectedValue,
  };
}
