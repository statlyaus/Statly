import {
  aflTradeKnowledgeIntervalsOverlap,
  duplicateAflTradeValues,
  isAflTradeKnownAt,
  parseAflTradeTime,
} from './lineageTemporal';
import type {
  AflTradeAsset,
  AflTradeAssetCustodySpell,
  AflTradeAssetDisposition,
  AflTradeAssetType,
  AflTradeLineageEdge,
  AflTradeLineageEdgeKind,
  AflTradeLineageGraph,
  AflTradeLineageIssue,
  AflTradeLineageIssueCode,
  AflTradeLineageValidation,
} from './lineageTypes';

const allowedEdgeTypes: Record<
  AflTradeLineageEdgeKind,
  { source: readonly AflTradeAssetType[]; target: readonly AflTradeAssetType[] }
> = {
  future_right_resolved_to_pick: {
    source: ['future_pick_entitlement'],
    target: ['current_pick_entitlement'],
  },
  pick_renumbered_to_pick: {
    source: ['current_pick_entitlement'],
    target: ['current_pick_entitlement'],
  },
  pick_exercised_at_selection: {
    source: ['current_pick_entitlement'],
    target: ['draft_selection'],
  },
  selection_created_player: { source: ['draft_selection'], target: ['player'] },
  asset_traded_for_asset: {
    source: ['player', 'current_pick_entitlement', 'future_pick_entitlement'],
    target: [
      'player',
      'current_pick_entitlement',
      'future_pick_entitlement',
      'unresolved',
      'unsupported_consideration',
    ],
  },
  asset_traded_for_package: {
    source: ['player', 'current_pick_entitlement', 'future_pick_entitlement'],
    target: ['package'],
  },
  package_contains_asset: {
    source: ['package'],
    target: [
      'player',
      'current_pick_entitlement',
      'future_pick_entitlement',
      'unresolved',
      'unsupported_consideration',
    ],
  },
  player_exit_returned_asset: {
    source: ['player'],
    target: [
      'player',
      'current_pick_entitlement',
      'future_pick_entitlement',
      'package',
      'unresolved',
      'unsupported_consideration',
    ],
  },
};

const multiSuccessorEdgeKinds = new Set<AflTradeLineageEdgeKind>([
  'asset_traded_for_asset',
  'package_contains_asset',
  'player_exit_returned_asset',
]);

function addIssue(
  issues: AflTradeLineageIssue[],
  code: AflTradeLineageIssueCode,
  subjectId: string,
  message: string
) {
  issues.push({ code, subjectId, message });
}

function validateKnowledgeInterval(
  subjectId: string,
  knownFrom: string,
  knownTo: string | null,
  issues: AflTradeLineageIssue[]
) {
  const from = parseAflTradeTime(knownFrom);
  const to = knownTo === null ? null : parseAflTradeTime(knownTo);
  if (from === null || (knownTo !== null && to === null)) {
    addIssue(issues, 'invalid_time', subjectId, `${subjectId} has an invalid knowledge time.`);
    return;
  }
  if (to !== null && to <= from) {
    addIssue(
      issues,
      'invalid_knowledge_interval',
      subjectId,
      `${subjectId} must stop being known after it first becomes known.`
    );
  }
}

function validateUniqueIds(graph: AflTradeLineageGraph, issues: AflTradeLineageIssue[]) {
  const groups: ReadonlyArray<{
    code: AflTradeLineageIssueCode;
    label: string;
    values: readonly string[];
  }> = [
    { code: 'duplicate_asset', label: 'Asset', values: graph.assets.map((item) => item.assetId) },
    {
      code: 'duplicate_custody_spell',
      label: 'Custody spell',
      values: graph.custodySpells.map((item) => item.custodySpellId),
    },
    {
      code: 'duplicate_edge',
      label: 'Lineage edge',
      values: graph.edges.map((item) => item.edgeId),
    },
    {
      code: 'duplicate_disposition',
      label: 'Asset disposition',
      values: graph.dispositions.map((item) => item.dispositionId),
    },
    {
      code: 'duplicate_correction',
      label: 'Correction relation',
      values: graph.corrections.map((item) => item.correctionId),
    },
  ];

  for (const group of groups) {
    for (const identifier of duplicateAflTradeValues(group.values)) {
      addIssue(
        issues,
        group.code,
        identifier,
        `${group.label} ${identifier} is declared more than once.`
      );
    }
  }
}

