import { z } from 'zod';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import type { AflTradeLineageGraph } from '../domain/lineageTypes';
import { createAflTradeComponentDrawSet } from '../valuation/componentDrawSet';
import { createAflTradePackagePolicy } from '../valuation/packagePolicy';
import { createAflTradeRealizedContributionLedger } from '../valuation/realizedContributionLedger';
import { createAflTradeStructuredExplanation } from '../valuation/structuredExplanations';
import { calculateAflTradeValuation } from '../valuation/tradeValuationCalculation';
import { createFabricatedAflTradeValuationFixture } from '../valuation/tradeValuationFixtures';
import { validateAflTradeValuationArtifactChain } from '../valuation/tradeValuationValidation';
import {
  createAflTradeLineageGraphId,
  createAflTradeValuationCase,
} from '../valuation/valuationCaseContracts';
import { createAflTradeValuationSnapshotSet } from '../valuation/valuationSnapshots';

export const LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION =
  'fabricated_test_evidence_not_real_afl_data' as const;

const scenarioSchema = z.enum(['baseline', 'replacement']);
const assetKindSchema = z.enum(['player', 'current_pick', 'future_pick']);
const directionBasisSchema = z.enum([
  'two_party_other_club_assumption',
  'deterministic_fixture_transfer_map_v1',
  'archive_recorded_transfer',
]);

const definitionSchema = z
  .object({
    schemaVersion: z.literal('local-synthetic-trade-definition/v1'),
    basis: z
      .object({
        kind: z.enum(['private_workbook', 'test_fixture_archive']),
        basisId: z.string().trim().min(1).max(200),
      })
      .strict(),
    tradeId: z.string().trim().min(1).max(200),
    effectiveAt: z.string().datetime({ offset: true }),
    effectiveThrough: z.string().datetime({ offset: true }),
    parties: z
      .array(
        z
          .object({
            aflClubId: z.string().trim().min(1).max(200),
            clubName: z.string().trim().min(1).max(120),
          })
          .strict()
      )
      .min(2)
      .max(18),
    transfers: z
      .array(
        z
          .object({
            transferId: z.string().trim().min(1).max(200),
            fromClubId: z.string().trim().min(1).max(200),
            toClubId: z.string().trim().min(1).max(200),
            assetId: z.string().trim().min(1).max(200),
            assetKind: assetKindSchema,
            displayLabel: z.string().trim().min(1).max(240),
            directionBasis: directionBasisSchema,
          })
          .strict()
      )
      .min(2)
      .max(100),
  })
  .strict()
  .superRefine((definition, context) => {
    if (Date.parse(definition.effectiveThrough) <= Date.parse(definition.effectiveAt)) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveThrough'],
        message: 'Synthetic scenarios require a closed contribution window after the trade.',
      });
    }
    const clubIds = definition.parties.map(({ aflClubId }) => aflClubId);
    const clubIdSet = new Set(clubIds);
    if (clubIdSet.size !== clubIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['parties'],
        message: 'Synthetic scenario parties must be unique.',
      });
    }
    const transferIds = definition.transfers.map(({ transferId }) => transferId);
    const assetIds = definition.transfers.map(({ assetId }) => assetId);
    if (new Set(transferIds).size !== transferIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['transfers'],
        message: 'Synthetic scenario transfers must be unique.',
      });
    }
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['transfers'],
        message: 'Synthetic scenario root assets must be unique.',
      });
    }
    definition.transfers.forEach((transfer, index) => {
      if (
        transfer.fromClubId === transfer.toClubId ||
        !clubIdSet.has(transfer.fromClubId) ||
        !clubIdSet.has(transfer.toClubId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transfers', index],
          message: 'Every synthetic transfer must connect two distinct declared parties.',
        });
      }
    });
    for (const clubId of clubIds) {
      if (!definition.transfers.some(({ toClubId }) => toClubId === clubId)) {
        context.addIssue({
          code: 'custom',
          path: ['transfers'],
          message: 'Every synthetic scenario party must receive at least one root asset.',
        });
      }
      if (!definition.transfers.some(({ fromClubId }) => fromClubId === clubId)) {
        context.addIssue({
          code: 'custom',
          path: ['transfers'],
          message: 'Every synthetic scenario party must surrender at least one root asset.',
        });
      }
    }
  });

