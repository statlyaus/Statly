import {
  buildAflTradeAttributionFrontier,
  findAflTradeAssetCustodian,
  validateAflTradeAttribution,
} from '../domain/lineageAttribution';
import { isAflTradeKnownAt, parseAflTradeTime } from '../domain/lineageTemporal';
import type {
  AflTradeAsset,
  AflTradeLineageEdge,
  AflTradeLineageGraph,
  AflTradeTemporalCutoff,
} from '../domain/lineageTypes';
import { isAflTradeValueBearingAssetType } from '../domain/lineageTypes';
import { validateAflTradeLineageGraph } from '../domain/lineageValidation';

export type PrivateGovernedPickAttributionReason =
  | 'lineage_graph_invalid'
  | 'root_pick_missing'
  | 'root_custody_at_trade_mismatch'
  | 'custody_departure_successor_missing'
  | 'frontier_not_value_bearing'
  | 'frontier_accounting_invalid';

export interface PrivateGovernedPickAttributionInput {
  rootAssetId: string;
  receivingClubId: string;
  tradeCutoff: AflTradeTemporalCutoff;
  currentCutoff: AflTradeTemporalCutoff;
  graph: AflTradeLineageGraph;
}

export type PrivateGovernedPickAttributionResult =
  | {
      state: 'ready';
      rootAssetId: string;
      frontierAssetIds: string[];
    }
  | {
      state: 'unavailable';
      rootAssetId: string;
      reasons: PrivateGovernedPickAttributionReason[];
    };

const PICK_TYPES = new Set<AflTradeAsset['assetType']>([
  'current_pick_entitlement',
  'future_pick_entitlement',
]);
const EXCHANGE_EDGE_KINDS = new Set<AflTradeLineageEdge['kind']>([
  'asset_traded_for_asset',
  'asset_traded_for_package',
]);

function unavailable(
  rootAssetId: string,
  reasons: readonly PrivateGovernedPickAttributionReason[]
): PrivateGovernedPickAttributionResult {
  const order: readonly PrivateGovernedPickAttributionReason[] = [
    'lineage_graph_invalid',
    'root_pick_missing',
    'root_custody_at_trade_mismatch',
    'custody_departure_successor_missing',
    'frontier_not_value_bearing',
    'frontier_accounting_invalid',
  ];
  return {
    state: 'unavailable',
    rootAssetId,
    reasons: order.filter((reason) => reasons.includes(reason)),
  };
}

function activeEdges(
  graph: AflTradeLineageGraph,
  cutoff: AflTradeTemporalCutoff
): readonly AflTradeLineageEdge[] {
  const effectiveAsOf = parseAflTradeTime(cutoff.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(cutoff.knowledgeCutoffAt);
  if (effectiveAsOf === null || knowledgeCutoff === null) return [];
  return graph.edges.filter((edge) => {
    const effectiveAt = parseAflTradeTime(edge.effectiveAt);
    return (
      effectiveAt !== null &&
      effectiveAt <= effectiveAsOf &&
      isAflTradeKnownAt(edge, knowledgeCutoff)
    );
  });
}

function reachableAssetIds(
  rootAssetId: string,
  edges: readonly AflTradeLineageEdge[]
): ReadonlySet<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.sourceAssetId) ?? [];
    targets.push(edge.targetAssetId);
    outgoing.set(edge.sourceAssetId, targets);
  }
  const reached = new Set<string>();
  const visit = (assetId: string) => {
    if (reached.has(assetId)) return;
    reached.add(assetId);
    for (const target of outgoing.get(assetId) ?? []) visit(target);
  };
  visit(rootAssetId);
  return reached;
}

