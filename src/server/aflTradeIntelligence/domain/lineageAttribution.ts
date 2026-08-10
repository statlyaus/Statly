import {
  activeAflTradeEdgesBySource,
  activeAflTradeTerminalAssetIds,
  duplicateAflTradeValues,
  isAflTradeKnownAt,
  parseAflTradeTime,
} from './lineageTemporal';
import {
  isAflTradeValueBearingAssetType,
  type AflTradeAsset,
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
  const visiting = new Set<string>();
  const completed = new Set<string>();

  const visit = (assetId: string) => {
    if (visiting.has(assetId) || completed.has(assetId) || terminalAssetIds.has(assetId)) return;
    visiting.add(assetId);
    const successors = outgoing.get(assetId) ?? [];
    if (successors.length === 0) {
      frontier.add(assetId);
    } else {
      for (const edge of successors) visit(edge.targetAssetId);
    }
    visiting.delete(assetId);
    completed.add(assetId);
  };

  for (const rootAssetId of rootAssetIds) visit(rootAssetId);
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
  visited.add(sourceAssetId);
  return (outgoing.get(sourceAssetId) ?? []).some((edge) =>
    hasPath(edge.targetAssetId, targetAssetId, outgoing, visited)
  );
}

function collectAttributionDuplicateIssues(
  request: AflTradeAttributionRequest,
  excludedAssetIds: readonly string[]
): AflTradeAttributionIssue[] {
  const issues: AflTradeAttributionIssue[] = [];
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
  return issues;
}

function selectVisibleAttributionRoots(
  request: AflTradeAttributionRequest,
  assetById: ReadonlyMap<string, AflTradeAsset>,
  effectiveAsOf: number | null,
  knowledgeCutoff: number | null
): { assetIds: string[]; issues: AflTradeAttributionIssue[] } {
  const issues: AflTradeAttributionIssue[] = [];
  const assetIds = request.rootAssetIds.filter((assetId) => {
    const asset = assetById.get(assetId);
    if (!asset) return false;
    const effectiveFrom = parseAflTradeTime(asset.effectiveFrom);
    const visible =
      effectiveAsOf !== null &&
      knowledgeCutoff !== null &&
      effectiveFrom !== null &&
      effectiveFrom <= effectiveAsOf &&
      isAflTradeKnownAt(asset, knowledgeCutoff);
    if (!visible) {
      issues.push({
        code: 'root_not_visible',
        assetId,
        message: `Root asset ${assetId} was not effective and knowable at the attribution cutoff.`,
      });
    }
    return visible;
  });
  return { assetIds, issues };
}

function collectAttributionIdentityIssues(
  request: AflTradeAttributionRequest,
  excludedAssetIds: readonly string[],
  assetById: ReadonlyMap<string, AflTradeAsset>
): AflTradeAttributionIssue[] {
  const issues: AflTradeAttributionIssue[] = [];
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
  return issues;
}

function collectCreditEligibilityIssues(
  credited: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  assetById: ReadonlyMap<string, AflTradeAsset>
): AflTradeAttributionIssue[] {
  const issues: AflTradeAttributionIssue[] = [];
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
  return issues;
}

function collectAncestorCreditIssues(
  credited: ReadonlySet<string>,
  activeEdgesMap: ReadonlyMap<string, readonly AflTradeLineageEdge[]>
): AflTradeAttributionIssue[] {
  const issues: AflTradeAttributionIssue[] = [];
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
  return issues;
}

function collectFrontierAccountingIssues(
  expectedFrontierAssetIds: readonly string[],
  credited: ReadonlySet<string>,
  excluded: ReadonlySet<string>
): AflTradeAttributionIssue[] {
  const issues: AflTradeAttributionIssue[] = [];
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
  return issues;
}

export function validateAflTradeAttribution(
  graph: AflTradeLineageGraph,
  request: AflTradeAttributionRequest
): AflTradeAttributionValidation {
  const issues: AflTradeAttributionIssue[] = [];
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const excludedAssetIds = request.excludedAssetIds ?? [];
  const effectiveAsOf = parseAflTradeTime(request.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(request.knowledgeCutoffAt);
  issues.push(...collectAttributionDuplicateIssues(request, excludedAssetIds));
  const visibleRoots = selectVisibleAttributionRoots(
    request,
    assetById,
    effectiveAsOf,
    knowledgeCutoff
  );
  issues.push(...visibleRoots.issues);
  issues.push(...collectAttributionIdentityIssues(request, excludedAssetIds, assetById));

  const credited = new Set(request.creditedAssetIds.filter((assetId) => assetById.has(assetId)));
  const excluded = new Set(excludedAssetIds.filter((assetId) => assetById.has(assetId)));
  issues.push(...collectCreditEligibilityIssues(credited, excluded, assetById));

  const activeEdgesMap = activeAflTradeEdgesBySource(graph.edges, request);
  const activeEdges = [...activeEdgesMap.values()].flat();
  issues.push(...collectAncestorCreditIssues(credited, activeEdgesMap));

  const expectedFrontierAssetIds = buildAflTradeAttributionFrontier(
    visibleRoots.assetIds,
    activeEdges,
    request,
    graph.dispositions
  );
  issues.push(...collectFrontierAccountingIssues(expectedFrontierAssetIds, credited, excluded));

  return { valid: issues.length === 0, expectedFrontierAssetIds, issues };
}
