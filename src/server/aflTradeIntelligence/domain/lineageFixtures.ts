import type {
  AflTradeAsset,
  AflTradeAssetCustodySpell,
  AflTradeAssetDisposition,
  AflTradeAssetDispositionKind,
  AflTradeAssetType,
  AflTradeAttributionIssueCode,
  AflTradeAttributionRequest,
  AflTradeCorrectionRelation,
  AflTradeCorrectionRelationKind,
  AflTradeLineageEdge,
  AflTradeLineageEdgeKind,
  AflTradeLineageGraph,
  AflTradeLineageIssueCode,
} from './lineageTypes';

export const AFL_TRADE_LINEAGE_FIXTURE_KINDS = [
  'future_pick_to_player',
  'three_party_package',
  'pick_on_traded_before_exercise',
  'player_exit_multiple_returns',
  'active_player',
  'retired_player',
  'voided_asset',
  'identity_correction',
  'evidence_correction',
  'invalid_cycle',
  'invalid_orphan',
] as const;

export type AflTradeLineageFixtureKind = (typeof AFL_TRADE_LINEAGE_FIXTURE_KINDS)[number];

export interface AflTradeAttributionFixtureCheck {
  checkId: string;
  request: AflTradeAttributionRequest;
  expectedValid: boolean;
  expectedFrontierAssetIds: readonly string[];
  expectedIssueCodes: readonly AflTradeAttributionIssueCode[];
}

export interface AflTradeLineageFixture {
  fixtureId: AflTradeLineageFixtureKind;
  graph: AflTradeLineageGraph;
  expectedGraphValid: boolean;
  expectedGraphIssueCodes: readonly AflTradeLineageIssueCode[];
  attributionChecks: readonly AflTradeAttributionFixtureCheck[];
}

const T = {
  trade: '2024-10-10T00:00:00.000Z',
  onTrade: '2024-10-11T00:00:00.000Z',
  resolution: '2025-10-01T00:00:00.000Z',
  renumber: '2025-11-01T00:00:00.000Z',
  draft: '2025-11-20T00:00:00.000Z',
  correction: '2025-12-01T00:00:00.000Z',
  current: '2026-01-01T00:00:00.000Z',
  retirement: '2027-10-01T00:00:00.000Z',
  afterRetirement: '2028-01-01T00:00:00.000Z',
} as const;

function asset(
  assetId: string,
  assetType: AflTradeAssetType,
  effectiveFrom: string = T.trade,
  knownFrom: string = effectiveFrom,
  knownTo: string | null = null
): AflTradeAsset {
  return {
    assetId,
    assetType,
    effectiveFrom,
    knownFrom,
    knownTo,
    evidenceId: `evidence:${assetId}`,
  };
}

function custody(
  assetId: string,
  aflClubId: string,
  effectiveFrom: string,
  effectiveTo: string | null = null
): AflTradeAssetCustodySpell {
  return {
    custodySpellId: `custody:${assetId}:${aflClubId}:${effectiveFrom}`,
    assetId,
    aflClubId,
    effectiveFrom,
    effectiveTo,
    knownFrom: effectiveFrom,
    knownTo: null,
    evidenceId: `evidence:custody:${assetId}:${aflClubId}`,
  };
}

function edge(
  edgeId: string,
  kind: AflTradeLineageEdgeKind,
  sourceAssetId: string,
  targetAssetId: string,
  effectiveAt: string,
  knownFrom = effectiveAt,
  knownTo: string | null = null
): AflTradeLineageEdge {
  return {
    edgeId,
    kind,
    sourceAssetId,
    targetAssetId,
    effectiveAt,
    knownFrom,
    knownTo,
    evidenceId: `evidence:${edgeId}`,
    ruleVersion: 'fabricated-fixture/v1',
  };
}

function disposition(
  dispositionId: string,
  kind: AflTradeAssetDispositionKind,
  assetId: string,
  effectiveAt: string
): AflTradeAssetDisposition {
  return {
    dispositionId,
    kind,
    assetId,
    effectiveAt,
    knownFrom: effectiveAt,
    knownTo: null,
    evidenceId: `evidence:${dispositionId}`,
    reasonCode: `fixture-${kind}`,
  };
}

function correction(
  correctionId: string,
  kind: AflTradeCorrectionRelationKind,
  supersededRecordId: string,
  replacementRecordId: string,
  knownAt = T.correction
): AflTradeCorrectionRelation {
  return {
    correctionId,
    kind,
    supersededRecordId,
    replacementRecordId,
    knownAt,
    evidenceId: `evidence:${correctionId}`,
  };
}

