import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION,
  parseLocalPrivateTradeEvaluationGenerationV2,
  type LocalPrivateTradeEvaluationGenerationV2,
} from './localPrivateTradeEvaluationGenerationV2';
import {
  LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION,
  parseLocalPrivateTradeEvaluationGenerationV3,
  type LocalPrivateTradeEvaluationGenerationV3,
} from './localPrivateTradeEvaluationGenerationV3';

export const LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_SCHEMA_VERSION =
  'local-private-trade-evaluation-generation/v1' as const;

const publicId = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const boundedText = z.string().trim().min(1).max(2_000);

export const localPrivateTradeEvaluationBlockerReasonSchema = z.enum([
  'private_evaluation_not_authorized',
  'reviewed_evidence_withdrawn',
  'transaction_not_confirmed',
  'asset_identity_unresolved',
  'pick_selection_not_confirmed',
  'canonical_pick_realization_unavailable',
  'selected_player_acquisition_spell_unavailable',
  'fixed_horizon_pick_outcome_unavailable',
  'source_rights_not_approved',
  'gate_3_model_run_not_approved',
  'historical_value_model_not_authorized',
  'selection_value_model_not_authorized',
  'predictive_model_not_authorized',
  'calculation_field_unavailable',
  'calculation_method_unavailable',
  'calculation_evidence_incomplete',
  'calculation_parent_drift',
  'asset_values_incomplete',
]);

const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).max(500);

const unavailableViewSchema = z
  .object({
    state: z.literal('unavailable'),
    reasons: z.array(localPrivateTradeEvaluationBlockerReasonSchema).min(1).max(20),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const componentsSchema = z
  .object({
    offensiveScore: z.number().finite(),
    midfieldScore: z.number().finite(),
    defensiveScore: z.number().finite(),
    offensivePav: z.number().finite(),
    midfieldPav: z.number().finite(),
    defensivePav: z.number().finite(),
  })
  .strict();

const calculatedViewSchema = z
  .object({
    state: z.literal('calculated'),
    score: z.number().finite(),
    gamesPlayed: z.number().int().nonnegative().optional(),
    components: componentsSchema.optional(),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();

export const localPrivateTradeEvaluationViewSchema = z.discriminatedUnion('state', [
  calculatedViewSchema,
  unavailableViewSchema,
]);

const appearanceSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('observed'),
      gamesPlayed: z.number().int().nonnegative(),
      coverage: z.enum(['complete', 'right_censored']),
      effectiveThroughSeason: z.number().int().min(1897).max(2200),
      evidenceRefs: evidenceRefsSchema.min(1),
    })
    .strict(),
  unavailableViewSchema,
]);

const fourViewsSchema = z
  .object({
    atTrade: localPrivateTradeEvaluationViewSchema,
    realized: localPrivateTradeEvaluationViewSchema,
    remaining: localPrivateTradeEvaluationViewSchema,
    current: localPrivateTradeEvaluationViewSchema,
  })
  .strict();

function areAllFourViewsCalculated(views: {
  atTrade: { state: string };
  realized: { state: string };
  remaining: { state: string };
  current: { state: string };
}): boolean {
  return (
    views.atTrade.state === 'calculated' &&
    views.realized.state === 'calculated' &&
    views.remaining.state === 'calculated' &&
    views.current.state === 'calculated'
  );
}

const viewKeys = ['atTrade', 'realized', 'remaining', 'current'] as const;

const assetSchema = z
  .object({
    assetId: publicId,
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    canonicalPlayerId: publicId.nullable(),
    sendingClubId: publicId,
    receivingClubId: publicId,
    label: boundedText,
    appearances: appearanceSchema,
    views: fourViewsSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.sendingClubId === asset.receivingClubId) {
      context.addIssue({
        code: 'custom',
        message: 'A trade asset must move between distinct clubs.',
      });
    }
  });

const clubTotalSchema = z
  .object({
    clubId: publicId,
    views: fourViewsSchema,
  })
  .strict();

const gradeSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('calculated'),
      grade: z.enum(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']),
      expectedNet: z.number().finite(),
      evidenceRefs: evidenceRefsSchema.min(1),
    })
    .strict(),
  unavailableViewSchema,
]);

const generationContentSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: z.literal('private_confirmed_local_evaluation'),
    valuationScopeKey: publicId,
    tradeId: publicId,
    workbookSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    dependencyFingerprint: aflTradeContentAddressedIdSchema(
      'local-private-trade-evaluation-dependencies'
    ),
    dependencyRefs: evidenceRefsSchema.min(1),
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    valueUnitId: publicId,
    assets: z.array(assetSchema).min(1).max(1_000),
    clubTotals: z.array(clubTotalSchema).max(100).nullable(),
    overallGrade: gradeSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local non-production evaluation only; unavailable views remain unavailable and no publication, production, or activation authority is granted.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const assetIds = content.assets.map(({ assetId }) => assetId);
    if (
      new Set(assetIds).size !== assetIds.length ||
      assetIds.some((assetId, index) => index > 0 && assetIds[index - 1]! > assetId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Generation assets must be unique and canonically ordered.',
      });
    }
    const dependencyIds = content.dependencyRefs.map(({ artifactId }) => artifactId);
    if (
      new Set(dependencyIds).size !== dependencyIds.length ||
      dependencyIds.some((artifactId, index) => index > 0 && dependencyIds[index - 1]! > artifactId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dependencyRefs'],
        message: 'Dependency references must be unique and canonically ordered.',
      });
    }
    if (
      !content.dependencyRefs.some((reference) =>
        doAflTradeArtifactRefsExactlyMatch(reference, content.confirmedResultArtifact)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['confirmedResultArtifact'],
        message: 'The exact confirmed-result artifact must be a sealed generation dependency.',
      });
    }
    const clubTotalIds = content.clubTotals?.map(({ clubId }) => clubId) ?? [];
    if (
      new Set(clubTotalIds).size !== clubTotalIds.length ||
      clubTotalIds.some((clubId, index) => index > 0 && clubTotalIds[index - 1]! > clubId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['clubTotals'],
        message: 'Club totals must be unique and canonically ordered.',
      });
    }
    if (content.overallGrade.state === 'calculated') {
      const everyAssetViewCalculated = content.assets.every(({ views }) =>
        areAllFourViewsCalculated(views)
      );
      const requiredClubIds = [
        ...new Set(
          content.assets.flatMap(({ sendingClubId, receivingClubId }) => [
            sendingClubId,
            receivingClubId,
          ])
        ),
      ].sort();
      const everyClubViewCalculated =
        content.clubTotals !== null &&
        clubTotalIds.length === requiredClubIds.length &&
        clubTotalIds.every((clubId, index) => clubId === requiredClubIds[index]) &&
        content.clubTotals.every(({ views }) => areAllFourViewsCalculated(views));
      if (!everyAssetViewCalculated || !everyClubViewCalculated) {
        context.addIssue({
          code: 'custom',
          path: ['overallGrade'],
          message:
            'A calculated overall grade requires every asset and club-total view to be calculated.',
        });
      } else {
        for (const clubTotal of content.clubTotals!) {
          for (const viewKey of viewKeys) {
            const expected = content.assets.reduce((total, asset) => {
              const contribution = asset.views[viewKey];
              if (contribution.state !== 'calculated') return total;
              return (
                total +
                (asset.receivingClubId === clubTotal.clubId ? contribution.score : 0) -
                (asset.sendingClubId === clubTotal.clubId ? contribution.score : 0)
              );
            }, 0);
            const retained = clubTotal.views[viewKey];
            if (
              retained.state !== 'calculated' ||
              Math.abs(retained.score - expected) > 1e-9
            ) {
              context.addIssue({
                code: 'custom',
                path: ['clubTotals', clubTotalIds.indexOf(clubTotal.clubId), 'views', viewKey],
                message: 'Calculated club totals must equal exact received minus given-up assets.',
              });
            }
          }
        }
      }
    }
  });

export const localPrivateTradeEvaluationGenerationSchema = z
  .object({
    generationId: aflTradeContentAddressedIdSchema('local-private-trade-evaluation-generation'),
    content: generationContentSchema,
  })
  .strict()
  .superRefine((generation, context) => {
    addAflTradeContentAddressIssue(
      'local-private-trade-evaluation-generation',
      generation.generationId,
      generation.content,
      context,
      ['generationId']
    );
  });

export type LocalPrivateTradeEvaluationGeneration = z.infer<
  typeof localPrivateTradeEvaluationGenerationSchema
>;
export type LocalPrivateTradeEvaluationGenerationInput = Omit<
  LocalPrivateTradeEvaluationGeneration['content'],
  | 'schemaVersion'
  | 'environment'
  | 'authority'
  | 'dependencyFingerprint'
  | 'publicationEligible'
  | 'publicationProhibited'
  | 'limitation'
>;

export function createLocalPrivateTradeEvaluationGeneration(
  input: LocalPrivateTradeEvaluationGenerationInput
): LocalPrivateTradeEvaluationGeneration {
  const dependencyRefs = [...input.dependencyRefs].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
  const assets = [...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const dependencyFingerprint = createAflTradeContentAddress(
    'local-private-trade-evaluation-dependencies',
    dependencyRefs
  );
  const content = generationContentSchema.parse({
    schemaVersion: LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_SCHEMA_VERSION,
    environment: 'non_production',
    authority: 'private_confirmed_local_evaluation',
    ...input,
    dependencyFingerprint,
    dependencyRefs,
    assets,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production evaluation only; unavailable views remain unavailable and no publication, production, or activation authority is granted.',
  });
  return localPrivateTradeEvaluationGenerationSchema.parse({
    generationId: createAflTradeContentAddress(
      'local-private-trade-evaluation-generation',
      content
    ),
    content,
  });
}

export function parseLocalPrivateTradeEvaluationGeneration(
  input: unknown
): LocalPrivateTradeEvaluationGeneration {
  const parsed = localPrivateTradeEvaluationGenerationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError('Local private trade evaluation generation failed exact authentication.');
  }
  return parsed.data;
}

export type LocalPrivateTradeEvaluationDependencyRef = AflTradeArtifactRef;

export type AnyLocalPrivateTradeEvaluationGeneration =
  | LocalPrivateTradeEvaluationGeneration
  | LocalPrivateTradeEvaluationGenerationV2
  | LocalPrivateTradeEvaluationGenerationV3;

export function parseAnyLocalPrivateTradeEvaluationGeneration(
  input: unknown
): AnyLocalPrivateTradeEvaluationGeneration {
  const schemaVersion =
    typeof input === 'object' &&
    input !== null &&
    'content' in input &&
    typeof input.content === 'object' &&
    input.content !== null &&
    'schemaVersion' in input.content
      ? input.content.schemaVersion
      : null;
  if (schemaVersion === LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_SCHEMA_VERSION) {
    return parseLocalPrivateTradeEvaluationGeneration(input);
  }
  if (schemaVersion === LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION) {
    return parseLocalPrivateTradeEvaluationGenerationV2(input);
  }
  if (schemaVersion === LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V3_SCHEMA_VERSION) {
    return parseLocalPrivateTradeEvaluationGenerationV3(input);
  }
  throw new TypeError(
    'Local private trade evaluation generation schema version is unsupported.'
  );
}
