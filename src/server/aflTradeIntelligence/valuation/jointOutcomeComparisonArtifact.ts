import { z } from 'zod';

import { AFL_TRADE_VALUATION_VIEWS } from '@/types/aflTradeIntelligence';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { aflTradeValuationViewContextSchema } from '../artifacts/valuationBundleManifest';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import {
  AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
  aflTradeJointOutcomeComparisonSchema,
  calculateAflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparisonInput,
} from './jointOutcomeComparison';
import {
  AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
  aflTradeJointOutcomeValueQuantizationPolicySchema,
  quantizeAflTradeJointOutcomeValue,
  type AflTradeJointOutcomeValueQuantizationPolicy,
} from './jointOutcomeValueQuantization';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

export const AFL_TRADE_VALUATION_COMPARISON_SCHEMA_VERSION =
  'afl-trade-valuation-comparison/v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_IDENTITY_BINDING =
  'identity_bound_outside_identity_free_joint_outcome_kernel_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_DERIVATION_VERSION =
  'valuation_calculation_draw_projection_to_joint_outcome_comparison_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_SUBJECT_BINDING =
  'valuation_case_receiving_afl_club_packages_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_DRAW_DIGEST_DEFINITION =
  'canonical_draw_key_probability_weight_pairs_sha256_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_OBSERVATION_DIGEST_DEFINITION =
  'canonical_quantized_joint_outcome_observations_sha256_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_QUANTIZATION_DIGEST_DEFINITION =
  'canonical_quantization_policy_sha256_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_VERIFICATION_SCOPE =
  'comparison_to_case_and_calculation_replay_only_upstream_calculation_provenance_requires_separate_validation_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_MISSINGNESS_TREATMENT =
  'unavailable_stays_unavailable_partial_values_never_substituted_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_SCHEMA_VERSION =
  'afl-trade-valuation-snapshot/v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_COMPATIBILITY =
  'parallel_successor_no_lossless_upcast_v1' as const;
export const AFL_TRADE_VALUATION_COMPARISON_LIMITATION =
  'Immutable source-independent comparison artifact only; it is not source approval, model calibration, Gate approval, or publication readiness.' as const;

export const AFL_TRADE_VALUATION_COMPARISON_VALUE_PATHS = [
  'package.universal.layers.gross',
  'package.universal.layers.listSpotAdjusted',
  'package.universal.layers.scarcityAdjusted',
] as const;

const valuePathSchema = z.enum(AFL_TRADE_VALUATION_COMPARISON_VALUE_PATHS);

export const aflTradeValuationComparisonMeasureSchema = z
  .object({
    kind: z.literal('universal_football_value'),
    layer: z.enum(['gross', 'list_spot_adjusted', 'scarcity_adjusted']),
  })
  .strict();

const comparisonCoordinatesSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    measure: aflTradeValuationComparisonMeasureSchema,
  })
  .strict();

const partyRootFrontierSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    rootAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict()
  .superRefine((frontier, context) => {
    const canonicalRootAssetIds = [...new Set(frontier.rootAssetIds)].sort(
      compareAflTradeCodeUnits
    );
    if (
      frontier.rootAssetIds.length !== canonicalRootAssetIds.length ||
      frontier.rootAssetIds.some(
        (rootAssetId, index) => rootAssetId !== canonicalRootAssetIds[index]
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rootAssetIds'],
        message: 'Comparison root frontiers must be unique and use canonical code-unit order.',
      });
    }
  });

