import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  createAflTradeCanonicalJsonArtifactRef,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';

export const AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_SCHEMA_VERSION =
  'afl-trade-private-confirmed-valuation-plan/v1' as const;
export const AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_SCHEMA_VERSION =
  'afl-trade-private-confirmed-valuation-result/v1' as const;
export const AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_V2_SCHEMA_VERSION =
  'afl-trade-private-confirmed-valuation-plan/v2' as const;
export const AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_V2_SCHEMA_VERSION =
  'afl-trade-private-confirmed-valuation-result/v2' as const;

const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const methodIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);

const privateAuthoritySchema = z
  .object({
    kind: z.literal('private_confirmed_nonproduction_calculation'),
    evidenceKind: z.literal('retained_private_review'),
    decisionId: aflTradeContentAddressedIdSchema(
      'private-reviewed-evidence-evaluation-decision'
    ),
    evidenceBundleId: aflTradeContentAddressedIdSchema('private-reviewed-evidence-bundle'),
    evidenceBundleArtifact: aflTradeArtifactRefSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
  })
  .strict();

export type AflTradePrivateConfirmedValuationAuthority = z.infer<
  typeof privateAuthoritySchema
>;

const assetIdentitySchema = z
  .object({
    assetId: publicIdSchema,
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    sendingClubId: publicIdSchema,
    receivingClubId: publicIdSchema,
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

export const aflTradePrivateConfirmedValuationBlockerReasonSchema = z.enum([
  'private_evaluation_not_authorized',
  'reviewed_evidence_withdrawn',
  'transaction_not_confirmed',
  'asset_identity_unresolved',
  'selection_lineage_unresolved',
  'acquisition_spell_unresolved',
  'calculation_field_unavailable',
  'calculation_method_unavailable',
  'calculation_evidence_incomplete',
  'calculation_parent_drift',
]);

const planReadyAssetSchema = assetIdentitySchema.extend({
  state: z.literal('ready'),
  methodId: methodIdSchema,
  evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
});

const planUnavailableAssetSchema = assetIdentitySchema.extend({
  state: z.literal('unavailable'),
  reasons: z.array(aflTradePrivateConfirmedValuationBlockerReasonSchema).min(1).max(20),
  evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
});

const planAssetSchema = z.discriminatedUnion('state', [
  planReadyAssetSchema,
  planUnavailableAssetSchema,
]);

const planContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: privateAuthoritySchema,
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    transactionArtifact: aflTradeArtifactRefSchema,
    expectedAssetIds: z.array(publicIdSchema).min(1).max(1_000),
    assets: z.array(planAssetSchema).min(1).max(1_000),
    requestedViews: z.tuple([z.literal('realized')]),
    plannedAt: timestampSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local non-production realized valuation only; not public factual, model-training, publication, production, or activation authority.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const assetIds = content.assets.map(({ assetId }) => assetId);
    if (
      new Set(content.expectedAssetIds).size !== content.expectedAssetIds.length ||
      content.expectedAssetIds.some(
        (assetId, index) => index > 0 && content.expectedAssetIds[index - 1]! > assetId
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expectedAssetIds'],
        message: 'Expected assets must be unique and canonically ordered.',
      });
    }
    if (
      assetIds.length !== content.expectedAssetIds.length ||
      assetIds.some((assetId, index) => assetId !== content.expectedAssetIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'The plan must classify every expected trade asset exactly once.',
      });
    }
    const plannedAt = Date.parse(content.plannedAt);
    const parents = [
      content.authority.evidenceBundleArtifact,
      content.transactionArtifact,
      ...content.assets.flatMap(({ evidenceRefs }) => evidenceRefs),
    ];
    if (parents.some(({ createdAt }) => Date.parse(createdAt) > plannedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Every plan parent must exist before the trusted planning time.',
      });
    }
  });

export const aflTradePrivateConfirmedValuationPlanSchema = z
  .object({
    planId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-plan'),
    content: planContentSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    addAflTradeContentAddressIssue(
      'private-confirmed-valuation-plan',
      plan.planId,
      plan.content,
      context,
      ['planId']
    );
  });

export type AflTradePrivateConfirmedValuationPlan = z.infer<
  typeof aflTradePrivateConfirmedValuationPlanSchema