export type LocalSyntheticTradeDefinition = z.infer<typeof definitionSchema>;
export type LocalSyntheticValuationScenario = z.infer<typeof scenarioSchema>;

export interface LocalSyntheticValuationScenarioInput {
  environment: 'test_fixture';
  definition: LocalSyntheticTradeDefinition;
  valuationBundleId: string;
  scenario: LocalSyntheticValuationScenario;
  assessedAt: string;
}

type Transfer = LocalSyntheticTradeDefinition['transfers'][number];

function semanticId(
  prefix: 'artifact' | 'dataset' | 'gate-decision' | 'model-protocol' | 'model-run',
  basisId: string,
  input: unknown
): string {
  return createAflTradeContentAddress(prefix, {
    evidenceClassification: LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION,
    basisId,
    ...((input as object) ?? {}),
  });
}

function canonicalDefinition(
  unparsed: LocalSyntheticTradeDefinition
): LocalSyntheticTradeDefinition {
  const definition = definitionSchema.parse(unparsed);
  return definitionSchema.parse({
    ...definition,
    parties: [...definition.parties].sort((left, right) =>
      left.aflClubId.localeCompare(right.aflClubId)
    ),
    transfers: [...definition.transfers].sort((left, right) =>
      left.transferId.localeCompare(right.transferId)
    ),
  });
}

function assetType(transfer: Transfer) {
  if (transfer.assetKind === 'player') return 'player' as const;
  if (transfer.assetKind === 'current_pick') return 'current_pick_entitlement' as const;
  return 'future_pick_entitlement' as const;
}