function hasUnattributedCustodyDeparture(
  input: PrivateGovernedPickAttributionInput,
  assetById: ReadonlyMap<string, AflTradeAsset>,
  edges: readonly AflTradeLineageEdge[],
  reachable: ReadonlySet<string>
): boolean {
  const effectiveAsOf = parseAflTradeTime(input.currentCutoff.effectiveAsOf);
  const knowledgeCutoff = parseAflTradeTime(input.currentCutoff.knowledgeCutoffAt);
  if (effectiveAsOf === null || knowledgeCutoff === null) return true;

  for (const assetId of reachable) {
    const asset = assetById.get(assetId);
    if (asset === undefined || !PICK_TYPES.has(asset.assetType)) continue;
    const spells = input.graph.custodySpells
      .filter(
        (spell) =>
          spell.assetId === assetId &&
          isAflTradeKnownAt(spell, knowledgeCutoff) &&
          (parseAflTradeTime(spell.effectiveFrom) ?? Number.POSITIVE_INFINITY) <= effectiveAsOf
      )
      .sort(
        (left, right) =>
          (parseAflTradeTime(left.effectiveFrom) ?? 0) -
          (parseAflTradeTime(right.effectiveFrom) ?? 0)
      );
    const receiverIndex = spells.findIndex(
      ({ aflClubId }) => aflClubId === input.receivingClubId
    );
    if (receiverIndex < 0) continue;
    const departure = spells
      .slice(receiverIndex + 1)
      .find(({ aflClubId }) => aflClubId !== input.receivingClubId);
    if (departure === undefined) continue;
    const departureAt = parseAflTradeTime(departure.effectiveFrom);
    if (
      departureAt === null ||
      !edges.some(
        (edge) =>
          edge.sourceAssetId === assetId &&
          EXCHANGE_EDGE_KINDS.has(edge.kind) &&
          parseAflTradeTime(edge.effectiveAt) === departureAt
      )
    ) {
      return true;
    }
  }
  return false;
}

export function derivePrivateGovernedPickAttribution(
  input: PrivateGovernedPickAttributionInput
): PrivateGovernedPickAttributionResult {
  const graphValidation = validateAflTradeLineageGraph(input.graph);
  if (!graphValidation.valid) {
    return unavailable(input.rootAssetId, ['lineage_graph_invalid']);
  }
  const assetById = new Map(input.graph.assets.map((asset) => [asset.assetId, asset]));
  const root = assetById.get(input.rootAssetId);
  if (root === undefined || !PICK_TYPES.has(root.assetType)) {
    return unavailable(input.rootAssetId, ['root_pick_missing']);
  }
  if (
    findAflTradeAssetCustodian(
      input.graph.custodySpells,
      input.rootAssetId,
      input.tradeCutoff
    ) !== input.receivingClubId
  ) {
    return unavailable(input.rootAssetId, ['root_custody_at_trade_mismatch']);
  }

  const edges = activeEdges(input.graph, input.currentCutoff);
  const reachable = reachableAssetIds(input.rootAssetId, edges);
  if (hasUnattributedCustodyDeparture(input, assetById, edges, reachable)) {
    return unavailable(input.rootAssetId, ['custody_departure_successor_missing']);
  }

  const frontierAssetIds = buildAflTradeAttributionFrontier(
    [input.rootAssetId],
    edges,
    input.currentCutoff,
    input.graph.dispositions
  );
  if (
    frontierAssetIds.some((assetId) => {
      const asset = assetById.get(assetId);
      return asset === undefined || !isAflTradeValueBearingAssetType(asset.assetType);
    })
  ) {
    return unavailable(input.rootAssetId, ['frontier_not_value_bearing']);
  }
  const attribution = validateAflTradeAttribution(input.graph, {
    rootAssetIds: [input.rootAssetId],
    creditedAssetIds: frontierAssetIds,
    effectiveAsOf: input.currentCutoff.effectiveAsOf,
    knowledgeCutoffAt: input.currentCutoff.knowledgeCutoffAt,
  });
  if (!attribution.valid) {
    return unavailable(input.rootAssetId, ['frontier_accounting_invalid']);
  }
  return { state: 'ready', rootAssetId: input.rootAssetId, frontierAssetIds };
}
