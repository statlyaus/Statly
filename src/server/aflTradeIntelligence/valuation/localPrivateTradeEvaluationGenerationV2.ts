import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_STATLY_GRADES } from './statlyGradePolicy';

export const LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION =
  'local-private-trade-evaluation-generation/v2' as const;

const LIMITATION =
  'Private local non-production evaluation only; source facts, model authority, calculation ancestry, and complete party reconciliation are required for numerical grades. Publication and production use are prohibited.' as const;
const EPSILON = 1e-9;
const viewKeys = ['atTrade', 'realized', 'remaining', 'current'] as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const boundedTextSchema = z.string().trim().min(1).max(2_000);
const evidenceRefsSchema = z.array(aflTradeArtifactRefSchema).max(500);

export const localPrivateTradeEvaluationV2BlockerReasonSchema = z.enum([
  'private_evaluation_not_authorized',
  'reviewed_evidence_withdrawn',
  'transaction_not_confirmed',
  'asset_identity_unresolved',
  'evidence_horizon_incomplete',
  'pick_selection_not_confirmed',
  'canonical_pick_lineage_unavailable',
  'canonical_pick_realization_unavailable',
  'selected_player_acquisition_spell_unavailable',
  'fixed_horizon_pick_outcome_unavailable',
  'source_rights_not_approved',
  'gate_3_model_run_not_approved',
  'gate_3_bundle_not_approved',
  'historical_value_model_not_authorized',
  'selection_value_model_not_authorized',
  'predictive_model_not_authorized',
  'calculation_field_unavailable',
  'calculation_method_unavailable',
  'calculation_evidence_incomplete',
  'calculation_parent_drift',
  'asset_values_incomplete',
]);

const unavailableSchema = z
  .object({
    state: z.literal('unavailable'),
    reasons: z.array(localPrivateTradeEvaluationV2BlockerReasonSchema).min(1).max(20),
    evidenceRefs: evidenceRefsSchema,
  })
  .strict();

const distributionSchema = z
  .object({
    mean: z.number().finite(),
    median: z.number().finite(),
    p10: z.number().finite(),
    p90: z.number().finite(),
  })
  .strict()
  .superRefine((distribution, context) => {
    if (distribution.p10 > distribution.median || distribution.median > distribution.p90) {
      context.addIssue({
        code: 'custom',
        message: 'Distribution quantiles must be ordered p10, median, p90.',
      });
    }
  });

const valueSummarySchema = z
  .object({
    score: z.number().finite(),
    distribution: distributionSchema,
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (Math.abs(value.score - value.distribution.mean) > EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['distribution', 'mean'],
        message: 'The displayed additive score must equal the retained distribution mean.',
      });
    }
  });

const componentScoreSchema = z
  .object({
    componentId: publicIdSchema,
    label: boundedTextSchema,
    score: z.number().finite(),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();

const calculatedAssetViewSchema = valueSummarySchema
  .extend({
    state: z.literal('calculated'),
    components: z.array(componentScoreSchema).min(1).max(100),
    calculationRefs: evidenceRefsSchema.min(1),
  })
  .strict()
  .superRefine((view, context) => {
    const componentIds = view.components.map(({ componentId }) => componentId);
    if (
      new Set(componentIds).size !== componentIds.length ||
      componentIds.some(
        (componentId, index) => index > 0 && view.components[index - 1]!.componentId > componentId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Calculated-view components must be unique and canonically ordered.',
      });
    }
  });

export const localPrivateTradeEvaluationV2AssetViewSchema = z.discriminatedUnion('state', [
  calculatedAssetViewSchema,
  unavailableSchema,
]);

const completedSeasonHorizonSchema = z
  .object({
    kind: z.literal('completed_season'),
    season: z.number().int().min(1897).max(2200),
    gamesPlayed: z.number().int().nonnegative(),
    effectiveThrough: z.iso.date(),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();

const currentSeasonHorizonSchema = z
  .object({
    kind: z.literal('current_season'),
    season: z.number().int().min(1897).max(2200),
    gamesPlayed: z.number().int().nonnegative(),
    coverage: z.enum(['complete', 'right_censored']),
    effectiveThrough: z.iso.date(),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();

const evidenceHorizonSchema = z.discriminatedUnion('kind', [
  completedSeasonHorizonSchema,
  currentSeasonHorizonSchema,
]);

const fourAssetViewsSchema = z
  .object({
    atTrade: localPrivateTradeEvaluationV2AssetViewSchema,
    realized: localPrivateTradeEvaluationV2AssetViewSchema,
    remaining: localPrivateTradeEvaluationV2AssetViewSchema,
    current: localPrivateTradeEvaluationV2AssetViewSchema,
  })
  .strict();

const assetSchema = z
  .object({
    assetId: publicIdSchema,
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    canonicalPlayerId: publicIdSchema.nullable(),
    sendingClubId: publicIdSchema,
    receivingClubId: publicIdSchema,
    label: boundedTextSchema,
    evidenceHorizons: z.array(evidenceHorizonSchema).max(100),
    views: fourAssetViewsSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    if (asset.sendingClubId === asset.receivingClubId) {
      context.addIssue({
        code: 'custom',
        message: 'A trade asset must move between distinct clubs.',
      });
    }
    const seasons = asset.evidenceHorizons.map(({ season }) => season);
    if (
      new Set(seasons).size !== seasons.length ||
      seasons.some((season, index) => index > 0 && asset.evidenceHorizons[index - 1]!.season > season)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceHorizons'],
        message: 'Evidence horizons must use unique seasons in chronological order.',
      });
    }
    if (asset.evidenceHorizons.filter(({ kind }) => kind === 'current_season').length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceHorizons'],
        message: 'An asset may retain at most one current-season horizon.',
      });
    }
    if (asset.views.realized.state === 'calculated') {
      if (asset.canonicalPlayerId === null || asset.evidenceHorizons.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['views', 'realized'],
          message:
            'A calculated realized value requires canonical player identity and retained evidence horizons.',
        });
      }
    }
    const { realized, remaining, current } = asset.views;
    if (current.state === 'calculated') {
      if (realized.state !== 'calculated' || remaining.state !== 'calculated') {
        context.addIssue({
          code: 'custom',
          path: ['views', 'current'],
          message: 'Current value requires both realized and remaining values.',
        });
      } else if (Math.abs(current.score - realized.score - remaining.score) > EPSILON) {
        context.addIssue({
          code: 'custom',
          path: ['views', 'current', 'score'],
          message: 'Current additive score must equal realized plus remaining.',
        });
      }
    }
  });