>;

export function createAflTradePrivateConfirmedValuationPlan(input: {
  readonly authority: AflTradePrivateConfirmedValuationAuthority;
  readonly valuationScopeKey: string;
  readonly tradeId: string;
  readonly transactionArtifact: AflTradeArtifactRef;
  readonly expectedAssetIds: readonly string[];
  readonly assets: readonly z.input<typeof planAssetSchema>[];
  readonly plannedAt: string;
}): AflTradePrivateConfirmedValuationPlan {
  const expectedAssetIds = [...input.expectedAssetIds].sort();
  const assets = [...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const content = planContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_SCHEMA_VERSION,
    environment: 'non_production',
    authority: input.authority,
    valuationScopeKey: input.valuationScopeKey,
    tradeId: input.tradeId,
    transactionArtifact: input.transactionArtifact,
    expectedAssetIds,
    assets,
    requestedViews: ['realized'],
    plannedAt: input.plannedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production realized valuation only; not public factual, model-training, publication, production, or activation authority.',
  });
  return aflTradePrivateConfirmedValuationPlanSchema.parse({
    planId: createAflTradeContentAddress('private-confirmed-valuation-plan', content),
    content,
  });
}

const unavailableMeasureSchema = z
  .object({
    state: z.literal('unavailable'),
    reasons: z.array(aflTradePrivateConfirmedValuationBlockerReasonSchema).min(1).max(20),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
  })
  .strict();

const v2PlanAppearanceSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      coverage: z.enum(['complete', 'right_censored']),
      evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
    })
    .strict(),
  unavailableMeasureSchema,
]);

const v2PlanRealizedPavSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      methodId: methodIdSchema,
      evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
    })
    .strict(),
  unavailableMeasureSchema,
]);

const v2AcquisitionSpellSchema = z
  .object({
    spellId: aflTradeContentAddressedIdSchema('acquisition-spell'),
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    ruleId: aflTradeContentAddressedIdSchema('acquisition-spell-rule'),
    startEventVersionId: aflTradeContentAddressedIdSchema('event-version'),
    startAssetVersionId: aflTradeContentAddressedIdSchema('event-asset-version'),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable(),
  })
  .strict()
  .superRefine((spell, context) => {
    if (spell.endDate !== null && spell.endDate < spell.startDate) {
      context.addIssue({ code: 'custom', path: ['endDate'], message: 'A spell cannot end before it starts.' });
    }
  });

const v2AssetIdentitySchema = assetIdentitySchema
  .extend({
    canonicalPlayerId: publicIdSchema.nullable(),
    acquisitionSpell: v2AcquisitionSpellSchema.nullable(),
  })
  .superRefine((asset, context) => {
    if (
      (asset.assetKind === 'player') !== (asset.canonicalPlayerId !== null) ||
      (asset.assetKind === 'player') !== (asset.acquisitionSpell !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acquisitionSpell'],
        message: 'A resolved player asset must carry exactly one canonical acquisition spell.',
      });
    }
  });

const v2PlanAssetSchema = v2AssetIdentitySchema.extend({
  appearances: v2PlanAppearanceSchema,
  realizedPav: v2PlanRealizedPavSchema,
});

