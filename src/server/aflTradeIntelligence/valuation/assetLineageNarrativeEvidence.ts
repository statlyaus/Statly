import { buildAflTradeAttributionFrontier } from '../domain/lineageAttribution';
import {
  activeAflTradeEdgesBySource,
  isAflTradeKnownAt,
  parseAflTradeTime,
} from '../domain/lineageTemporal';
import type {
  AflTradeAssetType,
  AflTradeLineageEdgeKind,
  AflTradeLineageGraph,
  AflTradeTemporalCutoff,
} from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';
import { createAflTradeLineageGraphId } from './valuationCaseContracts';

export interface AflTradeAssetLineageNarrativeEvidence {
  readonly lineageGraphId: string;
  readonly rootAssetId: string;
  readonly cutoff: AflTradeTemporalCutoff;
  readonly nodes: readonly Readonly<{
    assetId: string;
    assetType: AflTradeAssetType;
    label: string;
    depth: number;
    effectiveFrom: string;
    evidenceId: string;
  }>[];
  readonly transformations: readonly Readonly<{
    edgeId: string;
    kind: AflTradeLineageEdgeKind;
    sourceAssetId: string;
    targetAssetId: string;
    sourceLabel: string;
    targetLabel: string;
    effectiveAt: string;
    evidenceId: string;
    ruleVersion: string;
  }>[];
  readonly custodyHistory: readonly Readonly<{
    custodySpellId: string;
    assetId: string;
    aflClubId: string;
    clubName: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    evidenceId: string;
  }>[];
  readonly dispositions: readonly Readonly<{
    dispositionId: string;
    kind: 'asset_voided' | 'asset_expired';
    assetId: string;
    effectiveAt: string;
    evidenceId: string;
    reasonCode: string;
  }>[];
  readonly frontierAssetIds: readonly string[];
}

export interface AflTradeLineageNarrativeDisplayIdentity {
  readonly assets: readonly Readonly<{ assetId: string; label: string }>[];
  readonly clubs: readonly Readonly<{ aflClubId: string; clubName: string }>[];
}