export const aflTradeValuationComparisonDerivationReceiptSchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_VALUATION_COMPARISON_DERIVATION_VERSION),
    subjectBinding: z.literal(AFL_TRADE_VALUATION_COMPARISON_SUBJECT_BINDING),
    drawDigestDefinition: z.literal(AFL_TRADE_VALUATION_COMPARISON_DRAW_DIGEST_DEFINITION),
    observationDigestDefinition: z.literal(
      AFL_TRADE_VALUATION_COMPARISON_OBSERVATION_DIGEST_DEFINITION
    ),
    quantizationDigestDefinition: z.literal(
      AFL_TRADE_VALUATION_COMPARISON_QUANTIZATION_DIGEST_DEFINITION
    ),
    verificationScope: z.literal(AFL_TRADE_VALUATION_COMPARISON_VERIFICATION_SCOPE),
    missingnessTreatment: z.literal(AFL_TRADE_VALUATION_COMPARISON_MISSINGNESS_TREATMENT),
    valuePath: valuePathSchema,
    coordinates: comparisonCoordinatesSchema,
    partyRootFrontiers: z.array(partyRootFrontierSchema).min(2).max(18),
    drawCount: z.number().int().min(1).max(100_000),
    drawMeasureSha256: aflTradeSha256Schema,
    observationSha256: aflTradeSha256Schema,
    quantizationPolicy: aflTradeJointOutcomeValueQuantizationPolicySchema,
    quantizationPolicySha256: aflTradeSha256Schema,
    quantizerDefinitionVersion: z.literal(
      AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION
    ),
    kernelValueScaleDefinitionVersion: z.literal(
      AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION
    ),
    clearLeaderToleranceQuanta: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const clubIds = receipt.partyRootFrontiers.map((frontier) => frontier.aflClubId);
    const canonicalClubIds = [...new Set(clubIds)].sort(compareAflTradeCodeUnits);
    if (
      clubIds.length !== canonicalClubIds.length ||
      clubIds.some((aflClubId, index) => aflClubId !== canonicalClubIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['partyRootFrontiers'],
        message: 'Comparison party frontiers must be unique and use canonical AFL-club order.',
      });
    }
    if (receipt.quantizationPolicy.definitionVersion !== receipt.quantizerDefinitionVersion) {
      context.addIssue({
        code: 'custom',
        path: ['quantizerDefinitionVersion'],
        message: 'The quantizer receipt must match the selected quantization policy.',
      });
    }
    if (
      sha256AflTradeCanonicalJson(receipt.quantizationPolicy) !== receipt.quantizationPolicySha256
    ) {
      context.addIssue({
        code: 'custom',
        path: ['quantizationPolicySha256'],
        message: 'The quantization-policy digest must match its canonical policy.',
      });
    }
  });