const v2PlanContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_V2_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: privateAuthoritySchema,
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    transactionPromotionId: aflTradeContentAddressedIdSchema(
      'private-workbook-transaction-promotion'
    ),
    transactionOccurredOn: z.iso.date(),
    transactionOccurrencePrecision: z.enum(['date', 'year']),
    knowledgeCutoffAt: timestampSchema,
    transactionArtifact: aflTradeArtifactRefSchema,
    expectedAssetIds: z.array(publicIdSchema).min(1).max(1_000),
    assets: z.array(v2PlanAssetSchema).min(1).max(1_000),
    requestedViews: z.tuple([z.literal('realized')]),
    plannedAt: timestampSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local non-production confirmed appearances and realized PAV only; forecast, grade, publication, production, and activation authority are prohibited.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const expectedAssetIds = content.expectedAssetIds;
    const assetIds = content.assets.map(({ assetId }) => assetId);
    if (
      new Set(expectedAssetIds).size !== expectedAssetIds.length ||
      expectedAssetIds.some(
        (assetId, index) => index > 0 && expectedAssetIds[index - 1]! > assetId
      ) ||
      assetIds.length !== expectedAssetIds.length ||
      assetIds.some((assetId, index) => assetId !== expectedAssetIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'The v2 plan must classify every expected trade asset exactly once.',
      });
    }
    const plannedAt = Date.parse(content.plannedAt);
    const cutoffAt = Date.parse(content.knowledgeCutoffAt);
    if (
      cutoffAt > plannedAt ||
      Date.parse(`${content.transactionOccurredOn}T00:00:00.000Z`) > cutoffAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'The transaction and knowledge cutoff must not be later than planning.',
      });
    }
    if (
      content.transactionOccurrencePrecision === 'year' &&
      content.transactionOccurredOn !== `${content.transactionOccurredOn.slice(0, 4)}-01-01`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactionOccurrencePrecision'],
        message: 'A year-precision transaction must use January 1 as its normalized lower bound.',
      });
    }
    const parents = [
      content.authority.evidenceBundleArtifact,
      content.transactionArtifact,
      ...content.assets.flatMap(({ appearances, realizedPav }) => [
        ...appearances.evidenceRefs,
        ...realizedPav.evidenceRefs,
      ]),
    ];
    if (parents.some(({ createdAt }) => Date.parse(createdAt) > plannedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Every v2 plan parent must exist before the trusted planning time.',
      });
    }
  });

export const aflTradePrivateConfirmedValuationPlanV2Schema = z
  .object({
    planId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-plan'),
    content: v2PlanContentSchema,
  })
  .strict()
  .superRefine((plan, context) => {
    addAflTradeContentAddressIssue(
      'private-confirmed-valuation-plan',
      plan.planId,
      plan.content,
      context,
      ['planId']
    );
  });

export type AflTradePrivateConfirmedValuationPlanV2 = z.infer<
  typeof aflTradePrivateConfirmedValuationPlanV2Schema
>;

export function createAflTradePrivateConfirmedValuationPlanV2(input: {
  readonly authority: AflTradePrivateConfirmedValuationAuthority;
  readonly valuationScopeKey: string;
  readonly tradeId: string;
  readonly transactionPromotionId: string;
  readonly transactionOccurredOn: string;
  readonly transactionOccurrencePrecision: 'date' | 'year';
  readonly knowledgeCutoffAt: string;
  readonly transactionArtifact: AflTradeArtifactRef;
  readonly expectedAssetIds: readonly string[];
  readonly assets: readonly z.input<typeof v2PlanAssetSchema>[];
  readonly plannedAt: string;
}): AflTradePrivateConfirmedValuationPlanV2 {
  const expectedAssetIds = [...input.expectedAssetIds].sort();
  const assets = [...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const content = v2PlanContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_PLAN_V2_SCHEMA_VERSION,
    environment: 'non_production',
    authority: input.authority,
    valuationScopeKey: input.valuationScopeKey,
    tradeId: input.tradeId,
    transactionPromotionId: input.transactionPromotionId,
    transactionOccurredOn: input.transactionOccurredOn,
    transactionOccurrencePrecision: input.transactionOccurrencePrecision,
    knowledgeCutoffAt: input.knowledgeCutoffAt,
    transactionArtifact: input.transactionArtifact,
    expectedAssetIds,
    assets,
    requestedViews: ['realized'],
    plannedAt: input.plannedAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production confirmed appearances and realized PAV only; forecast, grade, publication, production, and activation authority are prohibited.',
  });
  return aflTradePrivateConfirmedValuationPlanV2Schema.parse({
    planId: createAflTradeContentAddress('private-confirmed-valuation-plan', content),
    content,
  });
}

const observedAssetSchema = assetIdentitySchema.extend({
  state: z.literal('observed'),
  methodId: methodIdSchema,
  score: z.number().finite().positive(),
  calculationArtifact: aflTradeArtifactRefSchema,
  evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
});

const observedZeroAssetSchema = assetIdentitySchema.extend({
  state: z.literal('observed_zero'),
  methodId: methodIdSchema,
  score: z.literal(0),
  calculationArtifact: aflTradeArtifactRefSchema,
  evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
});

