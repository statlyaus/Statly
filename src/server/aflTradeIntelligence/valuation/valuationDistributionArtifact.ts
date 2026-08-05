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
import { calculateAflTradeStructuralWeightedDistribution } from './structuralWeightedDistribution';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
  aflTradeStructuralWeightedDistributionPolicySchema,
  aflTradeStructuralWeightedDistributionSchema,
  type AflTradeStructuralWeightedDistribution,
  type AflTradeStructuralWeightedDistributionObservation,
} from './structuralWeightedDistributionContracts';
import { compareAflTradeCodeUnits } from './deterministicProbabilityMeasure';
import {
  aflTradeValuationCalculationSchema,
  type AflTradeValuationCalculation,
} from './tradeValuationCalculation';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

export const AFL_TRADE_VALUATION_DISTRIBUTION_SCHEMA_VERSION =
  'afl-trade-valuation-distribution/v2' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_IDENTITY_BINDING =
  'identity_bound_outside_identity_free_scalar_kernel_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_DERIVATION_VERSION =
  'valuation_calculation_draw_projection_to_structural_distribution_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_SUBJECT_BINDING =
  'valuation_case_receiving_party_root_frontier_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_DRAW_DIGEST_DEFINITION =
  'canonical_draw_key_probability_weight_pairs_sha256_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_OBSERVATION_DIGEST_DEFINITION =
  'canonical_structural_observations_sha256_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_MISSINGNESS_TREATMENT =
  'unavailable_stays_unavailable_partial_values_never_substituted_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_VERIFICATION_SCOPE =
  'distribution_to_case_and_calculation_replay_only_upstream_calculation_provenance_requires_separate_validation_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_SCHEMA_VERSION =
  'afl-trade-valuation-snapshot/v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_COMPATIBILITY =
  'parallel_successor_no_lossless_upcast_v1' as const;
export const AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY =
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY;
export const AFL_TRADE_VALUATION_DISTRIBUTION_LIMITATION =
  'Immutable source-independent distribution artifact only; it is not source approval, model calibration, Gate approval, or publication readiness.' as const;

export const AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS = [
  'package.universal.layers.gross',
  'package.universal.layers.listSpotAdjusted',
  'package.universal.layers.scarcityAdjusted',
  'package.clubUtility.value',
  'root.universal.layers.gross',
  'root.universal.layers.listSpotAdjusted',
  'root.universal.layers.scarcityAdjusted',
  'root.clubUtility.value',
] as const;

const valuePathSchema = z.enum(AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS);

const aflClubReceivedPackageSubjectSchema = z
  .object({
    kind: z.literal('afl_club_received_package'),
    aflClubId: aflTradePublicIdSchema,
  })
  .strict();

const sourceNativeAflTradeRootSubjectSchema = z
  .object({
    kind: z.literal('source_native_afl_trade_root'),
    aflClubId: aflTradePublicIdSchema,
    rootAssetId: aflTradePublicIdSchema,
  })
  .strict();

export const aflTradeValuationDistributionSubjectSchema = z.discriminatedUnion('kind', [
  aflClubReceivedPackageSubjectSchema,
  sourceNativeAflTradeRootSubjectSchema,
]);

const universalFootballValueMeasureSchema = z
  .object({
    kind: z.literal('universal_football_value'),
    layer: z.enum(['gross', 'list_spot_adjusted', 'scarcity_adjusted']),
  })
  .strict();

const singleAflClubUtilityMeasureSchema = z
  .object({ kind: z.literal('single_afl_club_utility') })
  .strict();

export const aflTradeValuationDistributionMeasureSchema = z.discriminatedUnion('kind', [
  universalFootballValueMeasureSchema,
  singleAflClubUtilityMeasureSchema,
]);

const derivationCoordinatesSchema = z
  .object({
    view: z.enum(AFL_TRADE_VALUATION_VIEWS),
    subject: aflTradeValuationDistributionSubjectSchema,
    measure: aflTradeValuationDistributionMeasureSchema,
  })
  .strict();

