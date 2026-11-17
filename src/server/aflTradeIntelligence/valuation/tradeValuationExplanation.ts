import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';

import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  authenticateGovernedPrivateEvaluationExplanationSource,
  type GovernedPrivateEvaluationExplanationSource,
} from './internal/governedPrivateEvaluationExplanationSource';
import { governedPrivateEvaluationExplanationPolicySchema } from './internal/governedPrivateEvaluationExplanationPolicy';
import { governedPrivateEvaluationInputTraceSchema } from './internal/governedPrivateEvaluationInputTrace';
import {
  deriveAflTradeStatlyGradesFromProbabilities,
  type AflTradeStatlyGrade,
  type AflTradeStatlyGradeState,
} from './statlyGradePolicy';
import {
  aflTradeValuationCalculationSchema,
  calculateAflTradeValuation,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import {
  aflTradeValuationCalculationInputPackageSchema,
} from './valuationCalculationInputPackage';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

export const AFL_TRADE_VALUATION_EXPLANATION_SCHEMA_VERSION =
  'afl-trade-valuation-explanation/v1' as const;

type ValuationView = (typeof AFL_TRADE_VALUATION_VIEWS)[number];
type SelectedLayer = 'gross' | 'listSpotAdjusted' | 'scarcityAdjusted';
type AssetKind = 'player' | 'current_pick' | 'future_pick';

export type AflTradeValuationExplanationAuthority =
  | {
      kind: 'private_synthetic';
      assumptionSetId: string;
      publicationProhibited: true;
      warning: 'Fabricated rank-based test values — not real AFL data.';
    }
  | GovernedPrivateEvaluationExplanationSource['authority'];

export interface AflTradeValuationExplanationTransfer {
  transferId: string;
  fromClubId: string;
  toClubId: string;
  assetId: string;
  assetKind: AssetKind;
  displayLabel: string;
  directionBasis:
    | 'two_party_other_club_assumption'
    | 'deterministic_fixture_transfer_map_v1'
    | 'archive_recorded_transfer';
}

export interface AflTradeValuationExplanationDirectionEvidence {
  assumptionSetId: string;
  content: {
    schemaVersion: 'local-synthetic-assumption-set/v1';
    evidenceClassification: 'fabricated_test_evidence_not_real_afl_data';
    basis: {
      kind: 'private_workbook' | 'test_fixture_archive';
      basisId: string;
    };
    tradeId: string;
    scenario: 'baseline' | 'replacement';
    valuationCaseId: string;
    valuationCalculationId: string;
    transferDirections: readonly AflTradeValuationExplanationTransfer[];
    contributionPolicy: 'deterministic_fixture_rank_v1';
    explanationPolicy: {
      schemaVersion: 'local-synthetic-explanation-policy/v1';
      valueUnitId: string;
      practicalEquivalenceBandByView: Record<ValuationView, number>;
      practicalEquivalenceBasis: string;
    };
    createdAt: string;
    effectiveAt: string;
    effectiveThrough: string;
    publicationEligible: false;
  };
}

const directionEvidenceSchema = z
  .object({
    assumptionSetId: z.string().regex(/^artifact:[a-f0-9]{64}$/u),
    content: z
      .object({
        schemaVersion: z.literal('local-synthetic-assumption-set/v1'),
        evidenceClassification: z.literal('fabricated_test_evidence_not_real_afl_data'),
        basis: z
          .object({
            kind: z.enum(['private_workbook', 'test_fixture_archive']),
            basisId: z.string().trim().min(1).max(200),
          })
          .strict(),
        tradeId: z.string().trim().min(1).max(200),
        scenario: z.enum(['baseline', 'replacement']),
        valuationCaseId: z.string().regex(/^valuation-case:[a-f0-9]{64}$/u),
        valuationCalculationId: z.string().regex(/^valuation-calculation:[a-f0-9]{64}$/u),
        transferDirections: z
          .array(
            z
              .object({
                transferId: z.string().trim().min(1).max(200),
                fromClubId: z.string().trim().min(1).max(200),
                toClubId: z.string().trim().min(1).max(200),
                assetId: z.string().trim().min(1).max(200),
                assetKind: z.enum(['player', 'current_pick', 'future_pick']),
                displayLabel: z.string().trim().min(1).max(240),
                directionBasis: z.enum([
                  'two_party_other_club_assumption',
                  'deterministic_fixture_transfer_map_v1',
                  'archive_recorded_transfer',
                ]),
              })
              .strict()
          )
          .min(2)
          .max(100),
        contributionPolicy: z.literal('deterministic_fixture_rank_v1'),
        explanationPolicy: z
          .object({
            schemaVersion: z.literal('local-synthetic-explanation-policy/v1'),
            valueUnitId: z.string().trim().min(1).max(200),
            practicalEquivalenceBandByView: z
              .object({
                at_trade: z.number().finite().nonnegative(),
                realized: z.number().finite().nonnegative(),
                remaining: z.number().finite().nonnegative(),
                current: z.number().finite().nonnegative(),
              })
              .strict(),
            practicalEquivalenceBasis: z.string().trim().min(1).max(500),
          })
          .strict(),
        createdAt: z.string().datetime({ offset: true }),
        effectiveAt: z.string().datetime({ offset: true }),
        effectiveThrough: z.string().datetime({ offset: true }),
        publicationEligible: z.literal(false),
      })
      .strict(),
  })
  .strict();

export interface AflTradeValuationDistributionSummary {
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

export interface AflTradeValuationAssetContribution {
  assetId: string;
  assetKind: AssetKind;
  label: string;
  fromClubId: string;
  toClubId: string;
  additiveMean: number;
  distribution: AflTradeValuationDistributionSummary;
  currentComponents: null | {
    realizedMean: number;
    remainingMean: number;
  };
  layers: {
    grossMean: number;
    listSpotAdjustedMean: number;
    scarcityAdjustedMean: number;
    listSpotDelta: number;
    scarcityDelta: number;
  };
  evidenceState: 'complete';
}

export interface AflTradeValuationAssetLedger {
  assets: readonly AflTradeValuationAssetContribution[];
  additiveMean: number;
  distribution: AflTradeValuationDistributionSummary;
}

export interface AflTradeValuationExplanationClub {
  aflClubId: string;
  clubName: string;
  received: AflTradeValuationAssetLedger;
  givenUp: AflTradeValuationAssetLedger;
  net: {
    additiveMean: number;
    distribution: AflTradeValuationDistributionSummary;
  };
  finishAheadProbability: number;
  grade: {
    grade: AflTradeStatlyGrade | null;
    state: AflTradeStatlyGradeState;
    reasonCode: string;
  };
}

export interface AflTradeValuationExplanationView {
  view: ValuationView;
  clubs: readonly AflTradeValuationExplanationClub[];
  verdict: {
    kind: 'favours_club' | 'shared_lead';
    aflClubIds: readonly string[];
  };
  practicalEquivalenceProbability: number;
}

export interface AflTradeValuationExplanationDocument {
  explanationId: string;
  schemaVersion: typeof AFL_TRADE_VALUATION_EXPLANATION_SCHEMA_VERSION;
  tradeId: string;
  defaultView: 'current';
  authority: AflTradeValuationExplanationAuthority;
  valueUnitId: string;
  valuationBundleId: string;
  valuationCaseId: string;
  valuationCalculationId: string;
  effectiveAt: string;
  effectiveThrough: string;
  coverage: {
    status: 'complete';
    ratio: 1;
  };
  confidenceLevel: 'unavailable' | 'low' | 'moderate' | 'high';
  selectedLayer: SelectedLayer;
  views: readonly AflTradeValuationExplanationView[];
  methodology: {
    additiveStatistic: 'probability_weighted_mean';
    uncertaintyStatistic: 'joint_draw_weighted_quantiles';
    packageMedianIsAdditive: false;
    assetGradeTreatment: 'prohibited';
    currentIdentity: 'realized_plus_remaining';
    practicalEquivalenceBasis: string;
    practicalEquivalencePolicy: {
      assumptionSetId?: string;
      explanationPolicyId?: string;
      valueUnitId: string;
      bandByView: Record<ValuationView, number>;
    };
  };
}

export interface CreateAflTradeValuationExplanationInput {
  admittedAssumptionSetId: string;
  directionEvidence: AflTradeValuationExplanationDirectionEvidence;
  valuationCase: AflTradeValuationCase;
  valuationCalculation: AflTradeValuationCalculation;
  selectedLayer: SelectedLayer;
  gradeContext: {
    confidenceLevel: 'low' | 'moderate' | 'high';
    developmentPreview: boolean;
  };
}

export interface CreateGovernedAflTradeValuationExplanationInput {
  trace: unknown;
  explanationPolicy: unknown;
  calculationInputPackage: unknown;
}

export type AflTradeValuationExplanationResult =
  | {
      state: 'available';
      document: AflTradeValuationExplanationDocument;
    }
  | {
      state: 'unavailable';
      tradeId: string;
      authority: AflTradeValuationExplanationAuthority;
      reasonCode: 'incomplete_numeric_evidence';
      explanation: string;
    };

interface WeightedValue {
  drawKey: string;
  weight: number;
  value: number;
}

interface PreparedAsset {
  contribution: AflTradeValuationAssetContribution;
  selectedSamples: readonly WeightedValue[];
}

interface ValidatedExplanationSource {
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
  authority: AflTradeValuationExplanationAuthority;
  transfers: readonly AflTradeValuationExplanationTransfer[];
  selectedLayer: SelectedLayer;
  gradeContext: CreateAflTradeValuationExplanationInput['gradeContext'] | null;
  effectiveAt: string;
  effectiveThrough: string;
  practicalEquivalenceBasis: string;
  practicalEquivalenceBandByView: Record<ValuationView, number>;
  practicalEquivalencePolicyReference:
    | { assumptionSetId: string }
    | { explanationPolicyId: string };
}

function contractViolation(message: string, cause?: unknown): never {
  throw new TypeError(`EXPLANATION_CONTRACT_VIOLATION: ${message}`, { cause });
}

function normalizeNumber(value: number): number {
  const normalized = Number(value.toFixed(12));
  return Math.abs(normalized) <= 1e-12 ? 0 : normalized;
}

function weightedQuantile(values: readonly WeightedValue[], probability: number): number {
  const ordered = [...values].sort(
    (left, right) => left.value - right.value || left.drawKey.localeCompare(right.drawKey)
  );
  const totalWeight = ordered.reduce((sum, item) => sum + item.weight, 0);
  const threshold = probability * totalWeight;
  let cumulative = 0;
  for (const item of ordered) {
    cumulative += item.weight;
    if (cumulative + 1e-12 >= threshold) return normalizeNumber(item.value);
  }
  return normalizeNumber(ordered.at(-1)!.value);
}

function summarize(values: readonly WeightedValue[]): AflTradeValuationDistributionSummary {
  if (values.length === 0) contractViolation('A distribution requires at least one draw.');
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    contractViolation('A distribution requires positive finite draw weight.');
  }
  return {
    mean: normalizeNumber(
      values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
    ),
    median: weightedQuantile(values, 0.5),
    p10: weightedQuantile(values, 0.1),
    p90: weightedQuantile(values, 0.9),
  };
}

function exactSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function rootSamples(input: {
  calculation: AflTradeValuationCalculation;
  transfer: AflTradeValuationExplanationTransfer;
  view: ValuationView;
  layer: SelectedLayer;
}): readonly WeightedValue[] | null {
  const samples: WeightedValue[] = [];
  for (const draw of input.calculation.content.draws) {
    const party = draw.parties.find(({ aflClubId }) => aflClubId === input.transfer.toClubId);
    const partyView = party?.views.find(({ view }) => view === input.view);
    const root = partyView?.roots.find(({ assetId }) => assetId === input.transfer.assetId);
    if (!party || !partyView || !root) {
      contractViolation(
        `Missing ${input.view} root ${input.transfer.assetId} for ${input.transfer.toClubId}.`
      );
    }
    if (root.universal.status !== 'available') return null;
    samples.push({
      drawKey: draw.drawKey,
      weight: draw.probabilityWeight,
      value: root.universal.layers[input.layer],
    });
  }
  return samples;
}

function addSamples(
  sampleSets: readonly (readonly WeightedValue[])[],
  calculation: AflTradeValuationCalculation
): readonly WeightedValue[] {
  return calculation.content.draws.map((draw, drawIndex) => ({
    drawKey: draw.drawKey,
    weight: draw.probabilityWeight,
    value: normalizeNumber(sampleSets.reduce((sum, samples) => sum + samples[drawIndex]!.value, 0)),
  }));
}

function subtractSamples(
  left: readonly WeightedValue[],
  right: readonly WeightedValue[]
): readonly WeightedValue[] {
  return left.map((sample, index) => ({
    ...sample,
    value: normalizeNumber(sample.value - right[index]!.value),
  }));
}

function validateSyntheticInput(
  input: CreateAflTradeValuationExplanationInput
): ValidatedExplanationSource {
  let valuationCase: AflTradeValuationCase;
  let calculation: AflTradeValuationCalculation;
  let directionEvidence: AflTradeValuationExplanationDirectionEvidence;
  try {
    valuationCase = aflTradeValuationCaseSchema.parse(input.valuationCase);
    calculation = aflTradeValuationCalculationSchema.parse(input.valuationCalculation);
    directionEvidence = directionEvidenceSchema.parse(input.directionEvidence);
  } catch (error) {
    contractViolation(
      'Valuation parents or direction evidence are malformed or content-address mismatched.',
      error
    );
  }

  if (
    calculation.content.valuationCaseId !== valuationCase.valuationCaseId ||
    calculation.content.valuationBundleId !== valuationCase.content.valuationBundleId ||
    calculation.content.valueUnitId !== valuationCase.content.valueUnitId
  ) {
    contractViolation('Calculation ancestry does not exactly match the valuation case.');
  }

  if (
    input.admittedAssumptionSetId !== directionEvidence.assumptionSetId ||
    createAflTradeContentAddress('artifact', directionEvidence.content) !==
      directionEvidence.assumptionSetId ||
    directionEvidence.content.evidenceClassification !==
      'fabricated_test_evidence_not_real_afl_data' ||
    directionEvidence.content.basis.kind !== 'private_workbook' ||
    directionEvidence.content.publicationEligible !== false ||
    directionEvidence.content.tradeId !== valuationCase.content.tradeId ||
    directionEvidence.content.valuationCaseId !== valuationCase.valuationCaseId ||
    directionEvidence.content.valuationCalculationId !== calculation.valuationCalculationId ||
    directionEvidence.content.effectiveAt !== valuationCase.content.viewContexts[0]!.effectiveAt ||
    directionEvidence.content.effectiveThrough !==
      valuationCase.content.viewContexts.find(({ view }) => view === 'current')!.effectiveAt ||
    directionEvidence.content.explanationPolicy.valueUnitId !== valuationCase.content.valueUnitId
  ) {
    contractViolation(
      'Transfer directions require exact private synthetic assumption-set ancestry.'
    );
  }
  const transfers = directionEvidence.content.transferDirections;
  const partyIds = valuationCase.content.parties.map(({ aflClubId }) => aflClubId);
  const partyIdSet = new Set(partyIds);
  const expectedAssetIds = valuationCase.content.parties.flatMap(
    ({ receivedRootAssetIds }) => receivedRootAssetIds
  );
  const transferIds = transfers.map(({ transferId }) => transferId);
  const transferAssetIds = transfers.map(({ assetId }) => assetId);
  if (
    transfers.length === 0 ||
    new Set(transferIds).size !== transferIds.length ||
    new Set(transferAssetIds).size !== transferAssetIds.length ||
    !exactSet(transferAssetIds, expectedAssetIds)
  ) {
    contractViolation('Directed transfers must exactly cover every valuation-case root once.');
  }
  for (const transfer of transfers) {
    const receiver = valuationCase.content.parties.find(
      ({ aflClubId }) => aflClubId === transfer.toClubId
    );
    if (
      transfer.fromClubId === transfer.toClubId ||
      !partyIdSet.has(transfer.fromClubId) ||
      !receiver?.receivedRootAssetIds.includes(transfer.assetId)
    ) {
      contractViolation('Every transfer must connect valid parties and its declared receiver.');
    }
    const canonicalReceiverIndex = partyIds.indexOf(transfer.toClubId);
    const expectedSender =
      partyIds[(canonicalReceiverIndex + partyIds.length - 1) % partyIds.length];
    if (
      transfer.fromClubId !== expectedSender ||
      (partyIds.length === 2 && transfer.directionBasis !== 'two_party_other_club_assumption') ||
      (partyIds.length > 2 && transfer.directionBasis !== 'deterministic_fixture_transfer_map_v1')
    ) {
      contractViolation(
        'Transfer directions must match the admitted deterministic mapping policy.'
      );
    }
  }
  for (const draw of calculation.content.draws) {
    if (
      !exactSet(
        draw.parties.map(({ aflClubId }) => aflClubId),
        partyIds
      )
    ) {
      contractViolation('Every calculation draw must exactly cover the valuation-case parties.');
    }
    for (const party of draw.parties) {
      const expectedRoots = valuationCase.content.parties.find(
        ({ aflClubId }) => aflClubId === party.aflClubId
      )!.receivedRootAssetIds;
      for (const view of party.views) {
        if (
          !exactSet(
            view.roots.map(({ assetId }) => assetId),
            expectedRoots
          )
        ) {
          contractViolation(
            'Every calculation draw view must exactly cover its valuation-case received roots.'
          );
        }
      }
    }
  }
  return {
    valuationCase,
    calculation,
    authority: {
      kind: 'private_synthetic',
      assumptionSetId: directionEvidence.assumptionSetId,
      publicationProhibited: true,
      warning: 'Fabricated rank-based test values — not real AFL data.',
    },
    transfers,
    selectedLayer: input.selectedLayer,
    gradeContext: input.gradeContext,
    effectiveAt: directionEvidence.content.effectiveAt,
    effectiveThrough: directionEvidence.content.effectiveThrough,
    practicalEquivalenceBasis:
      directionEvidence.content.explanationPolicy.practicalEquivalenceBasis,
    practicalEquivalenceBandByView:
      directionEvidence.content.explanationPolicy.practicalEquivalenceBandByView,
    practicalEquivalencePolicyReference: {
      assumptionSetId: directionEvidence.assumptionSetId,
    },
  };
}

function validateGovernedInput(
  input: CreateGovernedAflTradeValuationExplanationInput
): ValidatedExplanationSource {
  const trace = governedPrivateEvaluationInputTraceSchema.parse(input.trace);
  const explanationPolicy = governedPrivateEvaluationExplanationPolicySchema.parse(
    input.explanationPolicy
  );
  const calculationInputPackage = aflTradeValuationCalculationInputPackageSchema.parse(
    input.calculationInputPackage
  );
  if (calculationInputPackage.content.schemaVersion !== 'afl-trade-valuation-calculation-input-package/v2') {
    contractViolation('Governed explanation requires an authenticated v2 calculation input package.');
  }
  const source = authenticateGovernedPrivateEvaluationExplanationSource({
    trace,
    policy: explanationPolicy,
  });
  const packageContent = calculationInputPackage.content;
  const valuationCase = packageContent.valuationCase;
  const caseContent = valuationCase.content;
  const currentContext = caseContent.viewContexts.find(({ view }) => view === 'current')!;
  if (
    packageContent.authority.inputTraceId !== trace.inputTraceId ||
    packageContent.valuationInputBundleId !== trace.content.valuationInputBundleId ||
    packageContent.tradeId !== trace.content.selector.tradeId ||
    caseContent.tradeId !== source.selector.tradeId ||
    caseContent.tradeEffectiveAt !== source.effectiveAt ||
    caseContent.valueUnitId !== source.valueUnitId ||
    Date.parse(packageContent.createdAt) < Date.parse(trace.content.derivedAt) ||
    Date.parse(packageContent.createdAt) < Date.parse(explanationPolicy.content.createdAt)
  ) {
    contractViolation('Governed calculation package does not match its exact trace, policy, unit, or time ancestry.');
  }
  const tracedComponents = new Map(trace.content.components.map((component) => [component.role, component]));
  if (
    packageContent.componentDrawSet.content.components.some((component) => {
      const traced = tracedComponents.get(component.role);
      return (
        traced === undefined ||
        traced.runId !== component.runId ||
        traced.protocolId !== component.protocolId ||
        traced.datasetId !== component.datasetId ||
        traced.gate3DecisionId !== component.gate3DecisionId
      );
    })
  ) {
    contractViolation('Governed calculation components do not match the authenticated model ancestry.');
  }
  if (
    caseContent.parties.length !== source.clubs.length ||
    caseContent.parties.some((party) => {
      const club = source.clubs.find(({ aflClubId }) => aflClubId === party.aflClubId);
      return (
        club === undefined ||
        club.clubName !== party.clubName ||
        !exactSet(club.receivedAssetIds, party.receivedRootAssetIds)
      );
    }) ||
    !exactSet(
      source.transfers.map(({ assetId }) => assetId),
      caseContent.parties.flatMap(({ receivedRootAssetIds }) => receivedRootAssetIds)
    )
  ) {
    contractViolation('Governed transaction clubs and directed roots do not match the valuation case.');
  }
  const calculation = calculateAflTradeValuation(
    valuationCase,
    packageContent.componentDrawSet,
    packageContent.realizedContributionLedger,
    packageContent.packagePolicy
  );
  return {
    valuationCase,
    calculation,
    authority: source.authority,
    transfers: source.transfers,
    selectedLayer: source.selectedLayer,
    gradeContext: null,
    effectiveAt: source.effectiveAt,
    effectiveThrough: currentContext.effectiveAt,
    practicalEquivalenceBasis: source.practicalEquivalence.basis,
    practicalEquivalenceBandByView: source.practicalEquivalence.bandByView,
    practicalEquivalencePolicyReference: {
      explanationPolicyId: source.authority.explanationPolicyId,
    },
  };
}

function prepareAsset(
  calculation: AflTradeValuationCalculation,
  transfer: AflTradeValuationExplanationTransfer,
  view: ValuationView,
  selectedLayer: SelectedLayer
): PreparedAsset | null {
  const selectedSamples = rootSamples({ calculation, transfer, view, layer: selectedLayer });
  const grossSamples = rootSamples({ calculation, transfer, view, layer: 'gross' });
  const listSamples = rootSamples({ calculation, transfer, view, layer: 'listSpotAdjusted' });
  const scarcitySamples = rootSamples({ calculation, transfer, view, layer: 'scarcityAdjusted' });
  if (!selectedSamples || !grossSamples || !listSamples || !scarcitySamples) return null;

  const selected = summarize(selectedSamples);
  const grossMean = summarize(grossSamples).mean;
  const listSpotAdjustedMean = summarize(listSamples).mean;
  const scarcityAdjustedMean = summarize(scarcitySamples).mean;
  const realizedSamples =
    view === 'current'
      ? rootSamples({ calculation, transfer, view: 'realized', layer: selectedLayer })
      : null;
  const remainingSamples =
    view === 'current'
      ? rootSamples({ calculation, transfer, view: 'remaining', layer: selectedLayer })
      : null;
  if (view === 'current' && (!realizedSamples || !remainingSamples)) return null;
  const currentComponents =
    realizedSamples && remainingSamples
      ? {
          realizedMean: summarize(realizedSamples).mean,
          remainingMean: summarize(remainingSamples).mean,
        }
      : null;
  if (
    currentComponents &&
    Math.abs(selected.mean - (currentComponents.realizedMean + currentComponents.remainingMean)) >
      1e-8
  ) {
    contractViolation(`Current root ${transfer.assetId} does not equal realized plus remaining.`);
  }

  return {
    selectedSamples,
    contribution: {
      assetId: transfer.assetId,
      assetKind: transfer.assetKind,
      label: transfer.displayLabel,
      fromClubId: transfer.fromClubId,
      toClubId: transfer.toClubId,
      additiveMean: selected.mean,
      distribution: selected,
      currentComponents,
      layers: {
        grossMean,
        listSpotAdjustedMean,
        scarcityAdjustedMean,
        listSpotDelta: normalizeNumber(listSpotAdjustedMean - grossMean),
        scarcityDelta: normalizeNumber(scarcityAdjustedMean - listSpotAdjustedMean),
      },
      evidenceState: 'complete',
    },
  };
}

function prepareLedger(
  calculation: AflTradeValuationCalculation,
  transfers: readonly AflTradeValuationExplanationTransfer[],
  view: ValuationView,
  selectedLayer: SelectedLayer
): { ledger: AflTradeValuationAssetLedger; samples: readonly WeightedValue[] } | null {
  if (transfers.length === 0) {
    contractViolation('Every complete-exchange party must receive and surrender an asset.');
  }
  const prepared = [...transfers]
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map((transfer) => prepareAsset(calculation, transfer, view, selectedLayer));
  if (prepared.some((asset) => asset === null)) return null;
  const assets = prepared as PreparedAsset[];
  const samples = addSamples(
    assets.map(({ selectedSamples }) => selectedSamples),
    calculation
  );
  const distribution = summarize(samples);
  const additiveMean = normalizeNumber(
    assets.reduce((sum, asset) => sum + asset.contribution.additiveMean, 0)
  );
  if (Math.abs(additiveMean - distribution.mean) > 1e-8) {
    contractViolation('Asset contribution means do not reconcile to the package mean.');
  }
  return {
    samples,
    ledger: {
      assets: assets.map(({ contribution }) => contribution),
      additiveMean,
      distribution,
    },
  };
}

function buildViews(input: {
  source: ValidatedExplanationSource;
  valuationCase: AflTradeValuationCase;
  calculation: AflTradeValuationCalculation;
  transfers: readonly AflTradeValuationExplanationTransfer[];
}): readonly AflTradeValuationExplanationView[] | null {
  return AFL_TRADE_VALUATION_VIEWS.map((view) => {
    const packages = input.valuationCase.content.parties.map((party) => {
      const received = prepareLedger(
        input.calculation,
        input.transfers.filter(({ toClubId }) => toClubId === party.aflClubId),
        view,
        input.source.selectedLayer
      );
      const givenUp = prepareLedger(
        input.calculation,
        input.transfers.filter(({ fromClubId }) => fromClubId === party.aflClubId),
        view,
        input.source.selectedLayer
      );
      if (!received || !givenUp) return null;
      const netSamples = subtractSamples(received.samples, givenUp.samples);
      return {
        party,
        received,
        givenUp,
        netSamples,
        netDistribution: summarize(netSamples),
      };
    });
    if (packages.some((candidate) => candidate === null)) return null;
    const completePackages = packages.filter((candidate) => candidate !== null);
    const finishAheadProbabilities = completePackages.map(() => 0);
    let practicalEquivalenceProbability = 0;
    const practicalEquivalenceBand =
      input.source.practicalEquivalenceBandByView[view];
    input.calculation.content.draws.forEach((draw, drawIndex) => {
      const values = completePackages.map((item) => item.netSamples[drawIndex]!.value);
      const maximum = Math.max(...values);
      const minimum = Math.min(...values);
      if (maximum - minimum <= practicalEquivalenceBand + 1e-12) {
        practicalEquivalenceProbability += draw.probabilityWeight;
        return;
      }
      const leaders = values
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => Math.abs(value - maximum) <= 1e-12)
        .map(({ index }) => index);
      leaders.forEach((leaderIndex) => {
        finishAheadProbabilities[leaderIndex] += draw.probabilityWeight / leaders.length;
      });
    });
    practicalEquivalenceProbability = normalizeNumber(practicalEquivalenceProbability);
    finishAheadProbabilities.forEach((probability, index) => {
      finishAheadProbabilities[index] = normalizeNumber(probability);
    });
    const gradeResult = input.source.gradeContext
      ? deriveAflTradeStatlyGradesFromProbabilities({
          view,
          availability: 'available',
          clubs: completePackages.map((item, index) => ({
            aflClubId: item.party.aflClubId,
            clubName: item.party.clubName,
            finishesAheadProbability: finishAheadProbabilities[index]!,
          })),
          confidenceLevel: input.source.gradeContext.confidenceLevel,
          coverageRatio: 1,
          coverageStatus: 'complete',
          developmentPreview: input.source.gradeContext.developmentPreview,
          practicalEquivalenceProbability,
        })
      : null;
    const highestProbability = Math.max(...finishAheadProbabilities);
    const leaders = completePackages
      .filter(
        (_item, index) => Math.abs(finishAheadProbabilities[index]! - highestProbability) <= 1e-12
      )
      .map(({ party }) => party.aflClubId);
    return {
      view,
      practicalEquivalenceProbability,
      verdict: {
        kind: leaders.length === 1 ? ('favours_club' as const) : ('shared_lead' as const),
        aflClubIds: leaders,
      },
      clubs: completePackages.map((item, index) => {
        const grade = gradeResult?.clubs.find(
          ({ aflClubId }) => aflClubId === item.party.aflClubId
        );
        return {
          aflClubId: item.party.aflClubId,
          clubName: item.party.clubName,
          received: item.received.ledger,
          givenUp: item.givenUp.ledger,
          net: {
            additiveMean: normalizeNumber(
              item.received.ledger.additiveMean - item.givenUp.ledger.additiveMean
            ),
            distribution: item.netDistribution,
          },
          finishAheadProbability: finishAheadProbabilities[index]!,
          grade: {
            grade: grade?.grade ?? null,
            state: grade?.state ?? 'unavailable',
            reasonCode: gradeResult?.reasonCode ?? 'grade_confidence_authority_unavailable',
          },
        };
      }),
    };
  }).filter((view): view is NonNullable<typeof view> => view !== null);
}