const calculatedClubViewSchema = z
  .object({
    state: z.literal('calculated'),
    received: valueSummarySchema,
    givenUp: valueSummarySchema,
    net: valueSummarySchema,
  })
  .strict()
  .superRefine((view, context) => {
    if (Math.abs(view.net.score - view.received.score + view.givenUp.score) > EPSILON) {
      context.addIssue({
        code: 'custom',
        path: ['net', 'score'],
        message: 'Club net score must equal received minus given-up score.',
      });
    }
  });

const clubViewSchema = z.discriminatedUnion('state', [calculatedClubViewSchema, unavailableSchema]);
const fourClubViewsSchema = z
  .object({
    atTrade: clubViewSchema,
    realized: clubViewSchema,
    remaining: clubViewSchema,
    current: clubViewSchema,
  })
  .strict();
const clubTotalSchema = z
  .object({
    clubId: publicIdSchema,
    views: fourClubViewsSchema,
  })
  .strict();

const availableGradeSchema = z
  .object({
    clubId: publicIdSchema,
    state: z.enum(['graded', 'provisional']),
    grade: z.enum(AFL_TRADE_STATLY_GRADES),
    normalizedPerformance: z.number().finite().min(0).max(1),
    finishesAheadProbability: z.number().finite().min(0).max(1),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();
const unavailableGradeSchema = unavailableSchema.extend({ clubId: publicIdSchema }).strict();
const overallGradeSchema = z.discriminatedUnion('state', [
  availableGradeSchema,
  unavailableGradeSchema,
]);

const calculatedVerdictSchema = z
  .object({
    state: z.literal('calculated'),
    kind: z.enum(['favours_club', 'shared_lead']),
    clubIds: z.array(publicIdSchema).min(1).max(100),
    practicalEquivalenceProbability: z.number().finite().min(0).max(1),
    evidenceRefs: evidenceRefsSchema.min(1),
  })
  .strict();
const tradeVerdictSchema = z.discriminatedUnion('state', [calculatedVerdictSchema, unavailableSchema]);

function calculatedAssetScore(
  asset: z.infer<typeof assetSchema>,
  viewKey: (typeof viewKeys)[number]
): number | null {
  const view = asset.views[viewKey];
  return view.state === 'calculated' ? view.score : null;
}

export const localPrivateTradeEvaluationGenerationV2ContentSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: z.literal('private_confirmed_local_evaluation'),
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    workbookSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    dependencyFingerprint: aflTradeContentAddressedIdSchema(
      'local-private-trade-evaluation-dependencies'
    ),
    dependencyRefs: evidenceRefsSchema.min(1),
    confirmedResultArtifact: aflTradeArtifactRefSchema,
    valueUnitId: publicIdSchema,
    assets: z.array(assetSchema).min(1).max(1_000),
    clubTotals: z.array(clubTotalSchema).min(2).max(100),
    overallGrades: z.array(overallGradeSchema).min(2).max(100),
    tradeVerdict: tradeVerdictSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    const assetIds = content.assets.map(({ assetId }) => assetId);
    if (
      new Set(assetIds).size !== assetIds.length ||
      assetIds.some((assetId, index) => index > 0 && content.assets[index - 1]!.assetId > assetId)
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
      dependencyIds.some(
        (artifactId, index) => index > 0 && content.dependencyRefs[index - 1]!.artifactId > artifactId
      )
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

    const requiredClubIds = [
      ...new Set(
        content.assets.flatMap(({ sendingClubId, receivingClubId }) => [
          sendingClubId,
          receivingClubId,
        ])
      ),
    ].sort();
    const clubIds = content.clubTotals.map(({ clubId }) => clubId);
    const gradeClubIds = content.overallGrades.map(({ clubId }) => clubId);
    for (const [path, retained] of [
      ['clubTotals', clubIds],
      ['overallGrades', gradeClubIds],
    ] as const) {
      if (
        retained.length !== requiredClubIds.length ||
        retained.some((clubId, index) => clubId !== requiredClubIds[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: [path],
          message: 'Generation party records must exactly cover every sending and receiving club.',
        });
      }
    }

    for (const [clubIndex, club] of content.clubTotals.entries()) {
      for (const viewKey of viewKeys) {
        const received = content.assets.filter(({ receivingClubId }) => receivingClubId === club.clubId);
        const givenUp = content.assets.filter(({ sendingClubId }) => sendingClubId === club.clubId);
        const receivedScores = received.map((asset) => calculatedAssetScore(asset, viewKey));
        const givenUpScores = givenUp.map((asset) => calculatedAssetScore(asset, viewKey));
        const everyRequiredAssetCalculated = [...receivedScores, ...givenUpScores].every(
          (score) => score !== null
        );
        const retained = club.views[viewKey];
        if (!everyRequiredAssetCalculated) {
          if (retained.state === 'calculated') {
            context.addIssue({
              code: 'custom',
              path: ['clubTotals', clubIndex, 'views', viewKey],
              message: 'A club view cannot be calculated from incomplete asset values.',
            });
          }
          continue;
        }
        if (retained.state !== 'calculated') {
          context.addIssue({
            code: 'custom',
            path: ['clubTotals', clubIndex, 'views', viewKey],
            message: 'A complete set of asset values requires an exactly reconciled club view.',
          });
          continue;
        }
        const expectedReceived = receivedScores.reduce<number>((sum, score) => sum + score!, 0);
        const expectedGivenUp = givenUpScores.reduce<number>((sum, score) => sum + score!, 0);
        if (
          Math.abs(retained.received.score - expectedReceived) > EPSILON ||
          Math.abs(retained.givenUp.score - expectedGivenUp) > EPSILON ||
          Math.abs(retained.net.score - expectedReceived + expectedGivenUp) > EPSILON
        ) {
          context.addIssue({
            code: 'custom',
            path: ['clubTotals', clubIndex, 'views', viewKey],
            message: 'Club values must exactly equal received, given-up, and net asset scores.',
          });
        }
      }
    }

    const everyAssetViewCalculated = content.assets.every((asset) =>
      viewKeys.every((viewKey) => asset.views[viewKey].state === 'calculated')
    );
    const everyClubViewCalculated = content.clubTotals.every((club) =>
      viewKeys.every((viewKey) => club.views[viewKey].state === 'calculated')
    );
    const availableGrades = content.overallGrades.filter(({ state }) => state !== 'unavailable');
    if (availableGrades.length > 0) {
      if (
        availableGrades.length !== content.overallGrades.length ||
        !everyAssetViewCalculated ||
        !everyClubViewCalculated ||
        content.tradeVerdict.state !== 'calculated'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['overallGrades'],
          message:
            'Overall grades require every asset and club view, every party grade, and the trade verdict to be calculated.',
        });
      } else {
        const probabilityMass =
          content.overallGrades.reduce(
            (sum, grade) =>
              grade.state === 'unavailable' ? sum : sum + grade.finishesAheadProbability,
            0
          ) + content.tradeVerdict.practicalEquivalenceProbability;
        if (Math.abs(probabilityMass - 1) > EPSILON) {
          context.addIssue({
            code: 'custom',
            path: ['overallGrades'],
            message:
              'Finish-ahead and practical-equivalence probabilities must exhaust unit mass.',
          });
        }
      }
    } else if (content.tradeVerdict.state === 'calculated') {
      context.addIssue({
        code: 'custom',
        path: ['tradeVerdict'],
        message: 'A calculated trade verdict requires calculated overall grades.',
      });
    }
    if (content.tradeVerdict.state === 'calculated') {
      const verdictClubIds = content.tradeVerdict.clubIds;
      if (
        new Set(verdictClubIds).size !== verdictClubIds.length ||
        verdictClubIds.some(
          (clubId, index) =>
            !requiredClubIds.includes(clubId) ||
            (index > 0 && verdictClubIds[index - 1]! > clubId)
        ) ||
        (content.tradeVerdict.kind === 'favours_club' && verdictClubIds.length !== 1) ||
        (content.tradeVerdict.kind === 'shared_lead' && verdictClubIds.length < 2)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['tradeVerdict', 'clubIds'],
          message:
            'Calculated verdict clubs must be transaction parties in canonical order and match the verdict kind.',
        });
      }
    }
  });