export const aflTradeValuationDistributionDerivationReceiptSchema = z
  .object({
    definitionVersion: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_DERIVATION_VERSION),
    subjectBinding: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_SUBJECT_BINDING),
    drawDigestDefinition: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_DRAW_DIGEST_DEFINITION),
    observationDigestDefinition: z.literal(
      AFL_TRADE_VALUATION_DISTRIBUTION_OBSERVATION_DIGEST_DEFINITION
    ),
    missingnessTreatment: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_MISSINGNESS_TREATMENT),
    verificationScope: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_VERIFICATION_SCOPE),
    valuePath: valuePathSchema,
    coordinates: derivationCoordinatesSchema,
    rootAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    drawCount: z.number().int().min(1).max(100_000),
    drawMeasureSha256: aflTradeSha256Schema,
    observationSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.rootAssetIds.some(
        (rootAssetId, index) =>
          rootAssetId !== [...receipt.rootAssetIds].sort(compareAflTradeCodeUnits)[index]
      ) ||
      new Set(receipt.rootAssetIds).size !== receipt.rootAssetIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['rootAssetIds'],
        message: 'The derivation root frontier must be unique and use canonical code-unit order.',
      });
    }
  });

function expectedScopeForMeasure(
  measure: AflTradeValuationDistributionMeasure
): AflTradeValuationDistributionContent['valueScope'] {
  return measure.kind === 'universal_football_value'
    ? 'universal_football_value_cross_club_comparable'
    : 'single_afl_club_utility_not_cross_club_comparable';
}

function expectedValuePath(
  subject: AflTradeValuationDistributionSubject,
  measure: AflTradeValuationDistributionMeasure
): AflTradeValuationDistributionValuePath {
  const prefix = subject.kind === 'afl_club_received_package' ? 'package' : 'root';
  if (measure.kind === 'single_afl_club_utility') return `${prefix}.clubUtility.value`;
  const layer =
    measure.layer === 'list_spot_adjusted'
      ? 'listSpotAdjusted'
      : measure.layer === 'scarcity_adjusted'
        ? 'scarcityAdjusted'
        : 'gross';
  return `${prefix}.universal.layers.${layer}`;
}

export const aflTradeValuationDistributionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_SCHEMA_VERSION),
    identityBinding: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_IDENTITY_BINDING),
    publicAssetBoundary: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY),
    valuationCaseId: aflTradeContentAddressedIdSchema('valuation-case'),
    valuationCalculationId: aflTradeContentAddressedIdSchema('valuation-calculation'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    lineageGraphId: aflTradeContentAddressedIdSchema('lineage-graph'),
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    realizedContributionLedgerId: aflTradeContentAddressedIdSchema('realized-contribution-ledger'),
    packagePolicyId: aflTradeContentAddressedIdSchema('package-policy'),
    tradeId: aflTradePublicIdSchema,
    valueUnitId: aflTradePublicIdSchema,
    valueScope: z.enum([
      'universal_football_value_cross_club_comparable',
      'single_afl_club_utility_not_cross_club_comparable',
    ]),
    viewContext: aflTradeValuationViewContextSchema,
    subject: aflTradeValuationDistributionSubjectSchema,
    measure: aflTradeValuationDistributionMeasureSchema,
    derivation: aflTradeValuationDistributionDerivationReceiptSchema,
    distribution: aflTradeStructuralWeightedDistributionSchema,
    predecessor: z
      .object({
        schemaVersion: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_SCHEMA_VERSION),
        compatibility: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_COMPATIBILITY),
      })
      .strict(),
    limitation: z.literal(AFL_TRADE_VALUATION_DISTRIBUTION_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const expectedScope = expectedScopeForMeasure(content.measure);
    if (content.valueScope !== expectedScope || content.distribution.valueScope !== expectedScope) {
      context.addIssue({
        code: 'custom',
        path: ['valueScope'],
        message: 'The content and structural distribution scopes must match the selected measure.',
      });
    }
    if (content.distribution.valueUnitId !== content.valueUnitId) {
      context.addIssue({
        code: 'custom',
        path: ['distribution', 'valueUnitId'],
        message: 'The structural distribution value unit must match the artifact content.',
      });
    }
    if (content.distribution.publicAssetBoundary !== content.publicAssetBoundary) {
      context.addIssue({
        code: 'custom',
        path: ['distribution', 'publicAssetBoundary'],
        message:
          'The structural distribution public-asset boundary must match the artifact content.',
      });
    }
    if (
      content.derivation.coordinates.view !== content.viewContext.view ||
      canonicalizeAflTradeJson(content.derivation.coordinates.subject) !==
        canonicalizeAflTradeJson(content.subject) ||
      canonicalizeAflTradeJson(content.derivation.coordinates.measure) !==
        canonicalizeAflTradeJson(content.measure)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'coordinates'],
        message:
          'Derivation coordinates must exactly match the artifact view, subject, and measure.',
      });
    }
    if (content.derivation.valuePath !== expectedValuePath(content.subject, content.measure)) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'valuePath'],
        message: 'The derivation value path must match the artifact subject and measure.',
      });
    }
    if (content.derivation.drawCount !== content.distribution.drawCount) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'drawCount'],
        message: 'The derivation and structural distribution draw counts must match.',
      });
    }
    if (
      content.subject.kind === 'source_native_afl_trade_root' &&
      !content.derivation.rootAssetIds.includes(content.subject.rootAssetId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['derivation', 'rootAssetIds'],
        message: 'A root distribution must select a root inside its receiving-club frontier.',
      });
    }
  });

