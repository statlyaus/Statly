import {
  activeAflTradeEdgesBySource,
  activeAflTradeTerminalAssetIds,
  duplicateAflTradeValues,
  isAflTradeKnownAt,
  parseAflTradeTime,
} from './lineageTemporal';
import {
  isAflTradeValueBearingAssetType,
  type AflTradeAssetCustodySpell,
  type AflTradeAssetDisposition,
  type AflTradeAttributionIssue,
  type AflTradeAttributionIssueCode,
  type AflTradeAttributionRequest,
  type AflTradeAttributionValidation,
  type AflTradeLineageEdge,
  type AflTradeLineageGraph,
  type AflTradeTemporalCutoff,
} from './lineageTypes';

export function findAflTradeAssetCustodian(
  custodySpells: readonly AflTradeAssetCustodySpell[],
  assetId: string,
  cutoff: AflTradeTemporalCutoff
): string | null {
  const effectiveAt = parseAflTradeTime(cutoff.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(cutoff.knowledgeCutoffAt);
  if (effectiveAt === null || knowledgeCutoff === null) return null;

  const active = custodySpells.filter((spell) => {
    if (spell.assetId !== assetId) return false;
    const from = parseAflTradeTime(spell.effectiveFrom);
    const to =
      spell.effectiveTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(spell.effectiveTo);
    return (
      from !== null &&
      to !== null &&
      from <= effectiveAt &&
      effectiveAt < to &&
      isAflTradeKnownAt(spell, knowledgeCutoff)
    );
  });

  return active.length === 1 ? active[0].aflClubId : null;
}

export function buildAflTradeAttributionFrontier(
  rootAssetIds: readonly string[],
  edges: readonly AflTradeLineageEdge[],
  cutoff: AflTradeTemporalCutoff,
  dispositions: readonly AflTradeAssetDisposition[] = []
): string[] {
  const outgoing = activeAflTradeEdgesBySource(edges, cutoff);
  const terminalAssetIds = activeAflTradeTerminalAssetIds(dispositions, cutoff);
  const frontier = new Set<string>();

  const visit = (assetId: string, path: ReadonlySet<string>) => {
    if (path.has(assetId) || terminalAssetIds.has(assetId)) return;
    const successors = outgoing.get(assetId) ?? [];
    if (successors.length === 0) {
      frontier.add(assetId);
      return;
    }
    const nextPath = new Set(path).add(assetId);
    for (const edge of successors) visit(edge.targetAssetId, nextPath);
  };

  for (const rootAssetId of rootAssetIds) visit(rootAssetId, new Set());
  return [...frontier].sort();
}

function hasPath(
  sourceAssetId: string,
  targetAssetId: string,
  outgoing: ReadonlyMap<string, readonly AflTradeLineageEdge[]>,
  visited = new Set<string>()
): boolean {
  if (sourceAssetId === targetAssetId) return true;
  if (visited.has(sourceAssetId)) return false;
  const nextVisited = new Set(visited).add(sourceAssetId);
  return (outgoing.get(sourceAssetId) ?? []).some((edge) =>
    hasPath(edge.targetAssetId, targetAssetId, outgoing, nextVisited)
  );
}

export function validateAflTradeAttribution(
  graph: AflTradeLineageGraph,
  request: AflTradeAttributionRequest
): AflTradeAttributionValidation {
  const issues: AflTradeAttributionIssue[] = [];
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const excludedAssetIds = request.excludedAssetIds ?? [];

  const duplicateGroups: ReadonlyArray<{
    values: readonly string[];
    code: AflTradeAttributionIssueCode;
    label: string;
  }> = [
    { values: request.rootAssetIds, code: 'duplicate_root', label: 'Root asset' },
    { values: request.creditedAssetIds, code: 'duplicate_credit', label: 'Credited asset' },
    { values: excludedAssetIds, code: 'duplicate_exclusion', label: 'Excluded asset' },
  ];
  for (const group of duplicateGroups) {
    for (const assetId of duplicateAflTradeValues(group.values)) {
      issues.push({
        code: group.code,
        assetId,
        message: `${group.label} ${assetId} is duplicated.`,
      });
    }
  }

  const identityGroups: ReadonlyArray<{
    values: readonly string[];
    code: AflTradeAttributionIssueCode;
    label: string;
  }> = [
    { values: request.rootAssetIds, code: 'unknown_root', label: 'Root asset' },
    { values: request.creditedAssetIds, code: 'unknown_credit', label: 'Credited asset' },
    { values: excludedAssetIds, code: 'unknown_exclusion', label: 'Excluded asset' },
  ];
  for (const group of identityGroups) {
    for (const assetId of group.values) {
      if (!assetById.has(assetId)) {
        issues.push({
          code: group.code,
          assetId,
          message: `${group.label} ${assetId} does not exist.`,
        });
      }
    }
  }

  const credited = new Set(request.creditedAssetIds.filter((assetId) => assetById.has(assetId)));
  const excluded = new Set(excludedAssetIds.filter((assetId) => assetById.has(assetId)));
  for (const assetId of credited) {
    if (excluded.has(assetId)) {
      issues.push({
        code: 'asset_both_credited_and_excluded',
        assetId,
        message: `Asset ${assetId} cannot be both credited and excluded.`,
      });
    }
    const asset = assetById.get(assetId);
    if (asset && !isAflTradeValueBearingAssetType(asset.assetType)) {
      issues.push({
        code: 'non_value_bearing_credit',
        assetId,
        message: `Asset ${assetId} is ${asset.assetType} and cannot carry numerical credit.`,
      });
    }
  }

  const activeEdgesMap = activeAflTradeEdgesBySource(graph.edges, request);
  const activeEdges = [...activeEdgesMap.values()].flat();
  for (const ancestor of credited) {
    for (const descendant of credited) {
      if (ancestor !== descendant && hasPath(ancestor, descendant, activeEdgesMap)) {
        issues.push({
          code: 'ancestor_double_counted',
          assetId: ancestor,
          message: `Asset ${ancestor} is credited with its successor ${descendant}.`,
        });
      }
    }
  }

  const expectedFrontierAssetIds = buildAflTradeAttributionFrontier(
    request.rootAssetIds.filter((assetId) => assetById.has(assetId)),
    activeEdges,
    request,
    graph.dispositions
  );
  const expected = new Set(expectedFrontierAssetIds);
  const accounted = new Set([...credited, ...excluded]);
  for (const assetId of expected) {
    if (!accounted.has(assetId)) {
      issues.push({
        code: 'missing_frontier_asset',
        assetId,
        message: `Terminal frontier asset ${assetId} is neither credited nor explicitly excluded.`,
      });
    }
  }
  for (const assetId of accounted) {
    if (!expected.has(assetId)) {
      issues.push({
        code: 'unexpected_frontier_asset',
        assetId,
        message: `Asset ${assetId} is not on the attribution frontier.`,
      });
    }
  }

  return { valid: issues.length === 0, expectedFrontierAssetIds, issues };
}
