import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION,
  createGovernedPrivateValuationCalculationInput,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateValuationCalculationInput';
import { createGovernedPrivateValuationExplanation } from '@/server/aflTradeIntelligence/valuation/governedPrivateValuationExplanation';
import { runGovernedPrivateValuation } from '@/server/aflTradeIntelligence/valuation/governedPrivateValuationRun';
import { projectGovernedPrivateTradeEvaluation } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationProjector';
import { privateGovernedPickEvidenceAdmissionSchema } from '@/server/aflTradeIntelligence/valuation/privateGovernedPickEvidence';
import { privateGovernedPlayerEvidenceAdmissionSchema } from '@/server/aflTradeIntelligence/valuation/privateGovernedPlayerEvidence';
import { createFabricatedAflTradeValuationFixture } from '@/server/aflTradeIntelligence/valuation/tradeValuationFixtures';

function governedInput() {
  const fixture = createFabricatedAflTradeValuationFixture('future_pick_resolution');
  const valuationInputBundleId = `valuation-input-bundle:${'9'.repeat(64)}`;
  const componentDrawSet = structuredClone(fixture.componentDrawSet);
  componentDrawSet.content.valuationInputBundleId = valuationInputBundleId;
  componentDrawSet.componentDrawSetId = createAflTradeContentAddress(
    'component-draw-set',
    componentDrawSet.content
  );
  const realizedContributionLedger = structuredClone(fixture.realizedContributionLedger);
  realizedContributionLedger.content.valuationInputBundleId = valuationInputBundleId;
  realizedContributionLedger.realizedContributionLedgerId = createAflTradeContentAddress(
    'realized-contribution-ledger',
    realizedContributionLedger.content
  );
  const packagePolicy = structuredClone(fixture.packagePolicy);
  packagePolicy.content.valuationInputBundleId = valuationInputBundleId;
  packagePolicy.packagePolicyId = createAflTradeContentAddress(
    'package-policy',
    packagePolicy.content
  );
  const valuationCase = structuredClone(fixture.valuationCase);
  valuationCase.content.valuationInputBundleId = valuationInputBundleId;
  valuationCase.content.componentDrawSetId = componentDrawSet.componentDrawSetId;
  valuationCase.content.realizedContributionLedgerId =
    realizedContributionLedger.realizedContributionLedgerId;
  valuationCase.content.packagePolicyId = packagePolicy.packagePolicyId;
  valuationCase.valuationCaseId = createAflTradeContentAddress(
    'valuation-case',
    valuationCase.content
  );
  const createdAt = '2026-08-15T03:00:00.000Z';
  const evidence = createAflTradeCanonicalJsonArtifactRef({ evidence: 'governed' }, createdAt);

  return createGovernedPrivateValuationCalculationInput({
    schemaVersion: GOVERNED_PRIVATE_VALUATION_CALCULATION_INPUT_SCHEMA_VERSION,
    authority: {
      kind: 'governed_private_nonproduction',
      confirmedFacts: {
        resultId: `private-confirmed-valuation-result:${'1'.repeat(64)}`,
        resultArtifact: evidence,
        valuationScopeKey: 'afl-men:2025-trades',
        transactionPromotionId: `private-workbook-transaction-promotion:${'2'.repeat(64)}`,
        tradeId: valuationCase.content.tradeId,
        valueUnitId: valuationCase.content.valueUnitId,
        assetIds: componentDrawSet.content.assets.map(({ assetId }) => assetId),
      },
      sourceUseAssessments: [
        {
          assessmentId: `hpn-private-source-use-assessment:${'3'.repeat(64)}`,
          assessmentArtifact: evidence,
          state: 'permitted_private_calculation',
          operation: 'derived_feature_creation',
          valuationScopeKey: 'afl-men:2025-trades',
          modelTraining: 'blocked',
          evidenceRefs: [evidence],
        },
      ],
      privateEvaluation: {
        decisionId: `private-valuation-evaluation-decision:${'4'.repeat(64)}`,
        decisionArtifact: evidence,
        state: 'authorized_private_calculation',
        environment: 'non_production',
        modelTrainingAuthorized: false,
        liveCaptureAuthorized: false,
        publicationAuthorized: false,
        evidenceRefs: [evidence],
      },
      factualRelease: {
        releaseId: `outcome-release:${'5'.repeat(64)}`,
        releaseArtifact: evidence,
        state: 'active',
        evidenceRefs: [evidence],
      },
      components: componentDrawSet.content.components.map((component) => ({
        ...component,
        environment: 'non_production' as const,
        outcome: 'succeeded' as const,
        gate3State: 'approved' as const,
        runArtifact: evidence,
        gate3DecisionArtifact: evidence,
        evidenceRefs: [evidence],
      })),
      valuationBundle: {
        bundleId: valuationCase.content.valuationBundleId,
        bundleArtifact: evidence,
        gate3DecisionId: `gate-decision:${'6'.repeat(64)}`,
        gate3DecisionArtifact: evidence,
        environment: 'non_production',
        gate3State: 'approved',
        evidenceRefs: [evidence],
      },
      publicationProhibited: true,
    },
    tradeId: valuationCase.content.tradeId,
    valuationInputBundleId,
    valuationCase,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    createdAt,
    publicationEligible: false,
  });
}