const unavailableAssetSchema = assetIdentitySchema.extend({
  state: z.literal('unavailable'),
  reasons: z.array(aflTradePrivateConfirmedValuationBlockerReasonSchema).min(1).max(20),
  evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
});

const resultAssetSchema = z.discriminatedUnion('state', [
  observedAssetSchema,
  observedZeroAssetSchema,
  unavailableAssetSchema,
]);

const clubTotalSchema = z
  .object({
    clubId: publicIdSchema,
    received: z.number().finite().nonnegative(),
    givenUp: z.number().finite().nonnegative(),
    net: z.number().finite(),
  })
  .strict();

const overallGradeSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('available'),
      grade: z.enum(['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F']),
      distributionArtifact: aflTradeArtifactRefSchema,
      evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      reason: z.enum(['asset_values_incomplete', 'distribution_evidence_unavailable']),
      evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
    })
    .strict(),
]);

function expectedClubTotals(assets: readonly z.infer<typeof resultAssetSchema>[]) {
  if (assets.some(({ state }) => state === 'unavailable')) return null;
  const totals = new Map<string, { received: number; givenUp: number }>();
  for (const asset of assets) {
    if (asset.state === 'unavailable') continue;
    const sender = totals.get(asset.sendingClubId) ?? { received: 0, givenUp: 0 };
    sender.givenUp += asset.score;
    totals.set(asset.sendingClubId, sender);
    const receiver = totals.get(asset.receivingClubId) ?? { received: 0, givenUp: 0 };
    receiver.received += asset.score;
    totals.set(asset.receivingClubId, receiver);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clubId, total]) => ({
      clubId,
      received: total.received,
      givenUp: total.givenUp,
      net: total.received - total.givenUp,
    }));
}

const resultContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: privateAuthoritySchema,
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    planId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-plan'),
    planArtifact: aflTradeArtifactRefSchema,
    valueUnitId: methodIdSchema,
    view: z.literal('realized'),
    assets: z.array(resultAssetSchema).min(1).max(1_000),
    clubTotals: z.array(clubTotalSchema).min(2).max(100).nullable(),
    overallGrade: overallGradeSchema,
    assembledAt: timestampSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local non-production confirmed calculation; publication and production use are prohibited.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    const expectedTotals = expectedClubTotals(content.assets);
    if (JSON.stringify(content.clubTotals) !== JSON.stringify(expectedTotals)) {
      context.addIssue({
        code: 'custom',
        path: ['clubTotals'],
        message: 'Club totals must be absent until complete and otherwise equal the exact asset sums.',
      });
    }
    const incomplete = content.assets.some(({ state }) => state === 'unavailable');
    if (
      incomplete &&
      (content.overallGrade.state !== 'unavailable' ||
        content.overallGrade.reason !== 'asset_values_incomplete')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['overallGrade'],
        message: 'An incomplete asset set cannot carry a trade grade.',
      });
    }
  });

export const aflTradePrivateConfirmedValuationResultSchema = z
  .object({
    resultId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-result'),
    content: resultContentSchema,
  })
  .strict()
  .superRefine((result, context) => {
    addAflTradeContentAddressIssue(
      'private-confirmed-valuation-result',
      result.resultId,
      result.content,
      context,
      ['resultId']
    );
  });

export type AflTradePrivateConfirmedValuationResult = z.infer<
  typeof aflTradePrivateConfirmedValuationResultSchema
>;