function graph(input: Partial<AflTradeLineageGraph>): AflTradeLineageGraph {
  return {
    assets: input.assets ?? [],
    custodySpells: input.custodySpells ?? [],
    edges: input.edges ?? [],
    dispositions: input.dispositions ?? [],
    corrections: input.corrections ?? [],
  };
}

function request(
  rootAssetIds: readonly string[],
  creditedAssetIds: readonly string[],
  excludedAssetIds: readonly string[] = [],
  effectiveAsOf: string = T.current,
  knowledgeCutoffAt: string = effectiveAsOf
): AflTradeAttributionRequest {
  return {
    rootAssetIds,
    creditedAssetIds,
    excludedAssetIds,
    effectiveAsOf,
    knowledgeCutoffAt,
  };
}

function futurePickToPlayerFixture(): AflTradeLineageFixture {
  const root = 'fixture:future-right-a';
  const resolved = 'fixture:current-pick-9';
  const renumbered = 'fixture:current-pick-12';
  const selection = 'fixture:draft-selection-12';
  const player = 'fixture:player-kestrel';
  return {
    fixtureId: 'future_pick_to_player',
    graph: graph({
      assets: [
        asset(root, 'future_pick_entitlement'),
        asset(resolved, 'current_pick_entitlement', T.resolution),
        asset(renumbered, 'current_pick_entitlement', T.renumber),
        asset(selection, 'draft_selection', T.draft),
        asset(player, 'player', T.draft),
      ],
      custodySpells: [
        custody(root, 'fixture-club-a', T.trade, T.onTrade),
        custody(root, 'fixture-club-b', T.onTrade, T.resolution),
        custody(resolved, 'fixture-club-b', T.resolution, T.renumber),
        custody(renumbered, 'fixture-club-b', T.renumber, T.draft),
        custody(player, 'fixture-club-b', T.draft),
      ],
      edges: [
        edge('fixture:edge-resolve', 'future_right_resolved_to_pick', root, resolved, T.resolution),
        edge('fixture:edge-renumber', 'pick_renumbered_to_pick', resolved, renumbered, T.renumber),
        edge(
          'fixture:edge-exercise',
          'pick_exercised_at_selection',
          renumbered,
          selection,
          T.draft
        ),
        edge('fixture:edge-create-player', 'selection_created_player', selection, player, T.draft),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'before-resolution',
        request: request([root], [root], [], '2025-01-01T00:00:00.000Z'),
        expectedValid: true,
        expectedFrontierAssetIds: [root],
        expectedIssueCodes: [],
      },
      {
        checkId: 'after-draft',
        request: request([root], [player]),
        expectedValid: true,
        expectedFrontierAssetIds: [player],
        expectedIssueCodes: [],
      },
      {
        checkId: 'double-attribution',
        request: request([root], [root, player]),
        expectedValid: false,
        expectedFrontierAssetIds: [player],
        expectedIssueCodes: ['ancestor_double_counted', 'unexpected_frontier_asset'],
      },
    ],
  };
}

function threePartyPackageFixture(): AflTradeLineageFixture {
  const root = 'fixture:player-ibis';
  const bundle = 'fixture:package-three-club-return';
  const pick = 'fixture:package-current-pick';
  const unresolved = 'fixture:package-unresolved-consideration';
  return {
    fixtureId: 'three_party_package',
    graph: graph({
      assets: [
        asset(root, 'player'),
        asset(bundle, 'package', T.onTrade),
        asset(pick, 'current_pick_entitlement', T.onTrade),
        asset(unresolved, 'unresolved', T.onTrade),
      ],
      custodySpells: [
        custody(root, 'fixture-club-a', T.trade, T.onTrade),
        custody(pick, 'fixture-club-b', T.onTrade),
        custody(unresolved, 'fixture-club-c', T.onTrade),
      ],
      edges: [
        edge('fixture:edge-player-to-package', 'asset_traded_for_package', root, bundle, T.onTrade),
        edge('fixture:edge-package-pick', 'package_contains_asset', bundle, pick, T.onTrade),
        edge(
          'fixture:edge-package-unresolved',
          'package_contains_asset',
          bundle,
          unresolved,
          T.onTrade
        ),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'partial-package',
        request: request([root], [pick], [unresolved]),
        expectedValid: true,
        expectedFrontierAssetIds: [pick, unresolved].sort(),
        expectedIssueCodes: [],
      },
      {
        checkId: 'unresolved-cannot-carry-credit',
        request: request([root], [pick, unresolved]),
        expectedValid: false,
        expectedFrontierAssetIds: [pick, unresolved].sort(),
        expectedIssueCodes: ['non_value_bearing_credit'],
      },
    ],
  };
}

function pickOnTradedFixture(): AflTradeLineageFixture {
  const root = 'fixture:ontrade-future-right';
  const firstPick = 'fixture:ontrade-current-pick-7';
  const returnedPick = 'fixture:ontrade-current-pick-18';
  const selection = 'fixture:ontrade-selection-18';
  const player = 'fixture:player-lyrebird';
  return {
    fixtureId: 'pick_on_traded_before_exercise',
    graph: graph({
      assets: [
        asset(root, 'future_pick_entitlement'),
        asset(firstPick, 'current_pick_entitlement', T.resolution),
        asset(returnedPick, 'current_pick_entitlement', T.renumber),
        asset(selection, 'draft_selection', T.draft),
        asset(player, 'player', T.draft),
      ],
      edges: [
        edge(
          'fixture:ontrade-resolve',
          'future_right_resolved_to_pick',
          root,
          firstPick,
          T.resolution
        ),
        edge(
          'fixture:ontrade-return',
          'asset_traded_for_asset',
          firstPick,
          returnedPick,
          T.renumber
        ),
        edge(
          'fixture:ontrade-exercise',
          'pick_exercised_at_selection',
          returnedPick,
          selection,
          T.draft
        ),
        edge('fixture:ontrade-player', 'selection_created_player', selection, player, T.draft),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'successor-player',
        request: request([root], [player]),
        expectedValid: true,
        expectedFrontierAssetIds: [player],
        expectedIssueCodes: [],
      },
    ],
  };
}

function playerExitMultipleReturnsFixture(): AflTradeLineageFixture {
  const root = 'fixture:player-wattlebird';
  const bundle = 'fixture:player-exit-package';
  const currentPick = 'fixture:player-exit-current-pick';
  const futurePick = 'fixture:player-exit-future-pick';
  return {
    fixtureId: 'player_exit_multiple_returns',
    graph: graph({
      assets: [
        asset(root, 'player'),
        asset(bundle, 'package', T.onTrade),
        asset(currentPick, 'current_pick_entitlement', T.onTrade),
        asset(futurePick, 'future_pick_entitlement', T.onTrade),
      ],
      custodySpells: [
        custody(root, 'fixture-club-a', T.trade, T.onTrade),
        custody(currentPick, 'fixture-club-a', T.onTrade),
        custody(futurePick, 'fixture-club-a', T.onTrade),
      ],
      edges: [
        edge('fixture:exit-package', 'player_exit_returned_asset', root, bundle, T.onTrade),
        edge('fixture:exit-current-pick', 'package_contains_asset', bundle, currentPick, T.onTrade),
        edge('fixture:exit-future-pick', 'package_contains_asset', bundle, futurePick, T.onTrade),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'multiple-returns',
        request: request([root], [currentPick, futurePick]),
        expectedValid: true,
        expectedFrontierAssetIds: [currentPick, futurePick].sort(),
        expectedIssueCodes: [],
      },
    ],
  };
}

function singlePlayerFixture(
  fixtureId: 'active_player' | 'retired_player',
  retired: boolean
): AflTradeLineageFixture {
  const player = `fixture:${fixtureId}`;
  return {
    fixtureId,
    graph: graph({
      assets: [asset(player, 'player')],
      custodySpells: [custody(player, 'fixture-club-a', T.trade, retired ? T.retirement : null)],
      dispositions: retired
        ? [disposition('fixture:retired-player', 'asset_expired', player, T.retirement)]
        : [],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: retired ? 'after-retirement' : 'active',
        request: request(
          [player],
          retired ? [] : [player],
          [],
          retired ? T.afterRetirement : T.current
        ),
        expectedValid: true,
        expectedFrontierAssetIds: retired ? [] : [player],
        expectedIssueCodes: [],
      },
    ],
  };
}

function voidedAssetFixture(): AflTradeLineageFixture {
  const pick = 'fixture:voided-current-pick';
  return {
    fixtureId: 'voided_asset',
    graph: graph({
      assets: [asset(pick, 'current_pick_entitlement')],
      dispositions: [disposition('fixture:voided-pick', 'asset_voided', pick, T.resolution)],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'before-void',
        request: request([pick], [pick], [], '2025-01-01T00:00:00.000Z'),
        expectedValid: true,
        expectedFrontierAssetIds: [pick],
        expectedIssueCodes: [],
      },
      {
        checkId: 'after-void',
        request: request([pick], [], [], T.current),
        expectedValid: true,
        expectedFrontierAssetIds: [],
        expectedIssueCodes: [],
      },
    ],
  };
}

function identityCorrectionFixture(): AflTradeLineageFixture {
  const unresolved = 'fixture:identity-unresolved';
  return {
    fixtureId: 'identity_correction',
    graph: graph({
      assets: [asset(unresolved, 'unresolved')],
      corrections: [
        correction(
          'fixture:identity-correction',
          'identity_corrected_to',
          'fixture:identity-record-old',
          'fixture:identity-record-reviewed'
        ),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'correction-is-not-value-lineage',
        request: request([unresolved], [], [unresolved]),
        expectedValid: true,
        expectedFrontierAssetIds: [unresolved],
        expectedIssueCodes: [],
      },
    ],
  };
}

function evidenceCorrectionFixture(): AflTradeLineageFixture {
  const root = 'fixture:corrected-future-right';
  const oldPick = 'fixture:incorrect-current-pick';
  const correctedPick = 'fixture:correct-current-pick';
  const oldKnownTo = T.correction;
  return {
    fixtureId: 'evidence_correction',
    graph: graph({
      assets: [
        asset(root, 'future_pick_entitlement'),
        asset(oldPick, 'current_pick_entitlement', T.resolution),
        asset(correctedPick, 'current_pick_entitlement', T.resolution, T.correction),
      ],
      edges: [
        edge(
          'fixture:edge-superseded',
          'future_right_resolved_to_pick',
          root,
          oldPick,
          T.resolution,
          T.resolution,
          oldKnownTo
        ),
        edge(
          'fixture:edge-corrected',
          'future_right_resolved_to_pick',
          root,
          correctedPick,
          T.resolution,
          T.correction
        ),
      ],
      corrections: [
        correction(
          'fixture:evidence-correction',
          'evidence_supersedes',
          'fixture:edge-superseded',
          'fixture:edge-corrected'
        ),
      ],
    }),
    expectedGraphValid: true,
    expectedGraphIssueCodes: [],
    attributionChecks: [
      {
        checkId: 'before-correction-known',
        request: request([root], [oldPick], [], T.current, '2025-11-15T00:00:00.000Z'),
        expectedValid: true,
        expectedFrontierAssetIds: [oldPick],
        expectedIssueCodes: [],
      },
      {
        checkId: 'after-correction-known',
        request: request([root], [correctedPick], [], T.current, T.current),
        expectedValid: true,
        expectedFrontierAssetIds: [correctedPick],
        expectedIssueCodes: [],
      },
    ],
  };
}

function invalidCycleFixture(): AflTradeLineageFixture {
  const left = 'fixture:cycle-pick-left';
  const right = 'fixture:cycle-pick-right';
  return {
    fixtureId: 'invalid_cycle',
    graph: graph({
      assets: [asset(left, 'current_pick_entitlement'), asset(right, 'current_pick_entitlement')],
      edges: [
        edge('fixture:cycle-left-right', 'pick_renumbered_to_pick', left, right, T.resolution),
        edge('fixture:cycle-right-left', 'pick_renumbered_to_pick', right, left, T.renumber),
      ],
    }),
    expectedGraphValid: false,
    expectedGraphIssueCodes: ['cycle'],
    attributionChecks: [],
  };
}

function invalidOrphanFixture(): AflTradeLineageFixture {
  const root = 'fixture:orphan-root';
  return {
    fixtureId: 'invalid_orphan',
    graph: graph({
      assets: [asset(root, 'future_pick_entitlement')],
      edges: [
        edge(
          'fixture:orphan-edge',
          'future_right_resolved_to_pick',
          root,
          'fixture:missing-target',
          T.resolution
        ),
      ],
    }),
    expectedGraphValid: false,
    expectedGraphIssueCodes: ['missing_asset'],
    attributionChecks: [],
  };
}

export function buildAflTradeLineageFixture(
  kind: AflTradeLineageFixtureKind
): AflTradeLineageFixture {
  switch (kind) {
    case 'future_pick_to_player':
      return futurePickToPlayerFixture();
    case 'three_party_package':
      return threePartyPackageFixture();
    case 'pick_on_traded_before_exercise':
      return pickOnTradedFixture();
    case 'player_exit_multiple_returns':
      return playerExitMultipleReturnsFixture();
    case 'active_player':
      return singlePlayerFixture('active_player', false);
    case 'retired_player':
      return singlePlayerFixture('retired_player', true);
    case 'voided_asset':
      return voidedAssetFixture();
    case 'identity_correction':
      return identityCorrectionFixture();
    case 'evidence_correction':
      return evidenceCorrectionFixture();
    case 'invalid_cycle':
      return invalidCycleFixture();
    case 'invalid_orphan':
      return invalidOrphanFixture();
  }
}

export function buildAllAflTradeLineageFixtures(): AflTradeLineageFixture[] {
  return AFL_TRADE_LINEAGE_FIXTURE_KINDS.map(buildAflTradeLineageFixture);
}