function governedChain() {
  const calculationInput = governedInput();
  const run = runGovernedPrivateValuation({
    calculationInput,
    calculatedAt: '2026-08-15T03:01:00.000Z',
  });
  const parties = calculationInput.content.valuationCase.content.parties;
  const assetKinds = new Map(
    calculationInput.content.componentDrawSet.content.assets.map((asset) => [
      asset.assetId,
      asset.assetKind === 'player'
        ? ('player' as const)
        : asset.assetKind === 'current_pick_entitlement'
          ? ('current_pick' as const)
          : ('future_pick' as const),
    ])
  );
  const transfers = parties.flatMap((receiver, receiverIndex) =>
    receiver.receivedRootAssetIds.map((assetId) => ({
      transferId: `confirmed-transfer:${assetId}`,
      fromClubId: parties[(receiverIndex + parties.length - 1) % parties.length]!.aflClubId,
      toClubId: receiver.aflClubId,
      assetId,
      assetKind: assetKinds.get(assetId)!,
      displayLabel: assetId,
      directionBasis: 'confirmed_canonical_transfer' as const,
    }))
  );
  const explanation = createGovernedPrivateValuationExplanation({
    calculationInput,
    run,
    transfers,
    explanationPolicy: {
      schemaVersion: 'governed-private-explanation-policy/v1',
      valueUnitId: calculationInput.content.valuationCase.content.valueUnitId,
      practicalEquivalenceBandByView: {
        at_trade: 0,
        realized: 0,
        remaining: 0,
        current: 0,
      },
      practicalEquivalenceBasis: 'Exact governed local distribution comparison.',
    },
    confidenceLevel: 'high',
    explainedAt: '2026-08-15T03:02:00.000Z',
  });
  return { calculationInput, run, transfers, explanation };
}

