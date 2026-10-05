import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type {
  AflTradeAsset,
  AflTradeAssetCustodySpell,
  AflTradeLineageEdge,
  AflTradeLineageGraph,
} from '../domain/lineageTypes';
import {
  derivePrivateGovernedPickAttribution,
  type PrivateGovernedPickAttributionResult,
} from './privateGovernedPickAttribution';

type TransferAssetKind = 'player' | 'pick' | 'future_pick';

export interface PrivateValuationPickRootFact {
  assetId: string;
  transferAssetVersionId: string;
  pickId: string;
  assetKind: 'pick' | 'future_pick';
  receivingClubId: string;
  tradeEffectiveAt: string;
  evidenceId: string;
}

export interface PrivateValuationTransferFact {
  assetVersionId: string;
  eventVersionId: string;
  eventDate: string;
  recordedAt: string;
  assetKind: TransferAssetKind;
  playerId: string | null;
  pickId: string | null;
  draftYear: number | null;
  fromClubId: string;
  toClubId: string;
  evidenceId: string;
}

export interface PrivateValuationPickTransformationFact {
  edgeId: string;
  parentPickId: string;
  childPickId: string;
  relationKind: 'future_right_resolved_to_pick' | 'pick_renumbered_to_pick';
  effectiveAt: string;
  knownFrom: string;
  evidenceId: string;
}

export interface PrivateValuationPickCustodyFact {
  custodyObservationId: string;
  pickId: string;
  observedAt: string;
  currentClubId: string;
  recordedAt: string;
  evidenceId: string;
}

export interface PrivateValuationPickRealizationFact {
  realizationId: string;
  transferAssetVersionId: string;
  pickId: string;
  draftSelectionId: string;
  recordedAt: string;
  evidenceId: string;
}

export interface PrivateValuationDraftSelectionFact {
  selectionId: string;
  pickId: string;
  playerId: string;
  clubId: string;
  eventDate: string;
  recordedAt: string;
  evidenceId: string;
}

export interface PrivateValuationAcquisitionSpellFact {
  spellVersionId: string;
  startAssetVersionId: string;
  playerId: string;
  clubId: string;
  startDate: string;
  endDate: string | null;
  recordedAt: string;
  evidenceId: string;
}

export interface PrivateValuationPickLineageFacts {
  root: PrivateValuationPickRootFact;
  knowledgeCutoffAt: string;
  transfers: PrivateValuationTransferFact[];
  pickTransformations: PrivateValuationPickTransformationFact[];
  custodyObservations: PrivateValuationPickCustodyFact[];
  realizations: PrivateValuationPickRealizationFact[];
  selections: PrivateValuationDraftSelectionFact[];
  acquisitionSpells: PrivateValuationAcquisitionSpellFact[];
}

export type PrivateValuationPickFrontierAsset =
  | {
      assetId: string;
      assetType: 'current_pick_entitlement' | 'future_pick_entitlement';
      identity: { kind: 'pick'; pickId: string };
      acquisitionClubId: string;
      sourceTransferAssetVersionId: string;
    }
  | {
      assetId: string;
      assetType: 'player';
      identity: {
        kind: 'player';
        playerId: string;
        acquisitionSpellVersionId: string | null;
      };
      acquisitionClubId: string;
      sourceTransferAssetVersionId: string;
    };

export type PrivateValuationSelectedPlayerAsset = Omit<
  Extract<PrivateValuationPickFrontierAsset, { assetType: 'player' }>,
  'identity'
> & {
  identity: {
    kind: 'player';
    playerId: string;
    acquisitionSpellVersionId: string;
  };
};

export type PrivateValuationPickRealizationAtCutoff =
  | {
      state: 'unrealized';
      reason: 'draft_selection_not_yet_recorded';
    }
  | {
      state: 'selected';
      attribution: 'credited_current_frontier' | 'superseded_by_later_exchange';
      realizationId: string;
      transferAssetVersionId: string;
      pickId: string;
      draftSelectionId: string;
      recordedAt: string;
      evidenceId: string;
      selection: PrivateValuationDraftSelectionFact;
      selectedPlayer: PrivateValuationSelectedPlayerAsset;
    };