function validateBitemporalRecords(graph: AflTradeLineageGraph, issues: AflTradeLineageIssue[]) {
  for (const asset of graph.assets) {
    if (parseAflTradeTime(asset.effectiveFrom) === null) {
      addIssue(issues, 'invalid_time', asset.assetId, `Asset ${asset.assetId} has invalid time.`);
    }
    validateKnowledgeInterval(asset.assetId, asset.knownFrom, asset.knownTo, issues);
  }
  for (const spell of graph.custodySpells) {
    validateKnowledgeInterval(spell.custodySpellId, spell.knownFrom, spell.knownTo, issues);
  }
  for (const edge of graph.edges) {
    validateKnowledgeInterval(edge.edgeId, edge.knownFrom, edge.knownTo, issues);
  }
  for (const disposition of graph.dispositions) {
    validateKnowledgeInterval(
      disposition.dispositionId,
      disposition.knownFrom,
      disposition.knownTo,
      issues
    );
  }
  for (const correction of graph.corrections) {
    if (parseAflTradeTime(correction.knownAt) === null) {
      addIssue(
        issues,
        'invalid_time',
        correction.correctionId,
        `Correction relation ${correction.correctionId} has invalid knowledge time.`
      );
    }
  }
}

function inspectCustodySpell(
  spell: AflTradeAssetCustodySpell,
  assetById: ReadonlyMap<string, AflTradeAsset>,
): { index: boolean; issues: AflTradeLineageIssue[] } {
  const issues: AflTradeLineageIssue[] = [];
  if (!assetById.has(spell.assetId)) {
    addIssue(
      issues,
      'missing_asset',
      spell.custodySpellId,
      `Custody spell ${spell.custodySpellId} references missing asset ${spell.assetId}.`
    );
    return { index: false, issues };
  }
  const start = parseAflTradeTime(spell.effectiveFrom);
  const end = spell.effectiveTo === null ? null : parseAflTradeTime(spell.effectiveTo);
  if (start === null || (spell.effectiveTo !== null && end === null)) {
    addIssue(
      issues,
      'invalid_time',
      spell.custodySpellId,
      `Custody spell ${spell.custodySpellId} has an invalid effective time.`
    );
    return { index: false, issues };
  }
  if (end !== null && end <= start) {
    addIssue(
      issues,
      'invalid_custody_interval',
      spell.custodySpellId,
      `Custody spell ${spell.custodySpellId} must end after it starts.`
    );
  }
  return { index: true, issues };
}

function effectiveCustodyIntervalsOverlap(
  left: AflTradeAssetCustodySpell,
  right: AflTradeAssetCustodySpell
): boolean {
  if (!aflTradeKnowledgeIntervalsOverlap(left, right)) return false;
  const leftStart = parseAflTradeTime(left.effectiveFrom);
  const leftEnd =
    left.effectiveTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(left.effectiveTo);
  const rightStart = parseAflTradeTime(right.effectiveFrom);
  const rightEnd =
    right.effectiveTo === null ? Number.POSITIVE_INFINITY : parseAflTradeTime(right.effectiveTo);
  return (
    leftStart !== null &&
    leftEnd !== null &&
    rightStart !== null &&
    rightEnd !== null &&
    leftStart < rightEnd &&
    rightStart < leftEnd
  );
}

function collectCustodyOverlapIssues(
  assetId: string,
  spells: readonly AflTradeAssetCustodySpell[]
): AflTradeLineageIssue[] {
  const issues: AflTradeLineageIssue[] = [];
  for (let leftIndex = 0; leftIndex < spells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < spells.length; rightIndex += 1) {
      if (effectiveCustodyIntervalsOverlap(spells[leftIndex], spells[rightIndex])) {
        addIssue(
          issues,
          'overlapping_custody',
          spells[rightIndex].custodySpellId,
          `Asset ${assetId} has overlapping AFL club custody spells in one knowledge version.`
        );
      }
    }
  }
  return issues;
}

function validateCustody(
  graph: AflTradeLineageGraph,
  assetById: ReadonlyMap<string, AflTradeAsset>,
  issues: AflTradeLineageIssue[]
) {
  const spellsByAsset = new Map<string, AflTradeAssetCustodySpell[]>();
  for (const spell of graph.custodySpells) {
    const inspected = inspectCustodySpell(spell, assetById);
    issues.push(...inspected.issues);
    if (!inspected.index) continue;
    const existing = spellsByAsset.get(spell.assetId) ?? [];
    existing.push(spell);
    spellsByAsset.set(spell.assetId, existing);
  }
  for (const [assetId, spells] of spellsByAsset) {
    issues.push(...collectCustodyOverlapIssues(assetId, spells));
  }
}