function createExplanationDocument(
  source: ValidatedExplanationSource
): AflTradeValuationExplanationResult {
  const { valuationCase, calculation, authority, transfers } = source;
  const views = buildViews({ source, valuationCase, calculation, transfers });
  if (!views || views.length !== AFL_TRADE_VALUATION_VIEWS.length) {
    return {
      state: 'unavailable',
      tradeId: valuationCase.content.tradeId,
      authority,
      reasonCode: 'incomplete_numeric_evidence',
      explanation:
        'At least one required asset value is unavailable; no zero or partial package grade was created.',
    };
  }
  const content = {
    schemaVersion: AFL_TRADE_VALUATION_EXPLANATION_SCHEMA_VERSION,
    tradeId: valuationCase.content.tradeId,
    defaultView: 'current' as const,
    authority,
    valueUnitId: valuationCase.content.valueUnitId,
    valuationBundleId: valuationCase.content.valuationBundleId,
    valuationCaseId: valuationCase.valuationCaseId,
    valuationCalculationId: calculation.valuationCalculationId,
    effectiveAt: source.effectiveAt,
    effectiveThrough: source.effectiveThrough,
    coverage: {
      status: 'complete' as const,
      ratio: 1 as const,
    },
    confidenceLevel: source.gradeContext?.confidenceLevel ?? ('unavailable' as const),
    selectedLayer: source.selectedLayer,
    views,
    methodology: {
      additiveStatistic: 'probability_weighted_mean' as const,
      uncertaintyStatistic: 'joint_draw_weighted_quantiles' as const,
      packageMedianIsAdditive: false as const,
      assetGradeTreatment: 'prohibited' as const,
      currentIdentity: 'realized_plus_remaining' as const,
      practicalEquivalenceBasis: source.practicalEquivalenceBasis,
      practicalEquivalencePolicy: {
        ...source.practicalEquivalencePolicyReference,
        valueUnitId: valuationCase.content.valueUnitId,
        bandByView: source.practicalEquivalenceBandByView,
      },
    },
  };
  return {
    state: 'available',
    document: {
      explanationId: createAflTradeContentAddress('valuation-explanation', content),
      ...content,
    },
  };
}

export function createAflTradeValuationExplanation(
  input: CreateAflTradeValuationExplanationInput
): AflTradeValuationExplanationResult {
  return createExplanationDocument(validateSyntheticInput(input));
}

export function createGovernedAflTradeValuationExplanation(
  input: CreateGovernedAflTradeValuationExplanationInput
): AflTradeValuationExplanationResult {
  return createExplanationDocument(validateGovernedInput(input));
}
