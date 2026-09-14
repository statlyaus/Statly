import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { specialEntitlementDateBounds } from './specialEntitlementLinkValidation';
import { reviewedPickLineageSchema, type ReviewedPickLineage } from './reviewedPickLineage';

type Movement = ReviewedPickLineage['movements'][number];
type MovementNode = {
  movement: Movement;
  transferIds: Set<string>;
  reviewedTransferIds: Set<string>;
  evidence: Map<string, ReviewedPickLineage['evidence'][number]>;
};
type CustodyGraph = {
  nodes: Map<string, MovementNode>;
  next: Map<string, string>;
  previous: Map<string, string>;
  roots: Map<string, string>;
  transferNodes: Map<string, string>;
};

function mergeMovementSource(node: MovementNode, source: Movement['source']) {
  const retained = node.movement.source;
  if (
    retained &&
    source &&
    (retained.nativeEventId !== source.nativeEventId ||
      retained.sourceUrl !== source.sourceUrl ||
      canonicalizeAflTradeJson(retained.artifact) !== canonicalizeAflTradeJson(source.artifact))
  )
    throw new TypeError('Shared movement source identity differs.');
  if (retained && source)
    node.movement.source = {
      ...retained,
      rowOrdinals: [...new Set([...retained.rowOrdinals, ...source.rowOrdinals])].sort(
        (a, b) => a - b
      ),
    };
}

function registerMovement(graph: CustodyGraph, record: ReviewedPickLineage, movement: Movement) {
  const { nodes, transferNodes, roots } = graph;
  if (!movement.source && !movement.transferId)
    throw new TypeError(
      'Correction movements require a retained source or exact registered transfer.'
    );
  const source = movement.source;
  const nodeId = createAflTradeContentAddress('reviewed-custody-movement', {
    ...(source
      ? { sourceArtifactId: source.artifact.artifactId, sourceLabel: source.retainedAssetLabel }
      : { sourceTransferId: movement.transferId }),
    fromClubId: movement.fromClubId,
    toClubId: movement.toClubId,
    occurredAt: movement.occurredAt,
  });
  let node = nodes.get(nodeId);
  if (node) {
    mergeMovementSource(node, source);
  } else {
    node = {
      movement: structuredClone(movement),
      transferIds: new Set(),
      reviewedTransferIds: new Set(),
      evidence: new Map(),
    };
    nodes.set(nodeId, node);
  }
  node.reviewedTransferIds.add(record.transferId);
  for (const ref of record.evidence) {
    const existing = node.evidence.get(ref.artifactId);
    if (existing && canonicalizeAflTradeJson(existing) !== canonicalizeAflTradeJson(ref))
      throw new TypeError('Shared evidence metadata differs.');
    node.evidence.set(ref.artifactId, ref);
  }
  if (movement.transferId) {
    const known = transferNodes.get(movement.transferId);
    if (known && known !== nodeId)
      throw new TypeError('One transfer cannot represent different custody movements.');
    transferNodes.set(movement.transferId, nodeId);
    node.transferIds.add(movement.transferId);
  }
  if (movement.transferId === record.transferId) roots.set(record.transferId, nodeId);
  return nodeId;
}

function registerReviewedMovements(graph: CustodyGraph, records: ReviewedPickLineage[]) {
  const { next, previous } = graph;
  for (const record of records) {
    let predecessor: string | undefined;
    for (const movement of record.movements) {
      const nodeId = registerMovement(graph, record, movement);
      if (predecessor) {
        if (
          predecessor === nodeId ||
          (next.has(predecessor) && next.get(predecessor) !== nodeId) ||
          (previous.has(nodeId) && previous.get(nodeId) !== predecessor)
        )
          throw new TypeError('Shared custody histories cannot branch or repeat a movement.');
        next.set(predecessor, nodeId);
        previous.set(nodeId, predecessor);
      }
      predecessor = nodeId;
    }
  }
}