export type PrivateValuationPickLineageMaterializationReason =
  | 'root_transfer_mismatch'
  | 'pick_transformation_ambiguous'
  | 'later_exchange_attribution_ambiguous'
  | 'later_exchange_successor_missing'
  | 'lineage_attribution_unavailable'
  | 'frontier_identity_unavailable'
  | 'pick_realization_ambiguous'
  | 'pick_realization_selection_missing'
  | 'selected_player_acquisition_spell_missing';

export type PrivateValuationPickLineageMaterializationResult =
  | {
      state: 'ready';
      rootAssetId: string;
      graph: AflTradeLineageGraph;
      attribution: Extract<PrivateGovernedPickAttributionResult, { state: 'ready' }>;
      frontierAssets: PrivateValuationPickFrontierAsset[];
      realizationAtCutoff: PrivateValuationPickRealizationAtCutoff;
    }
  | {
      state: 'unavailable';
      rootAssetId: string;
      reasons: PrivateValuationPickLineageMaterializationReason[];
    };

interface MutableGraph {
  assets: AflTradeAsset[];
  custodySpells: AflTradeAssetCustodySpell[];
  edges: AflTradeLineageEdge[];
  dispositions: AflTradeLineageGraph['dispositions'][number][];
  corrections: AflTradeLineageGraph['corrections'][number][];
}

interface ValueCursor {
  assetId: string;
  assetType: AflTradeAsset['assetType'];
  identityKind: 'pick' | 'player';
  identityId: string;
  effectiveFrom: string;
  ownerClubId: string;
  sourceTransferAssetVersionId: string;
}

class MaterializationUnavailable extends Error {
  constructor(readonly reason: PrivateValuationPickLineageMaterializationReason) {
    super(reason);
  }
}

function privatePickAssetId(pickId: string): string {
  return createAflTradeContentAddress('private-lineage-pick', { pickId });
}

function privatePlayerAssetId(identity: {
  playerId: string;
  spellVersionId: string | null;
  sourceId: string;
}): string {
  return createAflTradeContentAddress('private-lineage-player', identity);
}

function privateSelectionAssetId(selectionId: string): string {
  return createAflTradeContentAddress('private-lineage-selection', { selectionId });
}

function privatePackageAssetId(eventVersionId: string, sourceAssetId: string): string {
  return createAflTradeContentAddress('private-lineage-package', {
    eventVersionId,
    sourceAssetId,
  });
}

function addAsset(graph: MutableGraph, asset: AflTradeAsset): void {
  const existing = graph.assets.find(({ assetId }) => assetId === asset.assetId);
  if (existing === undefined) graph.assets.push(asset);
}

function addEdge(graph: MutableGraph, edge: AflTradeLineageEdge): void {
  if (!graph.edges.some(({ edgeId }) => edgeId === edge.edgeId)) graph.edges.push(edge);
}

function acquisitionSpell(
  facts: PrivateValuationPickLineageFacts,
  input: { playerId: string; clubId: string; sourceAssetVersionId: string; effectiveFrom: string }
): PrivateValuationAcquisitionSpellFact | null {
  const exact = facts.acquisitionSpells.filter(
    (spell) =>
      spell.playerId === input.playerId &&
      spell.clubId === input.clubId &&
      (spell.startAssetVersionId === input.sourceAssetVersionId ||
        spell.startDate === input.effectiveFrom)
  );
  return exact.length === 1 ? exact[0]! : null;
}

function createPlayerCursor(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  input: {
    playerId: string;
    clubId: string;
    sourceAssetVersionId: string;
    effectiveFrom: string;
    knownFrom: string;
    evidenceId: string;
  }
): ValueCursor {
  const spell = acquisitionSpell(facts, input);
  const assetId = privatePlayerAssetId({
    playerId: input.playerId,
    spellVersionId: spell?.spellVersionId ?? null,
    sourceId: input.sourceAssetVersionId,
  });
  addAsset(graph, {
    assetId,
    assetType: 'player',
    effectiveFrom: input.effectiveFrom,
    knownFrom: input.knownFrom,
    knownTo: null,
    evidenceId: input.evidenceId,
  });
  if (spell !== null) {
    graph.custodySpells.push({
      custodySpellId: createAflTradeContentAddress('private-lineage-custody', {
        assetId,
        spellVersionId: spell.spellVersionId,
      }),
      assetId,
      aflClubId: input.clubId,
      effectiveFrom: spell.startDate,
      effectiveTo: spell.endDate,
      knownFrom: spell.recordedAt,
      knownTo: null,
      evidenceId: spell.evidenceId,
    });
  }
  return {
    assetId,
    assetType: 'player',
    identityKind: 'player',
    identityId: input.playerId,
    effectiveFrom: input.effectiveFrom,
    ownerClubId: input.clubId,
    sourceTransferAssetVersionId: input.sourceAssetVersionId,
  };
}