function buildLineage(definition: LocalSyntheticTradeDefinition) {
  const transitionAt = new Date(
    Date.parse(definition.effectiveAt) + 24 * 60 * 60 * 1_000
  ).toISOString();
  const selectionAt = new Date(
    Date.parse(definition.effectiveAt) + 2 * 24 * 60 * 60 * 1_000
  ).toISOString();
  if (Date.parse(definition.effectiveThrough) <= Date.parse(selectionAt)) {
    throw new RangeError('Synthetic valuation requires a closed local contribution window.');
  }
  const basisId = definition.basis.basisId;
  const evidenceId = semanticId('artifact', basisId, {
    tradeId: definition.tradeId,
    purpose: 'synthetic-lineage-evidence',
  });
  const assets: AflTradeLineageGraph['assets'][number][] = [];
  const custodySpells: AflTradeLineageGraph['custodySpells'][number][] = [];
  const edges: AflTradeLineageGraph['edges'][number][] = [];
  const contributors = definition.transfers.map((transfer) => {
    const rootAssetId = transfer.assetId;
    const rootCustodySpellId = semanticId('artifact', basisId, {
      tradeId: definition.tradeId,
      assetId: rootAssetId,
      aflClubId: transfer.toClubId,
      purpose: 'synthetic-root-custody-spell',
    });
    assets.push({
      assetId: rootAssetId,
      assetType: assetType(transfer),
      effectiveFrom: definition.effectiveAt,
      knownFrom: definition.effectiveAt,
      knownTo: null,
      evidenceId,
    });
    if (transfer.assetKind === 'player') {
      custodySpells.push({
        custodySpellId: rootCustodySpellId,
        assetId: rootAssetId,
        aflClubId: transfer.toClubId,
        effectiveFrom: definition.effectiveAt,
        effectiveTo: null,
        knownFrom: definition.effectiveAt,
        knownTo: null,
        evidenceId,
      });
      return {
        rootAssetId,
        contributorPlayerAssetId: rootAssetId,
        aflClubId: transfer.toClubId,
        custodySpellId: rootCustodySpellId,
        periodStartAt: definition.effectiveAt,
      };
    }

    const resolvedPickAssetId = semanticId('artifact', basisId, {
      tradeId: definition.tradeId,
      rootAssetId,
      purpose: 'synthetic-resolved-pick',
    });
    const selectionAssetId = semanticId('artifact', basisId, {
      tradeId: definition.tradeId,
      rootAssetId,
      purpose: 'synthetic-draft-selection',
    });
    const playerAssetId = semanticId('artifact', basisId, {
      tradeId: definition.tradeId,
      rootAssetId,
      purpose: 'synthetic-contributor-player',
    });
    const playerCustodySpellId = semanticId('artifact', basisId, {
      tradeId: definition.tradeId,
      assetId: playerAssetId,
      aflClubId: transfer.toClubId,
      purpose: 'synthetic-player-custody-spell',
    });
    const rootTransitionAt = transfer.assetKind === 'future_pick' ? transitionAt : selectionAt;
    custodySpells.push({
      custodySpellId: rootCustodySpellId,
      assetId: rootAssetId,
      aflClubId: transfer.toClubId,
      effectiveFrom: definition.effectiveAt,
      effectiveTo: rootTransitionAt,
      knownFrom: definition.effectiveAt,
      knownTo: null,
      evidenceId,
    });
    if (transfer.assetKind === 'future_pick') {
      const resolvedPickCustodySpellId = semanticId('artifact', basisId, {
        tradeId: definition.tradeId,
        assetId: resolvedPickAssetId,
        aflClubId: transfer.toClubId,
        purpose: 'synthetic-resolved-pick-custody-spell',
      });
      assets.push({
        assetId: resolvedPickAssetId,
        assetType: 'current_pick_entitlement',
        effectiveFrom: transitionAt,
        knownFrom: transitionAt,
        knownTo: null,
        evidenceId,
      });
      custodySpells.push({
        custodySpellId: resolvedPickCustodySpellId,
        assetId: resolvedPickAssetId,
        aflClubId: transfer.toClubId,
        effectiveFrom: transitionAt,
        effectiveTo: selectionAt,
        knownFrom: transitionAt,
        knownTo: null,
        evidenceId,
      });
      edges.push({
        edgeId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          rootAssetId,
          purpose: 'synthetic-future-pick-resolution-edge',
        }),
        kind: 'future_right_resolved_to_pick',
        sourceAssetId: rootAssetId,
        targetAssetId: resolvedPickAssetId,
        effectiveAt: transitionAt,
        knownFrom: transitionAt,
        knownTo: null,
        evidenceId,
        ruleVersion: 'synthetic-local-scenario/v1',
      });
    }
    assets.push(
      {
        assetId: selectionAssetId,
        assetType: 'draft_selection',
        effectiveFrom: selectionAt,
        knownFrom: selectionAt,
        knownTo: null,
        evidenceId,
      },
      {
        assetId: playerAssetId,
        assetType: 'player',
        effectiveFrom: selectionAt,
        knownFrom: selectionAt,
        knownTo: null,
        evidenceId,
      }
    );
    custodySpells.push({
      custodySpellId: playerCustodySpellId,
      assetId: playerAssetId,
      aflClubId: transfer.toClubId,
      effectiveFrom: selectionAt,
      effectiveTo: null,
      knownFrom: selectionAt,
      knownTo: null,
      evidenceId,
    });
    edges.push(
      {
        edgeId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          rootAssetId,
          purpose: 'synthetic-pick-exercise-edge',
        }),
        kind: 'pick_exercised_at_selection',
        sourceAssetId: transfer.assetKind === 'future_pick' ? resolvedPickAssetId : rootAssetId,
        targetAssetId: selectionAssetId,
        effectiveAt: selectionAt,
        knownFrom: selectionAt,
        knownTo: null,
        evidenceId,
        ruleVersion: 'synthetic-local-scenario/v1',
      },
      {
        edgeId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          rootAssetId,
          purpose: 'synthetic-selection-player-edge',
        }),
        kind: 'selection_created_player',
        sourceAssetId: selectionAssetId,
        targetAssetId: playerAssetId,
        effectiveAt: selectionAt,
        knownFrom: selectionAt,
        knownTo: null,
        evidenceId,
        ruleVersion: 'synthetic-local-scenario/v1',
      }
    );
    return {
      rootAssetId,
      contributorPlayerAssetId: playerAssetId,
      aflClubId: transfer.toClubId,
      custodySpellId: playerCustodySpellId,
      periodStartAt: selectionAt,
    };
  });
  return {
    lineageGraph: {
      assets,
      custodySpells,
      edges,
      dispositions: [],
      corrections: [],
    } satisfies AflTradeLineageGraph,
    contributors,
  };
}