function expectedValuePath(
  measure: AflTradeValuationComparisonMeasure
): AflTradeValuationComparisonValuePath {
  const layer =
    measure.layer === 'list_spot_adjusted'
      ? 'listSpotAdjusted'
      : measure.layer === 'scarcity_adjusted'
        ? 'scarcityAdjusted'
        : 'gross';
  return `package.universal.layers.${layer}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const aflTradeValuationComparisonContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_COMPARISON_SCHEMA_VERSION),
    identityBinding: z.literal(AFL_TRADE_VALUATION_COMPARISON_IDENTITY_BINDING),
    publicAssetBoundary: z.literal(AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY),
    comparisonValueScope: z.literal(AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    tradeId: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    viewContext: aflTradeValuationViewContextSchema,
    measure: aflTradeValuationComparisonMeasureSchema,
    derivation: aflTradeValuationComparisonDerivationReceiptSchema,
    comparison: aflTradeJointOutcomeComparisonSchema,
    predecessor: z
      .object({
        schemaVersion: z.literal(AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_SCHEMA_VERSION),
        compatibility: z.literal(AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_COMPATIBILITY),
      })
      .strict(),
    limitation: z.literal(AFL_TRADE_VALUATION_COMPARISON_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      content.derivation.coordinates.view !== content.viewContext.view ||
      canonicalizeAflTradeJson(content.derivation.coordinates.measure) !==
        canonicalizeAflTradeJson(content.measure)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'coordinates'],
        message: 'Comparison derivation coordinates must match the artifact view and measure.',
      });
    }
    if (content.derivation.valuePath !== expectedValuePath(content.measure)) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'valuePath'],
        message: 'The comparison value path must match the universal football-value layer.',
      });
    }
    if (
      content.comparison.publicAssetBoundary !== content.publicAssetBoundary ||
      content.comparison.comparisonValueScope !== content.comparisonValueScope ||
      content.comparison.valueUnitId !== content.valueUnitId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['comparison'],
        message:
          'The joint outcome kernel boundary, scope, and value unit must match the artifact.',
      });
    }
    if (
      content.comparison.drawCount !== content.derivation.drawCount ||
      content.comparison.clearLeaderToleranceQuanta !==
        content.derivation.clearLeaderToleranceQuanta
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivation'],
        message: 'The comparison draw count and tolerance must match the derivation receipt.',
      });
    }
    if (
      content.comparison.valueScale.definitionVersion !==
        content.derivation.kernelValueScaleDefinitionVersion ||
      content.comparison.valueScale.decimalPlaces !==
        content.derivation.quantizationPolicy.decimalPlaces
    ) {
      context.addIssue({
        code: 'custom',
        path: ['comparison', 'valueScale'],
        message: 'The comparison value scale must match the quantization receipt.',
      });
    }
    const frontierClubIds = content.derivation.partyRootFrontiers.map(
      (frontier) => frontier.aflClubId
    );
    if (!sameStrings(content.comparison.aflClubIds, frontierClubIds)) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'partyRootFrontiers'],
        message: 'The derivation must bind every compared receiving AFL club exactly once.',
      });
    }
  });

export const aflTradeValuationComparisonSchema = z
  .object({
    valuationComparisonId: aflTradeContentAddressedIdSchema('valuation-comparison'),
    content: aflTradeValuationComparisonContentSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    addAflTradeContentAddressIssue(
      'valuation-comparison',
      artifact.valuationComparisonId,
      artifact.content,
      context,
      ['valuationComparisonId']
    );
  });

export type AflTradeValuationComparisonMeasure = z.infer<
  typeof aflTradeValuationComparisonMeasureSchema
>;
export type AflTradeValuationComparisonValuePath =
  (typeof AFL_TRADE_VALUATION_COMPARISON_VALUE_PATHS)[number];
export type AflTradeValuationComparisonDerivationReceipt = z.infer<
  typeof aflTradeValuationComparisonDerivationReceiptSchema
>;
export type AflTradeValuationComparisonContent = z.infer<
  typeof aflTradeValuationComparisonContentSchema
>;
export type AflTradeValuationComparison = z.infer<typeof aflTradeValuationComparisonSchema>;

export const AFL_TRADE_VALUATION_COMPARISON_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_VALUATION_CASE',
  'INVALID_VALUATION_CALCULATION',
  'INVALID_VIEW',
  'INVALID_MEASURE',
  'INVALID_QUANTIZATION_POLICY',
  'INVALID_CLEAR_LEADER_TOLERANCE',
  'CALCULATION_PARENT_LINEAGE_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'CALCULATION_DRAW_FRONTIER_MISMATCH',
  'VALUE_QUANTIZATION_FAILURE',
  'JOINT_OUTCOME_COMPARISON_CALCULATION_FAILURE',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeValuationComparisonConstructionErrorCode =
  (typeof AFL_TRADE_VALUATION_COMPARISON_CONSTRUCTION_ERROR_CODES)[number];

const CONSTRUCTION_ERROR_MESSAGES: Readonly<
  Record<AflTradeValuationComparisonConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The valuation-comparison input envelope is invalid.',
  INVALID_VALUATION_CASE: 'The valuation case is invalid.',
  INVALID_VALUATION_CALCULATION: 'The valuation calculation is invalid.',
  INVALID_VIEW: 'The requested valuation view is invalid.',
  INVALID_MEASURE: 'The valuation-comparison measure is invalid.',
  INVALID_QUANTIZATION_POLICY: 'The joint-outcome quantization policy is invalid.',
  INVALID_CLEAR_LEADER_TOLERANCE: 'The clear-leader tolerance is invalid.',
  CALCULATION_PARENT_LINEAGE_MISMATCH:
    'The valuation calculation does not match every valuation-case parent reference.',
  PUBLIC_ASSET_BOUNDARY_MISMATCH:
    'The valuation case and calculation do not use the required public-asset boundary.',
  CALCULATION_DRAW_FRONTIER_MISMATCH:
    'A valuation-calculation draw does not match the case AFL-club and trade-root frontier.',
  VALUE_QUANTIZATION_FAILURE:
    'A projected universal football value could not be represented by the governed quantizer.',
  JOINT_OUTCOME_COMPARISON_CALCULATION_FAILURE:
    'The projected observations could not produce a joint outcome comparison.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The valuation-comparison artifact failed its internal contract.',
});

const TRUSTED_CONSTRUCTION_ERRORS = new WeakSet<object>();

export class AflTradeValuationComparisonConstructionError extends Error {
  readonly code: AflTradeValuationComparisonConstructionErrorCode;

  constructor(code: AflTradeValuationComparisonConstructionErrorCode) {
    super(CONSTRUCTION_ERROR_MESSAGES[code]);
    this.name = 'AflTradeValuationComparisonConstructionError';
    this.code = code;
    TRUSTED_CONSTRUCTION_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeValuationComparisonConstructionError';
    code: AflTradeValuationComparisonConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeValuationComparisonConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeValuationComparisonConstructionError(
  value: unknown
): value is AflTradeValuationComparisonConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_CONSTRUCTION_ERRORS.has(value);
}

export interface CreateAflTradeValuationComparisonInput {
  valuationCase: unknown;
  valuationCalculation: unknown;
  view: unknown;
  measure: unknown;
  quantizationPolicy: unknown;
  clearLeaderToleranceQuanta: unknown;
}

const CREATE_INPUT_KEYS = [
  'valuationCase',
  'valuationCalculation',
  'view',
  'measure',
  'quantizationPolicy',
  'clearLeaderToleranceQuanta',
] as const;
type CreateInputKey = (typeof CREATE_INPUT_KEYS)[number];
type CreateInputSnapshot = Record<CreateInputKey, unknown>;
const CREATE_INPUT_KEY_SET = new Set<string>(CREATE_INPUT_KEYS);

function snapshotExactEnvelope(value: unknown): CreateInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== CREATE_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !CREATE_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as CreateInputSnapshot;
    for (const key of CREATE_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function constructionError(
  code: AflTradeValuationComparisonConstructionErrorCode
): AflTradeValuationComparisonConstructionError {
  return new AflTradeValuationComparisonConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeValuationComparisonConstructionErrorCode
): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Invalid inputs never expose arbitrary native causes or hostile proxy failures.
  }
  throw constructionError(code);
}

function assertParentLineage(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
): void {
  if (
    calculation.content.valuationCaseId !== valuationCase.valuationCaseId ||
    calculation.content.valuationBundleId !== valuationCase.content.valuationBundleId ||
    calculation.content.componentDrawSetId !== valuationCase.content.componentDrawSetId ||
    calculation.content.realizedContributionLedgerId !==
      valuationCase.content.realizedContributionLedgerId ||
    calculation.content.packagePolicyId !== valuationCase.content.packagePolicyId ||
    calculation.content.valueUnitId !== valuationCase.content.valueUnitId
  ) {
    throw constructionError('CALCULATION_PARENT_LINEAGE_MISMATCH');
  }
  if (
    valuationCase.content.publicAssetBoundary !== AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY ||
    calculation.content.publicAssetBoundary !== AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY
  ) {
    throw constructionError('PUBLIC_ASSET_BOUNDARY_MISMATCH');
  }
}

function assertDrawFrontiers(
  valuationCase: AflTradeValuationCase,
  calculation: AflTradeValuationCalculation
): void {
  const expectedClubIds = valuationCase.content.parties.map((party) => party.aflClubId);
  const rootsByClub = new Map(
    valuationCase.content.parties.map((party) => [party.aflClubId, party.receivedRootAssetIds])
  );
  for (const draw of calculation.content.draws) {
    if (
      !sameStrings(
        draw.parties.map((party) => party.aflClubId),
        expectedClubIds
      )
    ) {
      throw constructionError('CALCULATION_DRAW_FRONTIER_MISMATCH');
    }
    for (const party of draw.parties) {
      const expectedRoots = rootsByClub.get(party.aflClubId);
      if (
        !expectedRoots ||
        party.views.some(
          (view) =>
            !sameStrings(
              view.roots.map((root) => root.assetId),
              expectedRoots
            )
        )
      ) {
        throw constructionError('CALCULATION_DRAW_FRONTIER_MISMATCH');
      }
    }
  }
}

function canonicalReasonCodes(reasonCodes: readonly string[]): string[] {
  return [...new Set(reasonCodes)].sort(compareAflTradeCodeUnits);
}

function selectedUniversalValue(
  layers: { gross: number; listSpotAdjusted: number; scarcityAdjusted: number },
  measure: AflTradeValuationComparisonMeasure
): number {
  return measure.layer === 'list_spot_adjusted'
    ? layers.listSpotAdjusted
    : measure.layer === 'scarcity_adjusted'
      ? layers.scarcityAdjusted
      : layers.gross;
}

function projectComparisonDraws(
  calculation: AflTradeValuationCalculation,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  measure: AflTradeValuationComparisonMeasure,
  quantizationPolicy: AflTradeJointOutcomeValueQuantizationPolicy
): AflTradeJointOutcomeComparisonInput['draws'] {
  return calculation.content.draws
    .map((draw) => ({
      drawKey: draw.drawKey,
      probabilityWeight: draw.probabilityWeight,
      parties: draw.parties.map((party) => {
        const universal = party.views.find((candidate) => candidate.view === view)!.universal;
        return {
          aflClubId: party.aflClubId,
          observation:
            universal.status === 'unavailable'
              ? {
                  status: 'unavailable' as const,
                  reasonCodes: canonicalReasonCodes(universal.reasonCodes),
                }
              : {
                  status: 'available' as const,
                  valueQuanta: quantizeAflTradeJointOutcomeValue(
                    selectedUniversalValue(universal.layers, measure),
                    quantizationPolicy
                  ),
                },
        };
      }),
    }))
    .sort((left, right) => compareAflTradeCodeUnits(left.drawKey, right.drawKey));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeValuationComparison(
  unparsedInput: unknown
): AflTradeValuationComparison {
  try {
    const snapshot = snapshotExactEnvelope(unparsedInput);
    if (snapshot === null) throw constructionError('INVALID_INPUT_ENVELOPE');

    const valuationCase = parseOrThrow(
      aflTradeValuationCaseSchema,
      snapshot.valuationCase,
      'INVALID_VALUATION_CASE'
    );
    const valuationCalculation = parseOrThrow(
      aflTradeValuationCalculationSchema,
      snapshot.valuationCalculation,
      'INVALID_VALUATION_CALCULATION'
    );
    const view = parseOrThrow(z.enum(AFL_TRADE_VALUATION_VIEWS), snapshot.view, 'INVALID_VIEW');
    const measure = parseOrThrow(
      aflTradeValuationComparisonMeasureSchema,
      snapshot.measure,
      'INVALID_MEASURE'
    );
    const quantizationPolicy = parseOrThrow(
      aflTradeJointOutcomeValueQuantizationPolicySchema,
      snapshot.quantizationPolicy,
      'INVALID_QUANTIZATION_POLICY'
    );
    const clearLeaderToleranceQuanta = parseOrThrow(
      z.number().int().safe().nonnegative(),
      snapshot.clearLeaderToleranceQuanta,
      'INVALID_CLEAR_LEADER_TOLERANCE'
    );

    assertParentLineage(valuationCase, valuationCalculation);
    assertDrawFrontiers(valuationCase, valuationCalculation);

    const viewContext = valuationCase.content.viewContexts.find(
      (candidate) => candidate.view === view
    );
    if (!viewContext) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');

    let draws: AflTradeJointOutcomeComparisonInput['draws'];
    try {
      draws = projectComparisonDraws(valuationCalculation, view, measure, quantizationPolicy);
    } catch {
      throw constructionError('VALUE_QUANTIZATION_FAILURE');
    }

    const aflClubIds = valuationCase.content.parties.map((party) => party.aflClubId);
    let comparison: AflTradeJointOutcomeComparison;
    try {
      comparison = calculateAflTradeJointOutcomeComparison({
        inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
        publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
        comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
        outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
        valueUnitId: valuationCase.content.valueUnitId,
        valueScale: {
          definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
          decimalPlaces: quantizationPolicy.decimalPlaces,
        },
        aflClubIds,
        clearLeaderToleranceQuanta,
        draws,
      });
    } catch {
      throw constructionError('JOINT_OUTCOME_COMPARISON_CALCULATION_FAILURE');
    }

    const drawMeasure = draws.map(({ drawKey, probabilityWeight }) => ({
      drawKey,
      probabilityWeight,
    }));
    const derivation: AflTradeValuationComparisonDerivationReceipt = {
      definitionVersion: AFL_TRADE_VALUATION_COMPARISON_DERIVATION_VERSION,
      subjectBinding: AFL_TRADE_VALUATION_COMPARISON_SUBJECT_BINDING,
      drawDigestDefinition: AFL_TRADE_VALUATION_COMPARISON_DRAW_DIGEST_DEFINITION,
      observationDigestDefinition: AFL_TRADE_VALUATION_COMPARISON_OBSERVATION_DIGEST_DEFINITION,
      quantizationDigestDefinition: AFL_TRADE_VALUATION_COMPARISON_QUANTIZATION_DIGEST_DEFINITION,
      verificationScope: AFL_TRADE_VALUATION_COMPARISON_VERIFICATION_SCOPE,
      missingnessTreatment: AFL_TRADE_VALUATION_COMPARISON_MISSINGNESS_TREATMENT,
      valuePath: expectedValuePath(measure),
      coordinates: { view, measure },
      partyRootFrontiers: valuationCase.content.parties.map((party) => ({
        aflClubId: party.aflClubId,
        rootAssetIds: [...party.receivedRootAssetIds],
      })),
      drawCount: draws.length,
      drawMeasureSha256: sha256AflTradeCanonicalJson(drawMeasure),
      observationSha256: sha256AflTradeCanonicalJson(draws),
      quantizationPolicy,
      quantizationPolicySha256: sha256AflTradeCanonicalJson(quantizationPolicy),
      quantizerDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_QUANTIZATION_DEFINITION_VERSION,
      kernelValueScaleDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
      clearLeaderToleranceQuanta,
    };

    const parsedContent = aflTradeValuationComparisonContentSchema.safeParse({
      schemaVersion: AFL_TRADE_VALUATION_COMPARISON_SCHEMA_VERSION,
      identityBinding: AFL_TRADE_VALUATION_COMPARISON_IDENTITY_BINDING,
      publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
      comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: valuationCalculation.valuationCalculationId,
      valuationBundleId: valuationCase.content.valuationBundleId,
      lineageGraphId: valuationCase.content.lineageGraphId,
      componentDrawSetId: valuationCase.content.componentDrawSetId,
      realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
      packagePolicyId: valuationCase.content.packagePolicyId,
      tradeId: valuationCase.content.tradeId,
      valueUnitId: valuationCase.content.valueUnitId,
      viewContext,
      measure,
      derivation,
      comparison,
      predecessor: {
        schemaVersion: AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_SCHEMA_VERSION,
        compatibility: AFL_TRADE_VALUATION_COMPARISON_PREDECESSOR_COMPATIBILITY,
      },
      limitation: AFL_TRADE_VALUATION_COMPARISON_LIMITATION,
    });
    if (!parsedContent.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }

    const parsedArtifact = aflTradeValuationComparisonSchema.safeParse({
      valuationComparisonId: createAflTradeContentAddress(
        'valuation-comparison',
        parsedContent.data
      ),
      content: parsedContent.data,
    });
    if (!parsedArtifact.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(parsedArtifact.data);
  } catch (error) {
    if (isAflTradeValuationComparisonConstructionError(error)) throw error;
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = ['valuationComparison', 'valuationCase', 'valuationCalculation'] as const;
type VerifyInputKey = (typeof VERIFY_INPUT_KEYS)[number];
type VerifyInputSnapshot = Record<VerifyInputKey, unknown>;
const VERIFY_INPUT_KEY_SET = new Set<string>(VERIFY_INPUT_KEYS);

function snapshotVerifyEnvelope(value: unknown): VerifyInputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== VERIFY_INPUT_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !VERIFY_INPUT_KEY_SET.has(key))
    ) {
      return null;
    }
    const snapshot = {} as VerifyInputSnapshot;
    for (const key of VERIFY_INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

export function verifyAflTradeValuationComparisonCaseCalculationDerivation(
  input: unknown
): boolean {
  try {
    const snapshot = snapshotVerifyEnvelope(input);
    if (snapshot === null) return false;
    const valuationComparison = aflTradeValuationComparisonSchema.safeParse(
      snapshot.valuationComparison
    );
    if (!valuationComparison.success) return false;
    const replayed = createAflTradeValuationComparison({
      valuationCase: snapshot.valuationCase,
      valuationCalculation: snapshot.valuationCalculation,
      view: valuationComparison.data.content.viewContext.view,
      measure: valuationComparison.data.content.measure,
      quantizationPolicy: valuationComparison.data.content.derivation.quantizationPolicy,
      clearLeaderToleranceQuanta:
        valuationComparison.data.content.derivation.clearLeaderToleranceQuanta,
    });
    return (
      replayed.valuationComparisonId === valuationComparison.data.valuationComparisonId &&
      canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(valuationComparison.data)
    );
  } catch {
    return false;
  }
}