export const aflTradeValuationDistributionSchema = z
  .object({
    valuationDistributionId: aflTradeContentAddressedIdSchema('valuation-distribution'),
    content: aflTradeValuationDistributionContentSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    addAflTradeContentAddressIssue(
      'valuation-distribution',
      artifact.valuationDistributionId,
      artifact.content,
      context,
      ['valuationDistributionId']
    );
  });

export type AflTradeValuationDistributionSubject = z.infer<
  typeof aflTradeValuationDistributionSubjectSchema
>;
export type AflTradeValuationDistributionMeasure = z.infer<
  typeof aflTradeValuationDistributionMeasureSchema
>;
export type AflTradeValuationDistributionValuePath =
  (typeof AFL_TRADE_VALUATION_DISTRIBUTION_VALUE_PATHS)[number];
export type AflTradeValuationDistributionDerivationReceipt = z.infer<
  typeof aflTradeValuationDistributionDerivationReceiptSchema
>;
export type AflTradeValuationDistributionContent = z.infer<
  typeof aflTradeValuationDistributionContentSchema
>;
export type AflTradeValuationDistribution = z.infer<typeof aflTradeValuationDistributionSchema>;

export const AFL_TRADE_VALUATION_DISTRIBUTION_CONSTRUCTION_ERROR_CODES = [
  'INVALID_INPUT_ENVELOPE',
  'INVALID_VALUATION_CASE',
  'INVALID_VALUATION_CALCULATION',
  'INVALID_VIEW',
  'INVALID_SUBJECT',
  'INVALID_MEASURE',
  'INVALID_POLICY',
  'CALCULATION_PARENT_LINEAGE_MISMATCH',
  'PUBLIC_ASSET_BOUNDARY_MISMATCH',
  'CALCULATION_DRAW_FRONTIER_MISMATCH',
  'SUBJECT_AFL_CLUB_NOT_IN_CASE',
  'SUBJECT_ROOT_NOT_RECEIVED_BY_AFL_CLUB',
  'STRUCTURAL_DISTRIBUTION_CALCULATION_FAILURE',
  'INTERNAL_ARTIFACT_CONTRACT_VIOLATION',
] as const;

export type AflTradeValuationDistributionConstructionErrorCode =
  (typeof AFL_TRADE_VALUATION_DISTRIBUTION_CONSTRUCTION_ERROR_CODES)[number];

const CONSTRUCTION_ERROR_MESSAGES: Readonly<
  Record<AflTradeValuationDistributionConstructionErrorCode, string>