export const localPrivateTradeEvaluationGenerationV2Schema = z
  .object({
    generationId: aflTradeContentAddressedIdSchema('local-private-trade-evaluation-generation'),
    content: localPrivateTradeEvaluationGenerationV2ContentSchema,
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

export type LocalPrivateTradeEvaluationGenerationV2 = z.infer<
  typeof localPrivateTradeEvaluationGenerationV2Schema
>;
export type LocalPrivateTradeEvaluationGenerationV2Input = Omit<
  z.input<typeof localPrivateTradeEvaluationGenerationV2ContentSchema>,
  | 'schemaVersion'
  | 'environment'
  | 'authority'
  | 'dependencyFingerprint'
  | 'publicationEligible'
  | 'publicationProhibited'
  | 'limitation'
>;

function collectGenerationDependencyRefs(
  input: LocalPrivateTradeEvaluationGenerationV2Input
): z.infer<typeof aflTradeArtifactRefSchema>[] {
  const references = [
    ...input.dependencyRefs,
    input.confirmedResultArtifact,
    ...input.assets.flatMap((asset) => [
      ...asset.evidenceHorizons.flatMap(({ evidenceRefs }) => evidenceRefs),
      ...viewKeys.flatMap((viewKey) => {
        const view = asset.views[viewKey];
        return view.state === 'calculated'
          ? [
              ...view.evidenceRefs,
              ...view.calculationRefs,
              ...view.components.flatMap(({ evidenceRefs }) => evidenceRefs),
            ]
          : view.evidenceRefs;
      }),
    ]),
    ...input.clubTotals.flatMap((club) =>
      viewKeys.flatMap((viewKey) => {
        const view = club.views[viewKey];
        return view.state === 'calculated'
          ? [
              ...view.received.evidenceRefs,
              ...view.givenUp.evidenceRefs,
              ...view.net.evidenceRefs,
            ]
          : view.evidenceRefs;
      })
    ),
    ...input.overallGrades.flatMap(({ evidenceRefs }) => evidenceRefs),
    ...input.tradeVerdict.evidenceRefs,
  ];
  const byArtifactId = new Map<string, z.infer<typeof aflTradeArtifactRefSchema>>();
  for (const reference of references) {
    const retained = byArtifactId.get(reference.artifactId);
    if (retained && !doAflTradeArtifactRefsExactlyMatch(retained, reference)) {
      throw new TypeError('Generation dependency references disagree for one artifact ID.');
    }
    byArtifactId.set(reference.artifactId, reference);
  }
  return [...byArtifactId.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId)
  );
}

export function createLocalPrivateTradeEvaluationGenerationV2(
  input: LocalPrivateTradeEvaluationGenerationV2Input
): LocalPrivateTradeEvaluationGenerationV2 {
  const dependencyRefs = collectGenerationDependencyRefs(input);
  const content = localPrivateTradeEvaluationGenerationV2ContentSchema.parse({
    schemaVersion: LOCAL_PRIVATE_TRADE_EVALUATION_GENERATION_V2_SCHEMA_VERSION,
    environment: 'non_production',
    authority: 'private_confirmed_local_evaluation',
    ...input,
    dependencyFingerprint: createAflTradeContentAddress(
      'local-private-trade-evaluation-dependencies',
      dependencyRefs
    ),
    dependencyRefs,
    assets: [...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId)),
    clubTotals: [...input.clubTotals].sort((left, right) =>
      left.clubId.localeCompare(right.clubId)
    ),
    overallGrades: [...input.overallGrades].sort((left, right) =>
      left.clubId.localeCompare(right.clubId)
    ),
    publicationEligible: false,
    publicationProhibited: true,
    limitation: LIMITATION,
  });
  return localPrivateTradeEvaluationGenerationV2Schema.parse({
    generationId: createAflTradeContentAddress(
      'local-private-trade-evaluation-generation',
      content
    ),
    content,
  });
}

export function parseLocalPrivateTradeEvaluationGenerationV2(
  input: unknown
): LocalPrivateTradeEvaluationGenerationV2 {
  const parsed = localPrivateTradeEvaluationGenerationV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError(
      'Local private trade evaluation generation v2 failed exact authentication.'
    );
  }
  return parsed.data;
}
