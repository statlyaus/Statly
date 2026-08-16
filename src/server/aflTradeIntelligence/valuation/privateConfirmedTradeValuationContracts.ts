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
    if (incomplete && content.overallGrade.reason !== 'asset_values_incomplete') {
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
  ): Promise<AflTradePrivateConfirmedValuationResult | null>;
}

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
      const result = aflTradePrivateConfirmedValuationResultSchema.parse(unparsed);
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