function frontierAssetForCursor(
  facts: PrivateValuationPickLineageFacts,
  cursor: ValueCursor
): PrivateValuationPickFrontierAsset {
  if (cursor.identityKind === 'pick') {
    return {
      assetId: cursor.assetId,
      assetType:
        cursor.assetType === 'future_pick_entitlement'
          ? 'future_pick_entitlement'
          : 'current_pick_entitlement',
      identity: { kind: 'pick', pickId: cursor.identityId },
      acquisitionClubId: cursor.ownerClubId,
      sourceTransferAssetVersionId: cursor.sourceTransferAssetVersionId,
    };
  }
  const spell = acquisitionSpell(facts, {
    playerId: cursor.identityId,
    clubId: cursor.ownerClubId,
    sourceAssetVersionId: cursor.sourceTransferAssetVersionId,
    effectiveFrom: cursor.effectiveFrom,
  });
  return {
    assetId: cursor.assetId,
    assetType: 'player',
    identity: {
      kind: 'player',
      playerId: cursor.identityId,
      acquisitionSpellVersionId: spell?.spellVersionId ?? null,
    },
    acquisitionClubId: cursor.ownerClubId,
    sourceTransferAssetVersionId: cursor.sourceTransferAssetVersionId,
  };
}

function selectedPlayerFor(
  facts: PrivateValuationPickLineageFacts,
  realization: PrivateValuationPickRealizationFact,
  selection: PrivateValuationDraftSelectionFact
): PrivateValuationSelectedPlayerAsset {
  const spell = acquisitionSpell(facts, {
    playerId: selection.playerId,
    clubId: selection.clubId,
    sourceAssetVersionId: realization.transferAssetVersionId,
    effectiveFrom: selection.eventDate,
  });
  if (spell === null) {
    throw new MaterializationUnavailable('selected_player_acquisition_spell_missing');
  }
  return {
    assetId: privatePlayerAssetId({
      playerId: selection.playerId,
      spellVersionId: spell.spellVersionId,
      sourceId: realization.transferAssetVersionId,
    }),
    assetType: 'player',
    identity: {
      kind: 'player',
      playerId: selection.playerId,
      acquisitionSpellVersionId: spell.spellVersionId,
    },
    acquisitionClubId: selection.clubId,
    sourceTransferAssetVersionId: realization.transferAssetVersionId,
  };
}

function realizationForTransfer(
  facts: PrivateValuationPickLineageFacts,
  transferAssetVersionId: string,
  pickId?: string
): Omit<Extract<PrivateValuationPickRealizationAtCutoff, { state: 'selected' }>, 'attribution'> | null {
  const realizations = facts.realizations.filter(
    (realization) =>
      realization.transferAssetVersionId === transferAssetVersionId &&
      (pickId === undefined || realization.pickId === pickId)
  );
  if (realizations.length === 0) return null;
  if (realizations.length !== 1) {
    throw new MaterializationUnavailable('pick_realization_ambiguous');
  }
  const realization = realizations[0]!;
  const selections = facts.selections.filter(
    (selection) =>
      selection.selectionId === realization.draftSelectionId &&
      selection.pickId === realization.pickId
  );
  if (selections.length !== 1) {
    throw new MaterializationUnavailable('pick_realization_selection_missing');
  }
  const selection = selections[0]!;
  return {
    state: 'selected',
    ...realization,
    selection,
    selectedPlayer: selectedPlayerFor(facts, realization, selection),
  };
}