export function createAflTradePrivateConfirmedValuationResult(input: {
  readonly plan: AflTradePrivateConfirmedValuationPlan;
  readonly planArtifact: AflTradeArtifactRef;
  readonly valueUnitId: string;
  readonly assets: readonly z.input<typeof resultAssetSchema>[];
  readonly overallGrade: z.input<typeof overallGradeSchema>;
  readonly assembledAt: string;
}): AflTradePrivateConfirmedValuationResult {
  const plan = aflTradePrivateConfirmedValuationPlanSchema.parse(input.plan);
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.planArtifact, plan)) {
    throw new TypeError('The result must retain the exact immutable construction plan.');
  }
  const assets = [...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const parsedAssets = z.array(resultAssetSchema).parse(assets);
  if (parsedAssets.length !== plan.content.assets.length) {
    throw new TypeError('The result must classify every planned trade asset exactly once.');
  }
  for (let index = 0; index < parsedAssets.length; index += 1) {
    const resultAsset = parsedAssets[index]!;
    const planAsset = plan.content.assets[index]!;
    if (
      resultAsset.assetId !== planAsset.assetId ||
      resultAsset.assetKind !== planAsset.assetKind ||
      resultAsset.sendingClubId !== planAsset.sendingClubId ||
      resultAsset.receivingClubId !== planAsset.receivingClubId
    ) {
      throw new TypeError('Result asset identity must exactly match the construction plan.');
    }
    if (resultAsset.state !== 'unavailable') {
      if (planAsset.state !== 'ready' || resultAsset.methodId !== planAsset.methodId) {
        throw new TypeError('Only a planned ready method can produce an observed asset value.');
      }
    }
  }
  const clubTotals = expectedClubTotals(parsedAssets);
  const content = resultContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_SCHEMA_VERSION,
    environment: 'non_production',
    authority: plan.content.authority,
    valuationScopeKey: plan.content.valuationScopeKey,
    tradeId: plan.content.tradeId,
    planId: plan.planId,
    planArtifact: input.planArtifact,
    valueUnitId: input.valueUnitId,
    view: 'realized',
    assets: parsedAssets,
    clubTotals,
    overallGrade: input.overallGrade,
    assembledAt: input.assembledAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production confirmed calculation; publication and production use are prohibited.',
  });
  return aflTradePrivateConfirmedValuationResultSchema.parse({
    resultId: createAflTradeContentAddress('private-confirmed-valuation-result', content),
    content,
  });
}

const v2ObservedAppearancesSchema = z
  .object({
    state: z.literal('observed'),
    gamesPlayed: z.number().int().nonnegative(),
    coverage: z.enum(['complete', 'right_censored']),
    effectiveThroughSeason: z.number().int().min(1897).max(2200),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
  })
  .strict();

const v2ResultAppearanceSchema = z.discriminatedUnion('state', [
  v2ObservedAppearancesSchema,
  unavailableMeasureSchema,
]);

const v2PavComponentsSchema = z
  .object({
    offensiveScore: z.number().finite(),
    midfieldScore: z.number().finite(),
    defensiveScore: z.number().finite(),
    offensivePav: z.number().finite(),
    midfieldPav: z.number().finite(),
    defensivePav: z.number().finite(),
  })
  .strict();

const v2CalculatedRealizedPavSchema = z
  .object({
    state: z.literal('calculated'),
    methodId: methodIdSchema,
    score: z.number().finite(),
    seasons: z.array(z.number().int().min(1897).max(2200)).min(1).max(100),
    components: v2PavComponentsSchema,
    calculationArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(100),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.seasons).size !== value.seasons.length ||
      value.seasons.some((season, index) => index > 0 && value.seasons[index - 1]! >= season) ||
      value.calculationArtifacts.length !== value.seasons.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Calculated PAV seasons must be unique, ordered, and exactly artifact-backed.',
      });
    }
    const componentTotal =
      value.components.offensivePav +
      value.components.midfieldPav +
      value.components.defensivePav;
    if (Math.abs(componentTotal - value.score) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Realized PAV must equal its exact offensive, midfield, and defensive components.',
      });
    }
  });

const v2ResultRealizedPavSchema = z.union([
  v2CalculatedRealizedPavSchema,
  unavailableMeasureSchema,
]);

const v2ResultAssetSchema = v2AssetIdentitySchema.extend({
  appearances: v2ResultAppearanceSchema,
  realizedPav: v2ResultRealizedPavSchema,
});

const v2ClubTotalSchema = z
  .object({
    clubId: publicIdSchema,
    received: z.number().finite(),
    givenUp: z.number().finite(),
    net: z.number().finite(),
  })
  .strict();

const v2OverallGradeSchema = z
  .object({
    state: z.literal('unavailable'),
    reason: z.literal('private_realized_only_grade_prohibited'),
    evidenceRefs: z.array(aflTradeArtifactRefSchema).min(1).max(100),
  })
  .strict();

