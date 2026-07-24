function containsStringLeaf(value: unknown, playerIds: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return playerIds.has(value);
  if (Array.isArray(value)) return value.some((entry) => containsStringLeaf(entry, playerIds));
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => containsStringLeaf(entry, playerIds));
  }
  return false;
}

export function containsPlayerIdentityReference(
  serializedValue: string | null,
  playerIds: ReadonlySet<string>
): boolean {
  if (!serializedValue || playerIds.size === 0) return false;

  try {
    return containsStringLeaf(JSON.parse(serializedValue) as unknown, playerIds);
  } catch {
    return [...playerIds].some((playerId) => serializedValue.includes(playerId));
  }
}