function collectLineageEdgeIssues(
  edge: AflTradeLineageEdge,
  assetById: ReadonlyMap<string, AflTradeAsset>
): AflTradeLineageIssue[] {
  const issues: AflTradeLineageIssue[] = [];
  const source = assetById.get(edge.sourceAssetId);
  const target = assetById.get(edge.targetAssetId);
  if (!source || !target) {
    addIssue(
      issues,
      'missing_asset',
      edge.edgeId,
      `Lineage edge ${edge.edgeId} references a missing source or target asset.`
    );
    return issues;
  }
  if (source.assetId === target.assetId) {
    addIssue(issues, 'self_edge', edge.edgeId, `Lineage edge ${edge.edgeId} is self-referential.`);
    return issues;
  }
  const allowed = allowedEdgeTypes[edge.kind];
  if (!allowed) {
    addIssue(
      issues,
      'invalid_edge_types',
      edge.edgeId,
      `Lineage edge ${edge.edgeId} declares unknown kind ${edge.kind}.`
    );
    return issues;
  }
  if (!allowed.source.includes(source.assetType) || !allowed.target.includes(target.assetType)) {
    addIssue(
      issues,
      'invalid_edge_types',
      edge.edgeId,
      `${edge.kind} cannot transform ${source.assetType} into ${target.assetType}.`
    );
  }
  const edgeTime = parseAflTradeTime(edge.effectiveAt);
  const sourceTime = parseAflTradeTime(source.effectiveFrom);
  const targetTime = parseAflTradeTime(target.effectiveFrom);
  if (edgeTime === null || sourceTime === null || targetTime === null) {
    addIssue(issues, 'invalid_time', edge.edgeId, `Lineage edge ${edge.edgeId} has invalid time.`);
    return issues;
  }
  if (edgeTime < sourceTime || edgeTime < targetTime) {
    addIssue(
      issues,
      'edge_before_asset',
      edge.edgeId,
      `Lineage edge ${edge.edgeId} predates its source or target asset.`
    );
  }
  return issues;
}

function collectSuccessorConflictIssues(
  edgesBySource: ReadonlyMap<string, readonly AflTradeLineageEdge[]>
): AflTradeLineageIssue[] {
  const issues: AflTradeLineageIssue[] = [];
  for (const [sourceAssetId, edges] of edgesBySource) {
    for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
        const left = edges[leftIndex];
        const right = edges[rightIndex];
        if (!aflTradeKnowledgeIntervalsOverlap(left, right)) continue;
        const compatibleMultiple =
          left.kind === right.kind && multiSuccessorEdgeKinds.has(left.kind);
        if (!compatibleMultiple) {
          addIssue(
            issues,
            'conflicting_successors',
            sourceAssetId,
            `Asset ${sourceAssetId} has conflicting active successor transformations.`
          );
        }
      }
    }
  }
  return issues;
}

function validateEdges(
  graph: AflTradeLineageGraph,
  assetById: ReadonlyMap<string, AflTradeAsset>,
  edgesBySource: ReadonlyMap<string, readonly AflTradeLineageEdge[]>,
  issues: AflTradeLineageIssue[]
) {
  for (const edge of graph.edges) issues.push(...collectLineageEdgeIssues(edge, assetById));
  issues.push(...collectSuccessorConflictIssues(edgesBySource));
}

