export interface RosterCapacitySettings {
  rosterSize: number;
  benchSize: number;
}

export interface RosterExchangeCapacityInput {
  currentCount: number;
  outgoingCount: number;
  incomingCount: number;
  capacity: number;
}

export interface RosterExchangeCapacityResult {
  currentCount: number;
  nextCount: number;
  capacity: number;
  isAllowed: boolean;
}

function toNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getLeagueRosterCapacity(settings: RosterCapacitySettings): number {
  return toNonNegativeInteger(settings.rosterSize) + toNonNegativeInteger(settings.benchSize);
}

export function evaluateRosterExchangeCapacity(
  input: RosterExchangeCapacityInput
): RosterExchangeCapacityResult {
  const currentCount = toNonNegativeInteger(input.currentCount);
  const outgoingCount = toNonNegativeInteger(input.outgoingCount);
  const incomingCount = toNonNegativeInteger(input.incomingCount);
  const capacity = toNonNegativeInteger(input.capacity);
  const nextCount = currentCount - outgoingCount + incomingCount;

  return {
    currentCount,
    nextCount,
    capacity,
    isAllowed:
      nextCount >= 0 &&
      (nextCount <= capacity || (currentCount > capacity && nextCount <= currentCount)),
  };
}