function addPickCustody(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  pickId: string,
  assetId: string,
  fallback: PrivateValuationPickCustodyFact | null = null
): void {
  const observations = [
    ...(fallback === null ? [] : [fallback]),
    ...facts.custodyObservations.filter(({ pickId: candidate }) => candidate === pickId),
  ]
    .filter(
      (observation, index, all) =>
        all.findIndex(
          ({ observedAt, currentClubId }) =>
            observedAt === observation.observedAt && currentClubId === observation.currentClubId
        ) === index
    )
    .sort(
      (left, right) =>
        Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
        left.custodyObservationId.localeCompare(right.custodyObservationId)
    );
  const changes = observations.filter(
    (observation, index) =>
      index === 0 || observations[index - 1]!.currentClubId !== observation.currentClubId
  );
  changes.forEach((observation, index) => {
    graph.custodySpells.push({
      custodySpellId: createAflTradeContentAddress('private-lineage-custody', {
        assetId,
        custodyObservationId: observation.custodyObservationId,
      }),
      assetId,
      aflClubId: observation.currentClubId,
      effectiveFrom: observation.observedAt,
      effectiveTo: changes[index + 1]?.observedAt ?? null,
      knownFrom: observation.recordedAt,
      knownTo: null,
      evidenceId: observation.evidenceId,
    });
  });
}

function matchingOutgoingTransfers(
  facts: PrivateValuationPickLineageFacts,
  cursor: ValueCursor
): PrivateValuationTransferFact[] {
  return facts.transfers
    .filter(
      (transfer) =>
        transfer.assetVersionId !== cursor.sourceTransferAssetVersionId &&
        transfer.fromClubId === cursor.ownerClubId &&
        Date.parse(transfer.eventDate) >= Date.parse(cursor.effectiveFrom) &&
        (cursor.identityKind === 'pick'
          ? transfer.pickId === cursor.identityId
          : transfer.playerId === cursor.identityId)
    )
    .sort(
      (left, right) =>
        Date.parse(left.eventDate) - Date.parse(right.eventDate) ||
        left.assetVersionId.localeCompare(right.assetVersionId)
    );
}

function transferAssetType(
  transfer: PrivateValuationTransferFact
): AflTradeAsset['assetType'] {
  if (transfer.assetKind === 'player') return 'player';
  return transfer.assetKind === 'future_pick'
    ? 'future_pick_entitlement'
    : 'current_pick_entitlement';
}

function cursorForIncomingTransfer(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  transfer: PrivateValuationTransferFact
): ValueCursor {
  if (transfer.assetKind === 'player' && transfer.playerId !== null) {
    return createPlayerCursor(graph, facts, {
      playerId: transfer.playerId,
      clubId: transfer.toClubId,
      sourceAssetVersionId: transfer.assetVersionId,
      effectiveFrom: transfer.eventDate,
      knownFrom: transfer.recordedAt,
      evidenceId: transfer.evidenceId,
    });
  }
  if (transfer.pickId === null) {
    throw new MaterializationUnavailable('later_exchange_successor_missing');
  }
  const assetId = privatePickAssetId(transfer.pickId);
  const assetType = transferAssetType(transfer);
  addAsset(graph, {
    assetId,
    assetType,
    effectiveFrom: transfer.eventDate,
    knownFrom: transfer.recordedAt,
    knownTo: null,
    evidenceId: transfer.evidenceId,
  });
  addPickCustody(graph, facts, transfer.pickId, assetId, {
    custodyObservationId: `transfer-custody:${transfer.assetVersionId}`,
    pickId: transfer.pickId,
    observedAt: transfer.eventDate,
    currentClubId: transfer.toClubId,
    recordedAt: transfer.recordedAt,
    evidenceId: transfer.evidenceId,
  });
  return {
    assetId,
    assetType,
    identityKind: 'pick',
    identityId: transfer.pickId,
    effectiveFrom: transfer.eventDate,
    ownerClubId: transfer.toClubId,
    sourceTransferAssetVersionId: transfer.assetVersionId,
  };
}