> = Object.freeze({
  INVALID_INPUT_ENVELOPE: 'The valuation-distribution input envelope is invalid.',
  INVALID_VALUATION_CASE: 'The valuation case is invalid.',
  INVALID_VALUATION_CALCULATION: 'The valuation calculation is invalid.',
  INVALID_VIEW: 'The requested valuation view is invalid.',
  INVALID_SUBJECT: 'The valuation-distribution subject is invalid.',
  INVALID_MEASURE: 'The valuation-distribution measure is invalid.',
  INVALID_POLICY: 'The structural weighted-distribution policy is invalid.',
  CALCULATION_PARENT_LINEAGE_MISMATCH:
    'The valuation calculation does not match every valuation-case parent reference.',
  PUBLIC_ASSET_BOUNDARY_MISMATCH:
    'The valuation case and calculation do not use the required public-asset boundary.',
  CALCULATION_DRAW_FRONTIER_MISMATCH:
    'A valuation-calculation draw does not match the case AFL-club and trade-root frontier.',
  SUBJECT_AFL_CLUB_NOT_IN_CASE: 'The subject AFL club is not a party to the valuation case.',
  SUBJECT_ROOT_NOT_RECEIVED_BY_AFL_CLUB:
    'The subject trade root was not received by the named AFL club.',
  STRUCTURAL_DISTRIBUTION_CALCULATION_FAILURE:
    'The projected observations could not produce a structural weighted distribution.',
  INTERNAL_ARTIFACT_CONTRACT_VIOLATION:
    'The valuation-distribution artifact failed its internal contract.',
});

const TRUSTED_CONSTRUCTION_ERRORS = new WeakSet<object>();

export class AflTradeValuationDistributionConstructionError extends Error {
  readonly code: AflTradeValuationDistributionConstructionErrorCode;

  constructor(code: AflTradeValuationDistributionConstructionErrorCode) {
    super(CONSTRUCTION_ERROR_MESSAGES[code]);
    this.name = 'AflTradeValuationDistributionConstructionError';
    this.code = code;
    TRUSTED_CONSTRUCTION_ERRORS.add(this);
    Object.freeze(this);
  }

  toJSON(): Readonly<{
    name: 'AflTradeValuationDistributionConstructionError';
    code: AflTradeValuationDistributionConstructionErrorCode;
    message: string;
  }> {
    return Object.freeze({
      name: 'AflTradeValuationDistributionConstructionError',
      code: this.code,
      message: this.message,
    });
  }
}

export function isAflTradeValuationDistributionConstructionError(
  value: unknown
): value is AflTradeValuationDistributionConstructionError {
  return value !== null && typeof value === 'object' && TRUSTED_CONSTRUCTION_ERRORS.has(value);
}

export interface CreateAflTradeValuationDistributionInput {
  valuationCase: unknown;
  valuationCalculation: unknown;
  view: unknown;
  subject: unknown;
  measure: unknown;
  policy: unknown;
}