function forecast(view: 'at_trade' | 'remaining', value: number) {
  return {
    view,
    timingTreatment: 'component_applied_football_timing_only_no_market_discount' as const,
    seasons: [
      {
        seasonOffset: 0,
        undiscountedContribution: value,
        footballTimingWeight: 1,
        timingAdjustedContribution: value,
      },
    ],
    undiscountedContribution: value,
    timingAdjustedContribution: value,
  };
}

function createScenarioComponentDrawSet(input: {
  definition: LocalSyntheticTradeDefinition;
  valuationBundleId: string;
  scenario: LocalSyntheticValuationScenario;
}) {
  const template = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const basisId = input.definition.basis.basisId;
  const components = template.componentDrawSet.content.components.map((component) => ({
    ...component,
    protocolId: semanticId('model-protocol', basisId, {
      tradeId: input.definition.tradeId,
      scenario: input.scenario,
      role: component.role,
      purpose: 'synthetic-protocol',
    }),
    runId: semanticId('model-run', basisId, {
      tradeId: input.definition.tradeId,
      scenario: input.scenario,
      role: component.role,
      purpose: 'synthetic-run',
    }),
    datasetId: semanticId('dataset', basisId, {
      tradeId: input.definition.tradeId,
      scenario: input.scenario,
      role: component.role,
      purpose: 'synthetic-dataset',
    }),
    gate3DecisionId: semanticId('gate-decision', basisId, {
      tradeId: input.definition.tradeId,
      scenario: input.scenario,
      role: component.role,
      purpose: 'synthetic-contract-placeholder-not-real-gate-3',
    }),
  }));
  const assets = input.definition.transfers.map((transfer) => ({
    status: 'supported' as const,
    assetId: transfer.assetId,
    assetKind: assetType(transfer),
    componentRole:
      transfer.assetKind === 'player'
        ? ('player_contribution_and_availability' as const)
        : ('draft_pick_and_future_pick_distribution' as const),
    forecastRepresentation: 'season_path' as const,
  }));
  const draws = [0.4, 0.6].map((probabilityWeight, drawIndex) => ({
    drawIndex,
    drawKey: `synthetic-${input.scenario}-draw-${drawIndex}`,
    probabilityWeight,
    sharedFactorStates: [
      {
        kind: 'other_declared' as const,
        factorKey: `synthetic-${input.scenario}-fixture`,
        stateId: `synthetic-state-${drawIndex}`,
      },
    ],
    assetOutcomes: assets.map((asset, assetIndex) => {
      const rank =
        input.scenario === 'baseline'
          ? assetIndex + 1
          : input.definition.transfers.length - assetIndex;
      const value = rank * 5 * (drawIndex === 0 ? 0.8 : 1.2);
      return {
        assetId: asset.assetId,
        componentRole: asset.componentRole,
        forecasts: [forecast('at_trade', value), forecast('remaining', value * 0.5)],
      };
    }),
  }));
  return createAflTradeComponentDrawSet({
    ...structuredClone(template.componentDrawSet.content),
    valuationBundleId: input.valuationBundleId,
    components,
    assets,
    draws,
  });
}