function expectedV2ClubTotals(assets: readonly z.infer<typeof v2ResultAssetSchema>[]) {
  if (assets.some(({ realizedPav }) => realizedPav.state === 'unavailable')) return null;
  const totals = new Map<string, { received: number; givenUp: number }>();
  for (const asset of assets) {
    if (asset.realizedPav.state !== 'calculated') continue;
    const sender = totals.get(asset.sendingClubId) ?? { received: 0, givenUp: 0 };
    sender.givenUp += asset.realizedPav.score;
    totals.set(asset.sendingClubId, sender);
    const receiver = totals.get(asset.receivingClubId) ?? { received: 0, givenUp: 0 };
    receiver.received += asset.realizedPav.score;
    totals.set(asset.receivingClubId, receiver);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clubId, total]) => ({
      clubId,
      received: total.received,
      givenUp: total.givenUp,
      net: total.received - total.givenUp,
    }));
}

const v2ResultContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_V2_SCHEMA_VERSION),
    environment: z.literal('non_production'),
    authority: privateAuthoritySchema,
    valuationScopeKey: publicIdSchema,
    tradeId: publicIdSchema,
    transactionPromotionId: aflTradeContentAddressedIdSchema(
      'private-workbook-transaction-promotion'
    ),
    transactionOccurredOn: z.iso.date(),
    transactionOccurrencePrecision: z.enum(['date', 'year']),
    knowledgeCutoffAt: timestampSchema,
    planId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-plan'),
    planArtifact: aflTradeArtifactRefSchema,
    valueUnitId: methodIdSchema,
    view: z.literal('realized'),
    assets: z.array(v2ResultAssetSchema).min(1).max(1_000),
    clubTotals: z.array(v2ClubTotalSchema).min(2).max(100).nullable(),
    overallGrade: v2OverallGradeSchema,
    assembledAt: timestampSchema,
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(
      'Private local non-production confirmed appearances and realized PAV only; incomplete assets prevent totals and grade authority is prohibited.'
    ),
  })
  .strict()
  .superRefine((content, context) => {
    if (JSON.stringify(content.clubTotals) !== JSON.stringify(expectedV2ClubTotals(content.assets))) {
      context.addIssue({
        code: 'custom',
        path: ['clubTotals'],
        message: 'V2 club totals must be absent until every realized asset is calculated.',
      });
    }
    const tradeYear = Number(content.transactionOccurredOn.slice(0, 4));
    const cutoffYear = new Date(content.knowledgeCutoffAt).getUTCFullYear();
    for (const [index, asset] of content.assets.entries()) {
      if (
        asset.appearances.state === 'observed' &&
        asset.appearances.effectiveThroughSeason > cutoffYear
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'appearances'],
          message: 'Appearance evidence cannot extend beyond the knowledge cutoff.',
        });
      }
      if (
        asset.realizedPav.state === 'calculated' &&
        asset.realizedPav.seasons.some((season) => season <= tradeYear || season > cutoffYear)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'realizedPav', 'seasons'],
          message: 'Realized PAV seasons must be strictly post-trade and within the cutoff.',
        });
      }
      if (asset.realizedPav.state === 'calculated') {
        const effectiveThroughSeason =
          asset.appearances.state === 'observed'
            ? asset.appearances.effectiveThroughSeason
            : null;
        if (
          effectiveThroughSeason === null ||
          asset.realizedPav.seasons.some((season) => season > effectiveThroughSeason)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['assets', index, 'appearances'],
            message:
              'Calculated realized PAV requires observed appearances covering every calculated season.',
          });
        }
      }
    }
  });

export const aflTradePrivateConfirmedValuationResultV2Schema = z
  .object({
    resultId: aflTradeContentAddressedIdSchema('private-confirmed-valuation-result'),
    content: v2ResultContentSchema,
  })
  .strict()
  .superRefine((result, context) => {
    addAflTradeContentAddressIssue(
      'private-confirmed-valuation-result',
      result.resultId,
      result.content,
      context,
      ['resultId']
    );
  });

export type AflTradePrivateConfirmedValuationResultV2 = z.infer<
  typeof aflTradePrivateConfirmedValuationResultV2Schema
>;

function doAflTradeArtifactRefArraysExactlyMatch(
  left: readonly AflTradeArtifactRef[],
  right: readonly AflTradeArtifactRef[]
): boolean {
  return (
    left.length === right.length &&
    left.every((reference, index) =>
      doAflTradeArtifactRefsExactlyMatch(reference, right[index]!)
    )
  );
}