function walkCustodyChain(graph: CustodyGraph, start: string, visited: Set<string>) {
  const { nodes, next } = graph;
  const movementIds: string[] = [];
  let current: string | undefined = start;
  let earliest = Number.NEGATIVE_INFINITY;
  while (current) {
    if (visited.has(current)) throw new TypeError('Correction custody cycle detected.');
    visited.add(current);
    movementIds.push(current);
    const movement = nodes.get(current)!.movement;
    const bounds = specialEntitlementDateBounds(movement.occurredAt);
    if (earliest > bounds.latest)
      throw new TypeError('Merged custody chronology contradicts retained dates.');
    earliest = Math.max(earliest, bounds.earliest);
    const following = next.get(current);
    if (following && movement.toClubId !== nodes.get(following)!.movement.fromClubId)
      throw new TypeError('Merged custody holders do not connect.');
    current = following;
  }
  return movementIds;
}

/** Consolidate exact retained movements, never infer shared custody merely from a shared player. */
export function buildReviewedLineageCorrectionGraph(input: readonly unknown[]) {
  const records = input
    .map((value) => reviewedPickLineageSchema.parse(value))
    .sort((a, b) => a.transferId.localeCompare(b.transferId));
  if (
    !records.length ||
    new Set(records.map((r) => r.candidateId)).size !== 1 ||
    new Set(records.map((r) => r.transferId)).size !== records.length
  )
    throw new TypeError('Correction graph requires unique records from one reviewed candidate.');
  const graph: CustodyGraph = {
    nodes: new Map(),
    next: new Map(),
    previous: new Map(),
    roots: new Map(),
    transferNodes: new Map(),
  };
  const { nodes, previous, roots } = graph;
  registerReviewedMovements(graph, records);
  const chains: {
    chainId: string;
    movementIds: string[];
    transferIds: string[];
    endpoint: ReviewedPickLineage['endpoint'];
    originalClubId: string | null;
  }[] = [];
  const visited = new Set<string>();
  for (const start of [...nodes.keys()].filter((id) => !previous.has(id)).sort()) {
    const movementIds = walkCustodyChain(graph, start, visited);
    const members = records.filter((r) => movementIds.includes(roots.get(r.transferId)!));
    const endpoints = new Map(
      members.map((r) => [canonicalizeAflTradeJson(r.endpoint), r.endpoint])
    );
    const origins = new Set(
      members.flatMap((r) => (r.originalClubId === null ? [] : [r.originalClubId]))
    );
    if (endpoints.size !== 1 || origins.size > 1)
      throw new TypeError('Shared custody histories have contradictory endpoints or origins.');
    const endpoint = [...endpoints.values()][0];
    const transferIds = members.map((r) => r.transferId).sort();
    const content = { movementIds, transferIds, endpoint, originalClubId: [...origins][0] ?? null };
    chains.push({
      chainId: createAflTradeContentAddress('reviewed-pick-history', content),
      ...content,
    });
  }
  if (visited.size !== nodes.size || roots.size !== records.length)
    throw new TypeError('Correction custody contains a cycle or missing reviewed root.');
  const movements = [...nodes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([movementId, node]) => {
      const { transferId: _transferId, predecessorOrdinal: _ordinal, ...fact } = node.movement;
      return {
        movementId,
        ...fact,
        predecessorMovementId: previous.get(movementId) ?? null,
        transferIds: [...node.transferIds].sort(),
        reviewedTransferIds: [...node.reviewedTransferIds].sort(),
        evidence: [...node.evidence.values()].sort((a, b) =>
          a.artifactId.localeCompare(b.artifactId)
        ),
      };
    });
  const content = {
    schemaVersion: 'afl-trade-reviewed-lineage-correction-graph/v1' as const,
    candidateId: records[0].candidateId,
    chains: chains.sort((a, b) => a.chainId.localeCompare(b.chainId)),
    movements,
  };
  return {
    correctionGraphId: createAflTradeContentAddress('reviewed-lineage-correction-graph', content),
    content,
    canonicalAdmission: false as const,
  };
}