function buildLocalSyntheticValuationArtifacts(
  unparsedInput: LocalSyntheticValuationScenarioInput
) {
  if (unparsedInput.environment !== 'test_fixture') {
    throw new TypeError('Synthetic valuation scenarios are restricted to test_fixture.');
  }
  const definition = canonicalDefinition(unparsedInput.definition);
  const scenario = scenarioSchema.parse(unparsedInput.scenario);
  const assessedAt = z.string().datetime({ offset: true }).parse(unparsedInput.assessedAt);
  if (Date.parse(assessedAt) < Date.parse(definition.effectiveThrough)) {
    throw new RangeError('Synthetic scenario assessment cannot predate its evidence cutoff.');
  }
  const { lineageGraph, contributors } = buildLineage(definition);
  const componentDrawSet = createScenarioComponentDrawSet({
    definition,
    valuationBundleId: unparsedInput.valuationBundleId,
    scenario,
  });
  const template = createFabricatedAflTradeValuationFixture('two_party_player_swap');
  const basisId = definition.basis.basisId;
  const realizedContributionLedger = createAflTradeRealizedContributionLedger({
    ...structuredClone(template.realizedContributionLedger.content),
    valuationBundleId: unparsedInput.valuationBundleId,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    records: contributors
      .map((contributor, index) => ({
        contributionRecordId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          scenario,
          rootAssetId: contributor.rootAssetId,
          purpose: 'synthetic-realized-contribution',
        }),
        ...contributor,
        periodEndAt: definition.effectiveThrough,
        knownFrom: definition.effectiveThrough,
        knownTo: null,
        evidenceId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          scenario,
          rootAssetId: contributor.rootAssetId,
          purpose: 'synthetic-contribution-evidence',
        }),
        sourceObservationId: semanticId('artifact', basisId, {
          tradeId: definition.tradeId,
          scenario,
          rootAssetId: contributor.rootAssetId,
          purpose: 'synthetic-source-observation',
        }),
        contributionDefinitionId: 'synthetic-local-contribution-definition-v1',
        transformationVersion: 'synthetic-local-scenario-v1',
        state: 'observed' as const,
        contribution: scenario === 'baseline' ? index + 1 : contributors.length - index,
      }))
      .sort((left, right) => left.contributionRecordId.localeCompare(right.contributionRecordId)),
  });
  const packagePolicy = createAflTradePackagePolicy({
    ...structuredClone(template.packagePolicy.content),
    valuationBundleId: unparsedInput.valuationBundleId,
    clubUtility: {
      status: 'unavailable',
      reasonCode: 'synthetic-fixture-no-club-utility',
      explanation: 'Fabricated local values cannot establish real AFL club utility.',
    },
  });
  const current = {
    modelVintage: 'current' as const,
    effectiveAt: definition.effectiveThrough,
    knowledgeCutoffAt: definition.effectiveThrough,
    valuationAsOf: assessedAt,
  };
  const valuationCase = createAflTradeValuationCase({
    schemaVersion: 'afl-trade-valuation-case/v1',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    calculationUnit: 'complete_multi_party_trade',
    tradeId: definition.tradeId,
    tradeEffectiveAt: definition.effectiveAt,
    valuationBundleId: unparsedInput.valuationBundleId,
    lineageGraphId: createAflTradeLineageGraphId(lineageGraph),
    componentDrawSetId: componentDrawSet.componentDrawSetId,
    realizedContributionLedgerId: realizedContributionLedger.realizedContributionLedgerId,
    packagePolicyId: packagePolicy.packagePolicyId,
    valueUnitId: componentDrawSet.content.valueUnitId,
    parties: definition.parties.map((party) => ({
      ...party,
      receivedRootAssetIds: definition.transfers
        .filter(({ toClubId }) => toClubId === party.aflClubId)
        .map(({ assetId }) => assetId),
    })),
    viewContexts: [
      {
        view: 'at_trade',
        modelVintage: 'historical_restatement',
        effectiveAt: definition.effectiveAt,
        knowledgeCutoffAt: definition.effectiveAt,
        valuationAsOf: definition.effectiveAt,
      },
      { view: 'realized', ...current },
      { view: 'remaining', ...current },
      { view: 'current', ...current },
    ],
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection',
  });
  const calculation = calculateAflTradeValuation(
    valuationCase,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy
  );
  const snapshotDefinitions = template.snapshotSet.content.snapshots[0]!.content.definitions;
  const snapshotSet = createAflTradeValuationSnapshotSet(
    calculation,
    valuationCase,
    snapshotDefinitions,
    assessedAt
  );
  const explanation = createAflTradeStructuredExplanation(calculation, snapshotSet, valuationCase);
  const assumptionContent = {
    schemaVersion: 'local-synthetic-assumption-set/v1' as const,
    evidenceClassification: LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION,
    basis: definition.basis,
    tradeId: definition.tradeId,
    scenario,
    transferDirections: definition.transfers.map(
      ({ transferId, fromClubId, toClubId, assetId, directionBasis }) => ({
        transferId,
        fromClubId,
        toClubId,
        assetId,
        directionBasis,
      })
    ),
    contributionPolicy: 'deterministic_fixture_rank_v1' as const,
    createdAt: assessedAt,
    publicationEligible: false as const,
  };
  const assumptionSet = {
    assumptionSetId: createAflTradeContentAddress('artifact', assumptionContent),
    content: assumptionContent,
  };
  const validation = validateAflTradeValuationArtifactChain({
    valuationCase,
    lineageGraph,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    calculation,
    snapshotSet,
    explanation,
  });
  if (!validation.structurallyValid) {
    throw new TypeError('Synthetic valuation scenario failed structural validation.');
  }
  const scenarioId = createAflTradeContentAddress('artifact', {
    schemaVersion: 'local-synthetic-valuation-scenario/v1',
    assumptionSetId: assumptionSet.assumptionSetId,
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: calculation.valuationCalculationId,
    valuationSnapshotSetId: snapshotSet.valuationSnapshotSetId,
    structuredExplanationId: explanation.structuredExplanationId,
  });
  return Object.freeze({
    scenarioId,
    evidenceClassification: LOCAL_SYNTHETIC_VALUATION_EVIDENCE_CLASSIFICATION,
    definition,
    assumptionSet,
    lineageGraph,
    componentDrawSet,
    realizedContributionLedger,
    packagePolicy,
    valuationCase,
    calculation,
    snapshotSet,
    explanation,
    validation,
  });
}

export function createLocalSyntheticValuationScenario(input: LocalSyntheticValuationScenarioInput) {
  if (input.definition.basis.kind !== 'private_workbook') {
    throw new TypeError('Private synthetic valuation scenarios require private_workbook evidence.');
  }
  return Object.freeze({
    ...buildLocalSyntheticValuationArtifacts(input),
    authority: Object.freeze({
      kind: 'private_scenario' as const,
      publicationEligible: false as const,
      publicationProhibited: true as const,
    }),
  });
}

export function createLocalArchiveValuationPublicationFixtureArtifacts(
  input: LocalSyntheticValuationScenarioInput
) {
  if (input.definition.basis.kind !== 'test_fixture_archive') {
    throw new TypeError(
      'Archive publication fixture artifacts require test_fixture_archive evidence.'
    );
  }
  return Object.freeze({
    ...buildLocalSyntheticValuationArtifacts(input),
    fixtureAuthority: Object.freeze({
      kind: 'disposable_fixture_publication_rehearsal' as const,
      environment: 'test_fixture' as const,
      productionEligible: false as const,
    }),
  });
}
