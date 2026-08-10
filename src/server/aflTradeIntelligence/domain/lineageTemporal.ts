import { z } from 'zod';

import type {
  AflTradeAssetDisposition,
  AflTradeLineageEdge,
  AflTradeTemporalCutoff,
} from './lineageTypes';

export function parseAflTradeTime(value: string): number | null {
  const validFormat =
    z.iso.date().safeParse(value).success ||
    z.iso.datetime({ offset: true }).safeParse(value).success;
  if (!validFormat) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAflTradeKnownAt(
  record: { knownFrom: string; knownTo: string | null },
  knowledgeCutoff: number
): boolean {
  const from = parseAflTradeTime(record.knownFrom);
  const to = record.knownTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(record.knownTo);
  return from !== null && to !== null && from <= knowledgeCutoff && knowledgeCutoff < to;
}

export function aflTradeKnowledgeIntervalsOverlap(
  left: { knownFrom: string; knownTo: string | null },
  right: { knownFrom: string; knownTo: string | null }
): boolean {
  const leftFrom = parseAflTradeTime(left.knownFrom);
  const leftTo = left.knownTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(left.knownTo);
  const rightFrom = parseAflTradeTime(right.knownFrom);
  const rightTo =
    right.knownTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(right.knownTo);
  return (
    leftFrom !== null &&
    leftTo !== null &&
    rightFrom !== null &&
    rightTo !== null &&
    leftFrom < rightTo &&
    rightFrom < leftTo
  );
}

export function duplicateAflTradeValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function activeAflTradeEdgesBySource(
  edges: readonly AflTradeLineageEdge[],
  cutoff: AflTradeTemporalCutoff
): Map<string, AflTradeLineageEdge[]> {
  const result = new Map<string, AflTradeLineageEdge[]>();
  const effectiveAsOf = parseAflTradeTime(cutoff.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(cutoff.knowledgeCutoffAt);
  if (effectiveAsOf === null || knowledgeCutoff === null) return result;

  for (const edge of edges) {
    const effectiveAt = parseAflTradeTime(edge.effectiveAt);
    if (
      effectiveAt === null ||
      effectiveAt > effectiveAsOf ||
      !isAflTradeKnownAt(edge, knowledgeCutoff)
    ) {
      continue;
    }
    const outgoing = result.get(edge.sourceAssetId) ?? [];
    outgoing.push(edge);
    result.set(edge.sourceAssetId, outgoing);
  }
  return result;
}

export function activeAflTradeTerminalAssetIds(
  dispositions: readonly AflTradeAssetDisposition[],
  cutoff: AflTradeTemporalCutoff
): ReadonlySet<string> {
  const effectiveAsOf = parseAflTradeTime(cutoff.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(cutoff.knowledgeCutoffAt);
  if (effectiveAsOf === null || knowledgeCutoff === null) return new Set();

  return new Set(
    dispositions
      .filter((disposition) => {
        const effectiveAt = parseAflTradeTime(disposition.effectiveAt);
        return (
          effectiveAt !== null &&
          effectiveAt <= effectiveAsOf &&
          isAflTradeKnownAt(disposition, knowledgeCutoff)
        );
      })
      .map((disposition) => disposition.assetId)
  );
}