export function createAflTradePrivateConfirmedValuationResultV2(input: {
  readonly plan: AflTradePrivateConfirmedValuationPlanV2;
  readonly planArtifact: AflTradeArtifactRef;
  readonly valueUnitId: string;
  readonly assets: readonly z.input<typeof v2ResultAssetSchema>[];
  readonly assembledAt: string;
}): AflTradePrivateConfirmedValuationResultV2 {
  const plan = aflTradePrivateConfirmedValuationPlanV2Schema.parse(input.plan);
  if (!doesAflTradeArtifactRefMatchCanonicalJson(input.planArtifact, plan)) {
    throw new TypeError('The v2 result must retain the exact immutable construction plan.');
  }
  const assets = z
    .array(v2ResultAssetSchema)
    .parse([...input.assets].sort((left, right) => left.assetId.localeCompare(right.assetId)));
  if (assets.length !== plan.content.assets.length) {
    throw new TypeError('The v2 result must classify every planned trade asset exactly once.');
  }
  for (let index = 0; index < assets.length; index += 1) {
    const resultAsset = assets[index]!;
    const planAsset = plan.content.assets[index]!;
    if (
      resultAsset.assetId !== planAsset.assetId ||
      resultAsset.assetKind !== planAsset.assetKind ||
      resultAsset.sendingClubId !== planAsset.sendingClubId ||
      resultAsset.receivingClubId !== planAsset.receivingClubId ||
      resultAsset.canonicalPlayerId !== planAsset.canonicalPlayerId ||
      JSON.stringify(resultAsset.acquisitionSpell) !== JSON.stringify(planAsset.acquisitionSpell)
    ) {
      throw new TypeError('V2 result asset identity must exactly match its plan.');
    }
    if (
      resultAsset.appearances.state === 'observed' &&
      (planAsset.appearances.state !== 'ready' ||
        resultAsset.appearances.coverage !== planAsset.appearances.coverage ||
        !doAflTradeArtifactRefArraysExactlyMatch(
          resultAsset.appearances.evidenceRefs,
          planAsset.appearances.evidenceRefs
        ))
    ) {
      throw new TypeError('Only exact planned appearance evidence can become observed.');
    }
    if (
      resultAsset.realizedPav.state === 'calculated' &&
      (planAsset.realizedPav.state !== 'ready' ||
        resultAsset.realizedPav.methodId !== planAsset.realizedPav.methodId ||
        !doAflTradeArtifactRefArraysExactlyMatch(
          resultAsset.realizedPav.evidenceRefs,
          planAsset.realizedPav.evidenceRefs
        ))
    ) {
      throw new TypeError('Only exact planned PAV evidence and method can become calculated.');
    }
    if (
      resultAsset.appearances.state === 'unavailable' &&
      !doAflTradeArtifactRefArraysExactlyMatch(
        resultAsset.appearances.evidenceRefs,
        planAsset.appearances.evidenceRefs
      )
    ) {
      throw new TypeError('Unavailable appearances must retain their exact planned evidence.');
    }
    if (
      resultAsset.realizedPav.state === 'unavailable' &&
      !doAflTradeArtifactRefArraysExactlyMatch(
        resultAsset.realizedPav.evidenceRefs,
        planAsset.realizedPav.evidenceRefs
      )
    ) {
      throw new TypeError('Unavailable realized PAV must retain its exact planned evidence.');
    }
  }
  const content = v2ResultContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_CONFIRMED_VALUATION_RESULT_V2_SCHEMA_VERSION,
    environment: 'non_production',
    authority: plan.content.authority,
    valuationScopeKey: plan.content.valuationScopeKey,
    tradeId: plan.content.tradeId,
    transactionPromotionId: plan.content.transactionPromotionId,
    transactionOccurredOn: plan.content.transactionOccurredOn,
    transactionOccurrencePrecision: plan.content.transactionOccurrencePrecision,
    knowledgeCutoffAt: plan.content.knowledgeCutoffAt,
    planId: plan.planId,
    planArtifact: input.planArtifact,
    valueUnitId: input.valueUnitId,
    view: 'realized',
    assets,
    clubTotals: expectedV2ClubTotals(assets),
    overallGrade: {
      state: 'unavailable',
      reason: 'private_realized_only_grade_prohibited',
      evidenceRefs: [input.planArtifact],
    },
    assembledAt: input.assembledAt,
    publicationEligible: false,
    publicationProhibited: true,
    limitation:
      'Private local non-production confirmed appearances and realized PAV only; incomplete assets prevent totals and grade authority is prohibited.',
  });
  return aflTradePrivateConfirmedValuationResultV2Schema.parse({
    resultId: createAflTradeContentAddress('private-confirmed-valuation-result', content),
    content,
  });
}