function validateDispositions(
  graph: AflTradeLineageGraph,
  assetById: ReadonlyMap<string, AflTradeAsset>,
  edgesBySource: ReadonlyMap<string, readonly AflTradeLineageEdge[]>,
  issues: AflTradeLineageIssue[]
) {
  const dispositionsByAsset = new Map<string, AflTradeAssetDisposition[]>();
  for (const disposition of graph.dispositions) {
    const asset = assetById.get(disposition.assetId);
    if (!asset) {
      addIssue(
        issues,
        'missing_asset',
        disposition.dispositionId,
        `Disposition ${disposition.dispositionId} references missing asset ${disposition.assetId}.`
      );
      continue;
    }
    const dispositionTime = parseAflTradeTime(disposition.effectiveAt);
    const assetTime = parseAflTradeTime(asset.effectiveFrom);
    if (dispositionTime === null) {
      addIssue(
        issues,
        'invalid_time',
        disposition.dispositionId,
        `Disposition ${disposition.dispositionId} has invalid time.`
      );
    } else if (assetTime !== null && dispositionTime < assetTime) {
      addIssue(
        issues,
        'disposition_before_asset',
        disposition.dispositionId,
        `Disposition ${disposition.dispositionId} predates asset ${asset.assetId}.`
      );
    }
    const existing = dispositionsByAsset.get(disposition.assetId) ?? [];
    existing.push(disposition);
    dispositionsByAsset.set(disposition.assetId, existing);
  }

  for (const [assetId, dispositions] of dispositionsByAsset) {
    for (let leftIndex = 0; leftIndex < dispositions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < dispositions.length; rightIndex += 1) {
        if (aflTradeKnowledgeIntervalsOverlap(dispositions[leftIndex], dispositions[rightIndex])) {
          addIssue(
            issues,
            'conflicting_disposition',
            assetId,
            `Asset ${assetId} has conflicting active terminal dispositions.`
          );
        }
      }
    }
    for (const disposition of dispositions) {
      for (const edge of edgesBySource.get(assetId) ?? []) {
        if (aflTradeKnowledgeIntervalsOverlap(disposition, edge)) {
          addIssue(
            issues,
            'terminal_asset_has_successor',
            assetId,
            `Terminal asset ${assetId} also has an active successor transformation.`
          );
        }
      }
    }
  }
}

function validatePackages(graph: AflTradeLineageGraph, issues: AflTradeLineageIssue[]) {
  const packagesWithChildren = new Set(
    graph.edges
      .filter((edge) => edge.kind === 'package_contains_asset')
      .map((edge) => edge.sourceAssetId)
  );
  for (const asset of graph.assets) {
    if (asset.assetType === 'package' && !packagesWithChildren.has(asset.assetId)) {
      addIssue(
        issues,
        'empty_package',
        asset.assetId,
        `Package ${asset.assetId} has no declared contents.`
      );
    }
  }
}

function validateCorrections(graph: AflTradeLineageGraph, issues: AflTradeLineageIssue[]) {
  for (const correction of graph.corrections) {
    if (correction.supersededRecordId === correction.replacementRecordId) {
      addIssue(
        issues,
        'self_correction',
        correction.correctionId,
        `Correction ${correction.correctionId} must reference different records.`
      );
    }
  }
}

function findCycles(edges: readonly AflTradeLineageEdge[]): string[] {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.sourceAssetId) ?? [];
    targets.push(edge.targetAssetId);
    outgoing.set(edge.sourceAssetId, targets);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (assetId: string) => {
    if (visiting.has(assetId)) {
      cycles.add(assetId);
      return;
    }
    if (visited.has(assetId)) return;
    visiting.add(assetId);
    for (const targetId of outgoing.get(assetId) ?? []) visit(targetId);
    visiting.delete(assetId);
    visited.add(assetId);
  };

  for (const assetId of outgoing.keys()) visit(assetId);
  return [...cycles].sort();
}

function validateCycles(graph: AflTradeLineageGraph, issues: AflTradeLineageIssue[]) {
  const knowledgeTimes = [...new Set(graph.edges.map((edge) => edge.knownFrom))];
  const cycleAssets = new Set<string>();
  for (const knowledgeTime of knowledgeTimes) {
    const cutoff = parseAflTradeTime(knowledgeTime);
    if (cutoff === null) continue;
    const active = graph.edges.filter((edge) => isAflTradeKnownAt(edge, cutoff));
    for (const assetId of findCycles(active)) cycleAssets.add(assetId);
  }
  for (const assetId of [...cycleAssets].sort()) {
    addIssue(issues, 'cycle', assetId, `Lineage cycle detected at asset ${assetId}.`);
  }
}

export function validateAflTradeLineageGraph(
  graph: AflTradeLineageGraph
): AflTradeLineageValidation {
  const issues: AflTradeLineageIssue[] = [];
  validateUniqueIds(graph, issues);
  validateBitemporalRecords(graph, issues);
  const assetById = new Map(graph.assets.map((asset) => [asset.assetId, asset]));
  const edgesBySource = new Map<string, AflTradeLineageEdge[]>();
  for (const edge of graph.edges) {
    const existing = edgesBySource.get(edge.sourceAssetId) ?? [];
    existing.push(edge);
    edgesBySource.set(edge.sourceAssetId, existing);
  }
  validateCustody(graph, assetById, issues);
  validateEdges(graph, assetById, edgesBySource, issues);
  validateDispositions(graph, assetById, edgesBySource, issues);
  validatePackages(graph, issues);
  validateCorrections(graph, issues);
  validateCycles(graph, issues);
  return { valid: issues.length === 0, issues };
}