function expandExchange(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  cursor: ValueCursor,
  visit: (next: ValueCursor) => void
): boolean {
  const outgoing = matchingOutgoingTransfers(facts, cursor);
  if (outgoing.length === 0) return false;
  const first = outgoing[0]!;
  const eventOutgoing = facts.transfers.filter(
    (transfer) =>
      transfer.eventVersionId === first.eventVersionId &&
      transfer.fromClubId === cursor.ownerClubId
  );
  if (eventOutgoing.length !== 1 || eventOutgoing[0]!.assetVersionId !== first.assetVersionId) {
    throw new MaterializationUnavailable('later_exchange_attribution_ambiguous');
  }
  const incoming = facts.transfers
    .filter(
      (transfer) =>
        transfer.eventVersionId === first.eventVersionId &&
        transfer.toClubId === cursor.ownerClubId
    )
    .sort((left, right) => left.assetVersionId.localeCompare(right.assetVersionId));
  if (incoming.length === 0) {
    throw new MaterializationUnavailable('later_exchange_successor_missing');
  }
  const successors = incoming.map((transfer) => cursorForIncomingTransfer(graph, facts, transfer));
  if (successors.length === 1) {
    addEdge(graph, {
      edgeId: createAflTradeContentAddress('private-lineage-edge', {
        kind: 'asset_traded_for_asset',
        sourceAssetId: cursor.assetId,
        targetAssetId: successors[0]!.assetId,
        eventVersionId: first.eventVersionId,
      }),
      kind: 'asset_traded_for_asset',
      sourceAssetId: cursor.assetId,
      targetAssetId: successors[0]!.assetId,
      effectiveAt: first.eventDate,
      knownFrom: first.recordedAt,
      knownTo: null,
      evidenceId: first.evidenceId,
      ruleVersion: 'private-conserved-frontier/v1',
    });
  } else {
    const packageAssetId = privatePackageAssetId(first.eventVersionId, cursor.assetId);
    addAsset(graph, {
      assetId: packageAssetId,
      assetType: 'package',
      effectiveFrom: first.eventDate,
      knownFrom: first.recordedAt,
      knownTo: null,
      evidenceId: first.evidenceId,
    });
    addEdge(graph, {
      edgeId: createAflTradeContentAddress('private-lineage-edge', {
        kind: 'asset_traded_for_package',
        sourceAssetId: cursor.assetId,
        targetAssetId: packageAssetId,
      }),
      kind: 'asset_traded_for_package',
      sourceAssetId: cursor.assetId,
      targetAssetId: packageAssetId,
      effectiveAt: first.eventDate,
      knownFrom: first.recordedAt,
      knownTo: null,
      evidenceId: first.evidenceId,
      ruleVersion: 'private-conserved-frontier/v1',
    });
    for (const successor of successors) {
      addEdge(graph, {
        edgeId: createAflTradeContentAddress('private-lineage-edge', {
          kind: 'package_contains_asset',
          sourceAssetId: packageAssetId,
          targetAssetId: successor.assetId,
        }),
        kind: 'package_contains_asset',
        sourceAssetId: packageAssetId,
        targetAssetId: successor.assetId,
        effectiveAt: first.eventDate,
        knownFrom: first.recordedAt,
        knownTo: null,
        evidenceId: first.evidenceId,
        ruleVersion: 'private-conserved-frontier/v1',
      });
    }
  }
  successors.forEach(visit);
  return true;
}

function addSelection(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  cursor: ValueCursor
): ValueCursor | null {
  const resolved = realizationForTransfer(
    facts,
    cursor.sourceTransferAssetVersionId,
    cursor.identityId
  );
  if (resolved === null) return null;
  const realization = resolved;
  const selection = resolved.selection;
  const selectionAssetId = privateSelectionAssetId(selection.selectionId);
  addAsset(graph, {
    assetId: selectionAssetId,
    assetType: 'draft_selection',
    effectiveFrom: selection.eventDate,
    knownFrom: selection.recordedAt,
    knownTo: null,
    evidenceId: selection.evidenceId,
  });
  const player = createPlayerCursor(graph, facts, {
    playerId: selection.playerId,
    clubId: selection.clubId,
    sourceAssetVersionId: realization.transferAssetVersionId,
    effectiveFrom: selection.eventDate,
    knownFrom: selection.recordedAt,
    evidenceId: selection.evidenceId,
  });
  addEdge(graph, {
    edgeId: createAflTradeContentAddress('private-lineage-edge', {
      kind: 'pick_exercised_at_selection',
      pickAssetId: cursor.assetId,
      selectionAssetId,
    }),
    kind: 'pick_exercised_at_selection',
    sourceAssetId: cursor.assetId,
    targetAssetId: selectionAssetId,
    effectiveAt: selection.eventDate,
    knownFrom: selection.recordedAt,
    knownTo: null,
    evidenceId: realization.evidenceId,
    ruleVersion: 'canonical-pick-realization/v1',
  });
  addEdge(graph, {
    edgeId: createAflTradeContentAddress('private-lineage-edge', {
      kind: 'selection_created_player',
      selectionAssetId,
      playerAssetId: player.assetId,
    }),
    kind: 'selection_created_player',
    sourceAssetId: selectionAssetId,
    targetAssetId: player.assetId,
    effectiveAt: selection.eventDate,
    knownFrom: selection.recordedAt,
    knownTo: null,
    evidenceId: selection.evidenceId,
    ruleVersion: 'canonical-draft-selection/v1',
  });
  return player;
}