export type AflTradePrivateConfirmedValuationAdmission =
  | { readonly state: 'authorized'; readonly authority: AflTradePrivateConfirmedValuationAuthority }
  | {
      readonly state: 'blocked';
      readonly reason: 'not_authorized' | 'withdrawn';
      readonly decisionId: string | null;
    };

export interface AflTradePrivateConfirmedValuationConstruction {
  stage(input: {
    readonly valuationScopeKey: string;
    readonly tradeId: string;
  }): Promise<
    | {
        readonly state: 'planned';
        readonly plan: AflTradePrivateConfirmedValuationPlan;
        readonly planArtifact: AflTradeArtifactRef;
      }
    | {
        readonly state: 'blocked';
        readonly reasons: readonly z.infer<
          typeof aflTradePrivateConfirmedValuationBlockerReasonSchema
        >[];
        readonly evidenceRefs: readonly AflTradeArtifactRef[];
      }
  >;
  assemble(planId: string): Promise<
    | {
        readonly state: 'assembled';
        readonly result: AflTradePrivateConfirmedValuationResult;
        readonly resultArtifact: AflTradeArtifactRef;
      }
    | {
        readonly state: 'blocked';
        readonly reasons: readonly z.infer<
          typeof aflTradePrivateConfirmedValuationBlockerReasonSchema
        >[];
        readonly evidenceRefs: readonly AflTradeArtifactRef[];
      }
  >;
}

export interface AflTradePrivateConfirmedValuationReader {
  get(
    valuationScopeKey: string,
    tradeId: string
  ): Promise<
    AflTradePrivateConfirmedValuationResult | AflTradePrivateConfirmedValuationResultV2 | null
  >;
}

export const aflTradeAnyPrivateConfirmedValuationResultSchema = z.union([
  aflTradePrivateConfirmedValuationResultV2Schema,
  aflTradePrivateConfirmedValuationResultSchema,
]);

export function createAflTradePrivateConfirmedValuationReader(dependencies: {
  readonly loadCurrentAdmission: (
    valuationScopeKey: string
  ) => Promise<AflTradePrivateConfirmedValuationAdmission>;
  readonly loadResult: (valuationScopeKey: string, tradeId: string) => Promise<unknown | null>;
}): AflTradePrivateConfirmedValuationReader {
  return {
    async get(valuationScopeKey, tradeId) {
      const admission = await dependencies.loadCurrentAdmission(valuationScopeKey);
      if (admission.state === 'blocked') return null;
      const unparsed = await dependencies.loadResult(valuationScopeKey, tradeId);
      if (unparsed === null) return null;
      const result = aflTradeAnyPrivateConfirmedValuationResultSchema.parse(unparsed);
      if (
        result.content.valuationScopeKey !== valuationScopeKey ||
        result.content.tradeId !== tradeId ||
        result.content.authority.decisionId !== admission.authority.decisionId ||
        result.content.authority.evidenceBundleId !== admission.authority.evidenceBundleId ||
        !doAflTradeArtifactRefsExactlyMatch(
          result.content.authority.evidenceBundleArtifact,
          admission.authority.evidenceBundleArtifact
        )
      ) {
        return null;
      }
      return result;
    },
  };
}

export function createAflTradePrivateConfirmedValuationResultArtifact(
  result: AflTradePrivateConfirmedValuationResult
): AflTradeArtifactRef {
  const parsed = aflTradePrivateConfirmedValuationResultSchema.parse(result);
  return createAflTradeCanonicalJsonArtifactRef(parsed, parsed.content.assembledAt);
}