function compareInstants(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

/**
 * Projects the temporally visible value lineage beneath one authenticated transaction root. The
 * result is a canonical graph/tree data model for disclosure UI; correction provenance remains out
 * of the value path.
 */
export function deriveAflTradeAssetLineageNarrativeEvidence(
  graph: AflTradeLineageGraph,
  rootAssetId: string,
  cutoff: AflTradeTemporalCutoff,
  display: AflTradeLineageNarrativeDisplayIdentity
): AflTradeAssetLineageNarrativeEvidence {
  const validation = validateAflTradeLineageGraph(graph);
  if (!validation.valid) {
    throw new TypeError('Asset narrative evidence requires one valid authenticated lineage graph.');
  }
  const effectiveAsOf = parseAflTradeTime(cutoff.effectiveAsOf);
  const knowledgeCutoffAt = parseAflTradeTime(cutoff.knowledgeCutoffAt);
  if (effectiveAsOf === null || knowledgeCutoffAt === null) {
    throw new TypeError('Asset narrative evidence requires an explicit temporal cutoff.');
  }
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const assetLabelById = new Map(display.assets.map(({ assetId, label }) => [assetId, label]));
  const clubNameById = new Map(
    display.clubs.map(({ aflClubId, clubName }) => [aflClubId, clubName])
  );
  if (
    assetLabelById.size !== display.assets.length ||
    clubNameById.size !== display.clubs.length ||
    [...assetLabelById.values(), ...clubNameById.values()].some(
      (label) => label.trim() === '' || label !== label.trim()
    )
  ) {
    throw new TypeError('Asset narrative evidence requires unique human display identity.');
  }
  const root = assetById.get(rootAssetId);
  if (
    root === undefined ||
    parseAflTradeTime(root.effectiveFrom)! > effectiveAsOf ||
    !isAflTradeKnownAt(root, knowledgeCutoffAt)
  ) {
    throw new RangeError('The requested lineage root is not effective and known at the cutoff.');
  }

  const outgoing = activeAflTradeEdgesBySource(graph.edges, cutoff);
  const depths = new Map<string, number>([[rootAssetId, 0]]);
  const traversedEdgeIds = new Set<string>();
  const queue = [rootAssetId];
  for (let index = 0; index < queue.length; index += 1) {
    const sourceAssetId = queue[index]!;
    const sourceDepth = depths.get(sourceAssetId)!;
    const edges = [...(outgoing.get(sourceAssetId) ?? [])].sort(
      (left, right) =>
        compareInstants(left.effectiveAt, right.effectiveAt) || left.edgeId.localeCompare(right.edgeId)
    );
    for (const edge of edges) {
      traversedEdgeIds.add(edge.edgeId);
      const nextDepth = sourceDepth + 1;
      const currentDepth = depths.get(edge.targetAssetId);
      if (currentDepth === undefined || nextDepth < currentDepth) {
        depths.set(edge.targetAssetId, nextDepth);
        queue.push(edge.targetAssetId);
      }
    }
  }

  const nodes = [...depths]
    .map(([assetId, depth]) => {
      const asset = assetById.get(assetId)!;
      const label = assetLabelById.get(assetId);
      if (label === undefined) {
        throw new TypeError('Asset narrative evidence is missing human asset identity.');
      }
      return {
        assetId,
        assetType: asset.assetType,
        label,
        depth,
        effectiveFrom: asset.effectiveFrom,
        evidenceId: asset.evidenceId,
      };
    })
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        compareInstants(left.effectiveFrom, right.effectiveFrom) ||
        left.assetId.localeCompare(right.assetId)
    );
  const traversedEdges = graph.edges
    .filter(({ edgeId }) => traversedEdgeIds.has(edgeId))
    .sort(
      (left, right) =>
        depths.get(left.sourceAssetId)! - depths.get(right.sourceAssetId)! ||
        compareInstants(left.effectiveAt, right.effectiveAt) ||
        left.edgeId.localeCompare(right.edgeId)
    );
  const transformations = traversedEdges.map(
    ({ knownFrom: _knownFrom, knownTo: _knownTo, ...edge }) => ({
      ...edge,
      sourceLabel: assetLabelById.get(edge.sourceAssetId)!,
      targetLabel: assetLabelById.get(edge.targetAssetId)!,
    })
  );
  const reachableAssetIds = new Set(depths.keys());
  const custodyHistory = graph.custodySpells
    .filter(
      (spell) =>
        reachableAssetIds.has(spell.assetId) &&
        parseAflTradeTime(spell.effectiveFrom)! <= effectiveAsOf &&
        isAflTradeKnownAt(spell, knowledgeCutoffAt)
    )
    .sort(
      (left, right) =>
        compareInstants(left.effectiveFrom, right.effectiveFrom) ||
        left.custodySpellId.localeCompare(right.custodySpellId)
    )
    .map(({ knownFrom: _knownFrom, knownTo: _knownTo, ...spell }) => {
      const clubName = clubNameById.get(spell.aflClubId);
      if (clubName === undefined) {
        throw new TypeError('Asset narrative evidence is missing human club identity.');
      }
      return { ...spell, clubName };
    });
  const dispositions = graph.dispositions
    .filter(
      (disposition) =>
        reachableAssetIds.has(disposition.assetId) &&
        parseAflTradeTime(disposition.effectiveAt)! <= effectiveAsOf &&
        isAflTradeKnownAt(disposition, knowledgeCutoffAt)
    )
    .sort(
      (left, right) =>
        compareInstants(left.effectiveAt, right.effectiveAt) ||
        left.dispositionId.localeCompare(right.dispositionId)
    )
    .map(({ knownFrom: _knownFrom, knownTo: _knownTo, ...disposition }) => disposition);

  return {
    lineageGraphId: createAflTradeLineageGraphId(graph),
    rootAssetId,
    cutoff: { ...cutoff },
    nodes,
    transformations,
    custodyHistory,
    dispositions,
    frontierAssetIds: buildAflTradeAttributionFrontier(
      [rootAssetId],
      traversedEdges,
      cutoff,
      graph.dispositions
    ),
  };
}