function admittedAssetEvidence(chain: ReturnType<typeof governedChain>) {
  const retainedAt = '2026-08-15T03:03:00.000Z';
  const retained = (name: string) =>
    createAflTradeCanonicalJsonArtifactRef({ retained: name }, retainedAt);
  const confirmedResultArtifact = chain.calculationInput.content.authority.confirmedFacts.resultArtifact;
  const playerTransfer = chain.transfers.find(({ assetKind }) => assetKind === 'player')!;
  const pickTransfer = chain.transfers.find(({ assetKind }) => assetKind !== 'player')!;
  const playerCalculationArtifact = retained('player-calculation');
  const coverageEvidenceRef = retained('player-coverage');
  const playerContent = {
    schemaVersion: 'private-governed-player-evidence/v1' as const,
    environment: 'non_production' as const,
    authority: 'exact_finalized_hpn_season_calculations' as const,
    confirmedResultArtifact,
    assetId: playerTransfer.assetId,
    canonicalPlayerId: 'local-afl-player:governed-player',
    receivingClubId: playerTransfer.toClubId,
    acquisitionSpellVersionId: `acquisition-spell-version:${'a'.repeat(64)}`,
    tradeYear: 2024,
    knowledgeCutoffAt: '2026-08-05T00:00:00.000Z',
    methodId: `hpn-pav-method:${'b'.repeat(64)}`,
    valueUnitId: 'season_pav' as const,
    horizons: [
      {
        kind: 'current_season' as const,
        coverage: 'right_censored' as const,
        season: 2026,
        gamesPlayed: 12,
        effectiveThrough: '2026-08-05T00:00:00.000Z',
        calculationId: `hpn-pav-season:${'c'.repeat(64)}`,
        calculationArtifact: playerCalculationArtifact,
        coverageEvidenceRef,
        inputSetId: `hpn-pav-input-set:${'d'.repeat(64)}`,
        factualRunId: `factual-reconciliation-run:${'e'.repeat(64)}`,
        sourceRowIds: Array.from({ length: 12 }, (_, index) => `source-row:${index + 1}`),
        source: {
          totalPoints: 12,
          hitOuts: 0,
          goalAssists: 3,
          inside50s: 12,
          marks: 24,
          marksInside50: 2,
          freeKicksFor: 4,
          freeKicksAgainst: 3,
          rebound50s: 8,
          onePercenters: 10,
          clearances: 20,
          tackles: 32,
        },
        components: {
          offensiveScore: 1,
          midfieldScore: 2,
          defensiveScore: 3,
          offensivePav: 10,
          midfieldPav: 20,
          defensivePav: 30,
          totalPav: 60,
        },
      },
    ],
    evidenceRefs: [confirmedResultArtifact, coverageEvidenceRef, playerCalculationArtifact].sort(
      (left, right) => left.artifactId.localeCompare(right.artifactId)
    ),
    admittedAt: retainedAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Exact private local non-production player evidence only; missing seasons remain unavailable and no model, grade, publication, or production authority is granted.' as const,
  };
  const playerAdmission = privateGovernedPlayerEvidenceAdmissionSchema.parse({
    admissionId: createAflTradeContentAddress('private-governed-player-evidence', playerContent),
    content: playerContent,
  });

  const lineageArtifact = retained('pick-lineage');
  const realizationArtifact = retained('pick-realization');
  const observationArtifact = retained('pick-observation');
  const pickContent = {
    schemaVersion: 'private-governed-pick-evidence/v1' as const,
    environment: 'non_production' as const,
    authority: 'canonical_pick_lineage_realization_and_released_pav_observation' as const,
    confirmedResultArtifact,
    assetId: pickTransfer.assetId,
    rootPickId: 'pick:2025:national:future-round-1',
    transferAssetVersionId: 'event-asset-version:governed-pick',
    receivingClubId: pickTransfer.toClubId,
    draftYear: 2025,
    factualReleaseId: chain.calculationInput.content.authority.factualRelease.releaseId,
    tradeKnowledgeCutoffAt: '2024-10-10T00:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T00:00:00.000Z',
    lineage: {
      rootPickId: 'pick:2025:national:future-round-1',
      finalPickId: 'pick:2025:national:18',
      edges: [
        {
          edgeId: `pick-lineage-edge:${'f'.repeat(64)}`,
          parentPickId: 'pick:2025:national:future-round-1',
          childPickId: 'pick:2025:national:18',
          relationKind: 'renumbered_to',
          sequence: 1,
          evidenceRef: lineageArtifact,
        },
      ],
    },
    lineageArtifact,
    realization: {
      realizationId: `pick-realization:${'1'.repeat(64)}`,
      transferAssetVersionId: 'event-asset-version:governed-pick',
      pickId: 'pick:2025:national:18',
      draftSelectionId: `draft-selection:${'2'.repeat(64)}`,
      evidenceRef: realizationArtifact,
    },
    realizationArtifact,
    observationId: `pick-pav-observation:${'3'.repeat(64)}`,
    observationArtifact,
    finalSelection: {
      selectionId: `draft-selection:${'2'.repeat(64)}`,
      pickId: 'pick:2025:national:18',
      draftYear: 2025,
      eventDate: '2025-11-20',
      actualSelectionNumber: 18,
      selectedPlayerId: 'local-afl-player:selected-player',
      selectingClubId: pickTransfer.toClubId,
      selectedPlayerAcquisitionSpellVersionIds: [
        `acquisition-spell-version:${'4'.repeat(64)}`,
      ],
    },
    realizedContribution: {
      state: 'right_censored' as const,
      contributionObservedToDate: 18,
      gamesObservedToDate: 6,
      censoredAt: '2026-08-05T00:00:00.000Z',
      calculationIds: [`hpn-pav-season:${'5'.repeat(64)}`],
    },
    selectedPlayerHorizons: [
      {
        kind: 'current_season' as const,
        coverage: 'right_censored' as const,
        season: 2026,
        calculationId: `hpn-pav-season:${'5'.repeat(64)}`,
        calculationSha256: '5'.repeat(64),
        spellVersionId: `acquisition-spell-version:${'4'.repeat(64)}`,
        playerId: 'local-afl-player:selected-player',
        clubId: pickTransfer.toClubId,
        sourceRowIds: Array.from({ length: 6 }, (_, index) => `pick-source-row:${index + 1}`),
        gamesPlayed: 6,
        totalPav: 18,
        effectiveThrough: '2026-08-05T00:00:00.000Z',
      },
    ],
    atTradeValueAuthority: 'governed_pick_model_required' as const,
    remainingValueAuthority: 'governed_pick_model_required' as const,
    evidenceRefs: [
      confirmedResultArtifact,
      lineageArtifact,
      realizationArtifact,
      observationArtifact,
    ].sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    admittedAt: retainedAt,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    limitation:
      'Exact private local non-production pick lineage and realized selected-player evidence only; at-trade and remaining values require separately governed models and publication is prohibited.' as const,
  };
  const pickAdmission = privateGovernedPickEvidenceAdmissionSchema.parse({
    admissionId: createAflTradeContentAddress('private-governed-pick-evidence', pickContent),
    content: pickContent,
  });

  return [
    {
      kind: 'player' as const,
      admission: playerAdmission,
      admissionArtifact: createAflTradeCanonicalJsonArtifactRef(playerAdmission, retainedAt),
    },
    {
      kind: 'pick' as const,
      admission: pickAdmission,
      admissionArtifact: createAflTradeCanonicalJsonArtifactRef(pickAdmission, retainedAt),
    },
  ];
}

