export interface RosterPlayerIdDuplicateSummary {
  duplicateCount: number;
  duplicateIds: string[];
  originalCount: number;
  uniqueCount: number;
}

export function normalizeRosterPlayerIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of ids) {
    const id = String(rawId);
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

export function parseRosterPlayerIds(text?: string | null): string[] {
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? normalizeRosterPlayerIds(parsed) : [];
  } catch {
    return [];
  }
}

export function summarizeRosterPlayerIdDuplicates(
  ids: readonly unknown[]
): RosterPlayerIdDuplicateSummary {
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const duplicateSet = new Set<string>();

  for (const rawId of ids) {
    const id = String(rawId);
    if (seen.has(id)) {
      if (!duplicateSet.has(id)) {
        duplicateSet.add(id);
        duplicateIds.push(id);
      }
      continue;
    }
    seen.add(id);
  }

  return {
    duplicateCount: ids.length - seen.size,
    duplicateIds,
    originalCount: ids.length,
    uniqueCount: seen.size,
  };
}