function expandPickTransformations(
  graph: MutableGraph,
  facts: PrivateValuationPickLineageFacts,
  cursor: ValueCursor
): ValueCursor {
  let current = cursor;
  const visited = new Set([current.identityId]);
  while (true) {
    const candidates = facts.pickTransformations.filter(
      ({ parentPickId }) => parentPickId === current.identityId
    );
    if (candidates.length === 0) return current;
    if (candidates.length !== 1 || visited.has(candidates[0]!.childPickId)) {
      throw new MaterializationUnavailable('pick_transformation_ambiguous');
    }
    const transformation = candidates[0]!;
    const assetId = privatePickAssetId(transformation.childPickId);
    const assetType: AflTradeAsset['assetType'] = 'current_pick_entitlement';
    addAsset(graph, {
      assetId,
      assetType,
      effectiveFrom: transformation.effectiveAt,
      knownFrom: transformation.knownFrom,
      knownTo: null,
      evidenceId: transformation.evidenceId,
    });
    addPickCustody(graph, facts, transformation.childPickId, assetId);
    addEdge(graph, {
      edgeId: transformation.edgeId,
      kind: transformation.relationKind,
      sourceAssetId: current.assetId,
      targetAssetId: assetId,
      effectiveAt: transformation.effectiveAt,
      knownFrom: transformation.knownFrom,
      knownTo: null,
      evidenceId: transformation.evidenceId,
      ruleVersion: 'canonical-pick-lineage/v1',
    });
    visited.add(transformation.childPickId);
    current = {
      assetId,
      assetType,
      identityKind: 'pick',
      identityId: transformation.childPickId,
      effectiveFrom: transformation.effectiveAt,
      ownerClubId: cursor.ownerClubId,
      sourceTransferAssetVersionId: cursor.sourceTransferAssetVersionId,
    };
  }
}

function canonicalGraph(graph: MutableGraph): AflTradeLineageGraph {
  return {
    assets: graph.assets.sort((left, right) => left.assetId.localeCompare(right.assetId)),
    custodySpells: graph.custodySpells.sort((left, right) =>
      left.custodySpellId.localeCompare(right.custodySpellId)
    ),
    edges: graph.edges.sort(
      (left, right) =>
        Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt) ||
        left.edgeId.localeCompare(right.edgeId)
    ),
    dispositions: graph.dispositions,
    corrections: graph.corrections,
  };
}