describe('governed private valuation run', () => {
  it('runs the existing deterministic kernel only from one authenticated governed package', () => {
    const input = governedInput();
    const result = runGovernedPrivateValuation({
      calculationInput: input,
      calculatedAt: '2026-08-15T03:01:00.000Z',
    });

    expect(result.calculation.content).toMatchObject({
      valuationCaseId: input.content.valuationCase.valuationCaseId,
      valuationBundleId: input.content.authority.valuationBundle.bundleId,
      valueUnitId: input.content.authority.confirmedFacts.valueUnitId,
    });
    expect(result.calculationInputId).toBe(input.calculationInputId);
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(result.calculationArtifact, result.calculation)
    ).toBe(true);
    expect(result.publicationEligible).toBe(false);
  });

  it('rejects a governed package whose content no longer matches its address', () => {
    const input = structuredClone(governedInput());
    input.content.tradeId = 'altered-trade';

    expect(() =>
      runGovernedPrivateValuation({
        calculationInput: input,
        calculatedAt: '2026-08-15T03:01:00.000Z',
      })
    ).toThrow();
  });

  it('seals canonical factual directions and a four-view governed explanation', () => {
    const { explanation: assembled } = governedChain();

    expect(assembled.explanation.state).toBe('available');
    if (assembled.explanation.state !== 'available') throw new Error('Expected explanation.');
    expect(assembled.explanation.document.authority.kind).toBe(
      'governed_private_nonproduction'
    );
    expect(assembled.explanation.document.views).toHaveLength(4);
    expect(assembled.explanation.document.views[3]!.clubs[0]!.grade.state).toBe('provisional');
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        assembled.explanationArtifact!,
        assembled.explanation.document
      )
    ).toBe(true);
    expect(assembled.directionEvidence.content.explanationPolicy.schemaVersion).toBe(
      'governed-private-explanation-policy/v1'
    );
  });

  it('projects exact player and pick evidence into one complete immutable v2 generation', () => {
    const chain = governedChain();
    const generation = projectGovernedPrivateTradeEvaluation({
      calculationInput: chain.calculationInput,
      run: chain.run,
      explanation: chain.explanation,
      assetEvidence: admittedAssetEvidence(chain),
      workbookSha256: '7'.repeat(64),
      generatedAt: '2026-08-15T03:04:00.000Z',
    });

    expect(generation.content).toMatchObject({
      schemaVersion: 'local-private-trade-evaluation-generation/v2',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      assets: [
        {
          assetKind: 'future_pick',
          canonicalPlayerId: 'local-afl-player:selected-player',
          evidenceHorizons: [
            { kind: 'current_season', coverage: 'right_censored', season: 2026 },
          ],
        },
        {
          assetKind: 'player',
          canonicalPlayerId: 'local-afl-player:governed-player',
          evidenceHorizons: [
            { kind: 'current_season', coverage: 'right_censored', season: 2026 },
          ],
        },
      ],
    });
    expect(generation.content.overallGrades.every(({ state }) => state === 'provisional')).toBe(
      true
    );
    expect(generation.content.tradeVerdict.state).toBe('calculated');
  });
});