const CREATE_INPUT_KEYS = [
  'valuationCase',
  'valuationCalculation',
  'view',
  'subject',
  'measure',
  'policy',
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
  code: AflTradeValuationDistributionConstructionErrorCode
): AflTradeValuationDistributionConstructionError {
  return new AflTradeValuationDistributionConstructionError(code);
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: AflTradeValuationDistributionConstructionErrorCode
): T {
  try {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // Invalid inputs never expose arbitrary native causes or hostile proxy failures.
  }
  throw constructionError(code);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    valuationCase.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY ||
    calculation.content.publicAssetBoundary !==
      AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY
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

function selectProjectionSource(
  draw: AflTradeValuationCalculation['content']['draws'][number],
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  subject: AflTradeValuationDistributionSubject
) {
  const partyView = draw.parties
    .find((party) => party.aflClubId === subject.aflClubId)!
    .views.find((candidate) => candidate.view === view)!;
  return subject.kind === 'afl_club_received_package'
    ? partyView
    : partyView.roots.find((root) => root.assetId === subject.rootAssetId)!;
}

function projectObservations(
  calculation: AflTradeValuationCalculation,
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number],
  subject: AflTradeValuationDistributionSubject,
  measure: AflTradeValuationDistributionMeasure
): AflTradeStructuralWeightedDistributionObservation[] {
  return calculation.content.draws
    .map((draw): AflTradeStructuralWeightedDistributionObservation => {
      const source = selectProjectionSource(draw, view, subject);
      if (measure.kind === 'single_afl_club_utility') {
        if (source.clubUtility.status === 'unavailable') {
          return {
            drawKey: draw.drawKey,
            probabilityWeight: draw.probabilityWeight,
            status: 'unavailable',
            reasonCodes: canonicalReasonCodes(source.clubUtility.reasonCodes),
          };
        }
        return {
          drawKey: draw.drawKey,
          probabilityWeight: draw.probabilityWeight,
          status: 'available',
          value: source.clubUtility.value,
        };
      }

      if (source.universal.status === 'unavailable') {
        return {
          drawKey: draw.drawKey,
          probabilityWeight: draw.probabilityWeight,
          status: 'unavailable',
          reasonCodes: canonicalReasonCodes(source.universal.reasonCodes),
        };
      }
      const value =
        measure.layer === 'list_spot_adjusted'
          ? source.universal.layers.listSpotAdjusted
          : measure.layer === 'scarcity_adjusted'
            ? source.universal.layers.scarcityAdjusted
            : source.universal.layers.gross;
      return {
        drawKey: draw.drawKey,
        probabilityWeight: draw.probabilityWeight,
        status: 'available',
        value,
      };
    })
    .sort((left, right) => compareAflTradeCodeUnits(left.drawKey, right.drawKey));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

export function createAflTradeValuationDistribution(
  unparsedInput: unknown
): AflTradeValuationDistribution {
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
    const subject = parseOrThrow(
      aflTradeValuationDistributionSubjectSchema,
      snapshot.subject,
      'INVALID_SUBJECT'
    );
    const measure = parseOrThrow(
      aflTradeValuationDistributionMeasureSchema,
      snapshot.measure,
      'INVALID_MEASURE'
    );
    const policy = parseOrThrow(
      aflTradeStructuralWeightedDistributionPolicySchema,
      snapshot.policy,
      'INVALID_POLICY'
    );

    assertParentLineage(valuationCase, valuationCalculation);
    assertDrawFrontiers(valuationCase, valuationCalculation);

    const party = valuationCase.content.parties.find(
      (candidate) => candidate.aflClubId === subject.aflClubId
    );
    if (!party) throw constructionError('SUBJECT_AFL_CLUB_NOT_IN_CASE');
    if (
      subject.kind === 'source_native_afl_trade_root' &&
      !party.receivedRootAssetIds.includes(subject.rootAssetId)
    ) {
      throw constructionError('SUBJECT_ROOT_NOT_RECEIVED_BY_AFL_CLUB');
    }

    const viewContext = valuationCase.content.viewContexts.find(
      (candidate) => candidate.view === view
    );
    if (!viewContext) throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');

    const observations = projectObservations(valuationCalculation, view, subject, measure);
    const drawMeasure = observations.map(({ drawKey, probabilityWeight }) => ({
      drawKey,
      probabilityWeight,
    }));
    let distribution: AflTradeStructuralWeightedDistribution;
    try {
      distribution = calculateAflTradeStructuralWeightedDistribution({
        inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
        publicAssetBoundary: AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
        valueScope: expectedScopeForMeasure(measure),
        valueUnitId: valuationCase.content.valueUnitId,
        policy,
        drawCount: observations.length,
        observations,
      });
    } catch {
      throw constructionError('STRUCTURAL_DISTRIBUTION_CALCULATION_FAILURE');
    }

    const rootAssetIds = [...party.receivedRootAssetIds];
    const derivation: AflTradeValuationDistributionDerivationReceipt = {
      definitionVersion: AFL_TRADE_VALUATION_DISTRIBUTION_DERIVATION_VERSION,
      subjectBinding: AFL_TRADE_VALUATION_DISTRIBUTION_SUBJECT_BINDING,
      drawDigestDefinition: AFL_TRADE_VALUATION_DISTRIBUTION_DRAW_DIGEST_DEFINITION,
      observationDigestDefinition: AFL_TRADE_VALUATION_DISTRIBUTION_OBSERVATION_DIGEST_DEFINITION,
      missingnessTreatment: AFL_TRADE_VALUATION_DISTRIBUTION_MISSINGNESS_TREATMENT,
      verificationScope: AFL_TRADE_VALUATION_DISTRIBUTION_VERIFICATION_SCOPE,
      valuePath: expectedValuePath(subject, measure),
      coordinates: { view, subject, measure },
      rootAssetIds,
      drawCount: observations.length,
      drawMeasureSha256: sha256AflTradeCanonicalJson(drawMeasure),
      observationSha256: sha256AflTradeCanonicalJson(observations),
    };

    const parsedContent = aflTradeValuationDistributionContentSchema.safeParse({
      schemaVersion: AFL_TRADE_VALUATION_DISTRIBUTION_SCHEMA_VERSION,
      identityBinding: AFL_TRADE_VALUATION_DISTRIBUTION_IDENTITY_BINDING,
      publicAssetBoundary: AFL_TRADE_VALUATION_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
      valuationCaseId: valuationCase.valuationCaseId,
      valuationCalculationId: valuationCalculation.valuationCalculationId,
      valuationBundleId: valuationCase.content.valuationBundleId,
      lineageGraphId: valuationCase.content.lineageGraphId,
      componentDrawSetId: valuationCase.content.componentDrawSetId,
      realizedContributionLedgerId: valuationCase.content.realizedContributionLedgerId,
      packagePolicyId: valuationCase.content.packagePolicyId,
      tradeId: valuationCase.content.tradeId,
      valueUnitId: valuationCase.content.valueUnitId,
      valueScope: expectedScopeForMeasure(measure),
      viewContext,
      subject,
      measure,
      derivation,
      distribution,
      predecessor: {
        schemaVersion: AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_SCHEMA_VERSION,
        compatibility: AFL_TRADE_VALUATION_DISTRIBUTION_PREDECESSOR_COMPATIBILITY,
      },
      limitation: AFL_TRADE_VALUATION_DISTRIBUTION_LIMITATION,
    });
    if (!parsedContent.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }

    const parsedArtifact = aflTradeValuationDistributionSchema.safeParse({
      valuationDistributionId: createAflTradeContentAddress(
        'valuation-distribution',
        parsedContent.data
      ),
      content: parsedContent.data,
    });
    if (!parsedArtifact.success) {
      throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
    }
    return deepFreeze(parsedArtifact.data);
  } catch (error) {
    if (typeof error === 'object' && error !== null && TRUSTED_CONSTRUCTION_ERRORS.has(error)) {
      throw error;
    }
    throw constructionError('INTERNAL_ARTIFACT_CONTRACT_VIOLATION');
  }
}

const VERIFY_INPUT_KEYS = [
  'valuationDistribution',
  'valuationCase',
  'valuationCalculation',
] as const;
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

export function verifyAflTradeValuationDistributionCaseCalculationDerivation(
  input: unknown
): boolean {
  try {
    const snapshot = snapshotVerifyEnvelope(input);
    if (snapshot === null) return false;
    const valuationDistribution = aflTradeValuationDistributionSchema.safeParse(
      snapshot.valuationDistribution
    );
    if (!valuationDistribution.success) return false;
    const replayed = createAflTradeValuationDistribution({
      valuationCase: snapshot.valuationCase,
      valuationCalculation: snapshot.valuationCalculation,
      view: valuationDistribution.data.content.viewContext.view,
      subject: valuationDistribution.data.content.subject,
      measure: valuationDistribution.data.content.measure,
      policy: valuationDistribution.data.content.distribution.policy,
    });
    return (
      replayed.valuationDistributionId === valuationDistribution.data.valuationDistributionId &&
      canonicalizeAflTradeJson(replayed) === canonicalizeAflTradeJson(valuationDistribution.data)
    );
  } catch {
    return false;
  }
}