export function materializePrivateValuationPickLineage(
  facts: PrivateValuationPickLineageFacts
): PrivateValuationPickLineageMaterializationResult {
  const rootTransfer = facts.transfers.find(
    ({ assetVersionId }) => assetVersionId === facts.root.transferAssetVersionId
  );
  if (
    rootTransfer === undefined ||
    rootTransfer.pickId !== facts.root.pickId ||
    rootTransfer.toClubId !== facts.root.receivingClubId ||
    rootTransfer.assetKind !== facts.root.assetKind
  ) {
    return {
      state: 'unavailable',
      rootAssetId: facts.root.assetId,
      reasons: ['root_transfer_mismatch'],
    };
  }
  const graph: MutableGraph = {
    assets: [],
    custodySpells: [],
    edges: [],
    dispositions: [],
    corrections: [],
  };
  addAsset(graph, {
    assetId: facts.root.assetId,
    assetType:
      facts.root.assetKind === 'future_pick'
        ? 'future_pick_entitlement'
        : 'current_pick_entitlement',
    effectiveFrom: facts.root.tradeEffectiveAt,
    knownFrom: facts.root.tradeEffectiveAt,
    knownTo: null,
    evidenceId: facts.root.evidenceId,
  });
  addPickCustody(graph, facts, facts.root.pickId, facts.root.assetId, {
    custodyObservationId: `transfer-custody:${facts.root.transferAssetVersionId}`,
    pickId: facts.root.pickId,
    observedAt: facts.root.tradeEffectiveAt,
    currentClubId: facts.root.receivingClubId,
    recordedAt: facts.root.tradeEffectiveAt,
    evidenceId: facts.root.evidenceId,
  });
  const rootCursor: ValueCursor = {
    assetId: facts.root.assetId,
    assetType: graph.assets[0]!.assetType,
    identityKind: 'pick',
    identityId: facts.root.pickId,
    effectiveFrom: facts.root.tradeEffectiveAt,
    ownerClubId: facts.root.receivingClubId,
    sourceTransferAssetVersionId: facts.root.transferAssetVersionId,
  };
  const expanded = new Set<string>();
  const valueCursorByAssetId = new Map<string, ValueCursor>([
    [rootCursor.assetId, rootCursor],
  ]);
  const visit = (unresolved: ValueCursor): void => {
    const cursor =
      unresolved.identityKind === 'pick'
        ? expandPickTransformations(graph, facts, unresolved)
        : unresolved;
    valueCursorByAssetId.set(cursor.assetId, cursor);
    if (expanded.has(cursor.assetId)) return;
    expanded.add(cursor.assetId);
    if (!expandExchange(graph, facts, cursor, visit) && cursor.identityKind === 'pick') {
      const selectedPlayer = addSelection(graph, facts, cursor);
      if (selectedPlayer !== null) {
        valueCursorByAssetId.set(selectedPlayer.assetId, selectedPlayer);
      }
    }
  };
  try {
    const rootRealization = realizationForTransfer(
      facts,
      facts.root.transferAssetVersionId
    );
    visit(rootCursor);
    const retainedGraph = canonicalGraph(graph);
    const attribution = derivePrivateGovernedPickAttribution({
      rootAssetId: facts.root.assetId,
      receivingClubId: facts.root.receivingClubId,
      tradeCutoff: {
        effectiveAsOf: facts.root.tradeEffectiveAt,
        knowledgeCutoffAt: facts.root.tradeEffectiveAt,
      },
      currentCutoff: {
        effectiveAsOf: facts.knowledgeCutoffAt,
        knowledgeCutoffAt: facts.knowledgeCutoffAt,
      },
      graph: retainedGraph,
    });
    if (attribution.state !== 'ready') {
      return {
        state: 'unavailable',
        rootAssetId: facts.root.assetId,
        reasons: ['lineage_attribution_unavailable'],
      };
    }
    const frontierAssets = attribution.frontierAssetIds.flatMap((assetId) => {
      const cursor = valueCursorByAssetId.get(assetId);
      return cursor === undefined ? [] : [frontierAssetForCursor(facts, cursor)];
    });
    if (frontierAssets.length !== attribution.frontierAssetIds.length) {
      return {
        state: 'unavailable',
        rootAssetId: facts.root.assetId,
        reasons: ['frontier_identity_unavailable'],
      };
    }
    const realizationAtCutoff: PrivateValuationPickRealizationAtCutoff =
      rootRealization === null
        ? {
            state: 'unrealized',
            reason: 'draft_selection_not_yet_recorded',
          }
        : {
            ...rootRealization,
            attribution: attribution.frontierAssetIds.includes(
              rootRealization.selectedPlayer.assetId
            )
              ? 'credited_current_frontier'
              : 'superseded_by_later_exchange',
          };
    return {
      state: 'ready',
      rootAssetId: facts.root.assetId,
      graph: retainedGraph,
      attribution,
      frontierAssets,
      realizationAtCutoff,
    };
  } catch (error) {
    if (error instanceof MaterializationUnavailable) {
      return {
        state: 'unavailable',
        rootAssetId: facts.root.assetId,
        reasons: [error.reason],
      };
    }
    throw error;
  }
}
