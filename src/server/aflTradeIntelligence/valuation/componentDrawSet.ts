import { z } from 'zod';

import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeValuationComponentSchema } from '../artifacts/valuationBundleManifest';
import { AFL_TRADE_UNCERTAINTY_COMPONENTS } from '../modeling/deterministicUncertainty';

const FLOAT_TOLERANCE = 1e-8;
const finiteNumberSchema = z.number().finite();
const componentRoles = [
  'player_contribution_and_availability',
  'draft_pick_and_future_pick_distribution',
] as const;
const forecastViews = ['at_trade', 'remaining'] as const;

const exactExecutionSchema = z
  .object({
    mode: z.literal('exact_joint_mixture'),
    samplingAlgorithmVersion: z.null(),
    seed: z.null(),
    monteCarloError: z.literal('zero_exact_enumeration'),
  })
  .strict();

const sampledExecutionSchema = z
  .object({
    mode: z.literal('deterministic_counter_sample'),
    samplingAlgorithmVersion: z.literal('counter_sha256_rejection_v1'),
    seed: aflTradePublicIdSchema,
    monteCarloError: z.literal('requires_downstream_reporting'),
  })
  .strict();

const supportedAssetSchema = z
  .object({
    status: z.literal('supported'),
    assetId: aflTradePublicIdSchema,
    assetKind: z.enum(['player', 'current_pick_entitlement', 'future_pick_entitlement']),
    componentRole: z.enum(componentRoles),
    forecastRepresentation: z.literal('season_path'),
  })
  .strict();

const excludedAssetSchema = z
  .object({
    status: z.literal('excluded'),
    assetId: aflTradePublicIdSchema,
    assetKind: z.enum([
      'player',
      'current_pick_entitlement',
      'future_pick_entitlement',
      'unresolved',
      'unsupported_consideration',
    ]),
    componentRole: z.enum(componentRoles).nullable(),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(500),
  })
  .strict();

const seasonContributionSchema = z
  .object({
    seasonOffset: z.number().int().nonnegative().max(30),
    undiscountedContribution: finiteNumberSchema,
    footballTimingWeight: finiteNumberSchema.min(0).max(1),
    timingAdjustedContribution: finiteNumberSchema,
  })
  .strict()
  .superRefine((season, context) => {
    if (
      Math.abs(
        season.undiscountedContribution * season.footballTimingWeight -
          season.timingAdjustedContribution
      ) > FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['timingAdjustedContribution'],
        message: 'Season timing-adjusted contribution must equal raw contribution times weight.',
      });
    }
  });

const forecastSchema = z
  .object({
    view: z.enum(forecastViews),
    timingTreatment: z.literal('component_applied_football_timing_only_no_market_discount'),
    seasons: z.array(seasonContributionSchema).min(1).max(31),
    undiscountedContribution: finiteNumberSchema,
    timingAdjustedContribution: finiteNumberSchema,
  })
  .strict()
  .superRefine((forecast, context) => {
    const offsets = forecast.seasons.map((season) => season.seasonOffset);
    if (
      new Set(offsets).size !== offsets.length ||
      offsets.some((offset, index) => offset !== [...offsets].sort((a, b) => a - b)[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['seasons'],
        message: 'Forecast season offsets must be unique and canonical.',
      });
    }
    const raw = forecast.seasons.reduce((sum, season) => sum + season.undiscountedContribution, 0);
    const adjusted = forecast.seasons.reduce(
      (sum, season) => sum + season.timingAdjustedContribution,
      0
    );
    if (
      Math.abs(raw - forecast.undiscountedContribution) > FLOAT_TOLERANCE ||
      Math.abs(adjusted - forecast.timingAdjustedContribution) > FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Forecast totals must reconcile to their season path.',
      });
    }
  });

const assetOutcomeSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    componentRole: z.enum(componentRoles),
    forecasts: z.array(forecastSchema).length(forecastViews.length),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.forecasts.some((forecast, index) => forecast.view !== forecastViews[index])) {
      context.addIssue({
        code: 'custom',
        path: ['forecasts'],
        message: 'Asset forecasts must contain at-trade and remaining views in canonical order.',
      });
    }
  });

const sharedFactorStateSchema = z
  .object({
    kind: z.enum([
      'model_bootstrap',
      'draft_class',
      'future_ladder',
      'selection_rule',
      'other_declared',
    ]),
    factorKey: aflTradePublicIdSchema,
    stateId: aflTradePublicIdSchema,
  })
  .strict();

const jointDrawSchema = z
  .object({
    drawIndex: z.number().int().nonnegative().max(99_999),
    drawKey: aflTradePublicIdSchema,
    probabilityWeight: finiteNumberSchema.positive().max(1),
    sharedFactorStates: z.array(sharedFactorStateSchema).max(100),
    assetOutcomes: z.array(assetOutcomeSchema).min(1).max(100),
  })
  .strict();

const uncertaintyTreatmentSchema = z
  .object({
    kind: z.enum(AFL_TRADE_UNCERTAINTY_COMPONENTS),
    treatment: z.enum(['included_in_draws', 'reported_separately', 'not_available']),
    reasonCode: aflTradePublicIdSchema,
  })
  .strict();

export const aflTradeComponentDrawSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-component-draw-set/v1'),
    publicAssetBoundary: z.literal('source_native_afl_assets_no_user_or_fantasy_ownership'),
    valuationBundleId: aflTradeContentAddressedIdSchema('valuation-bundle'),
    valuationInputBundleId: aflTradeContentAddressedIdSchema('valuation-input-bundle').optional(),
    valueUnitId: aflTradePublicIdSchema,
    components: z.array(aflTradeValuationComponentSchema).length(componentRoles.length),
    execution: z.discriminatedUnion('mode', [exactExecutionSchema, sampledExecutionSchema]),
    assets: z
      .array(z.discriminatedUnion('status', [supportedAssetSchema, excludedAssetSchema]))
      .min(1)
      .max(100),
    draws: z.array(jointDrawSchema).min(1).max(100_000),
    uncertaintyTreatments: z
      .array(uncertaintyTreatmentSchema)
      .length(AFL_TRADE_UNCERTAINTY_COMPONENTS.length),
    limitation: z.literal(
      'Normalized source-independent component handoff only; not source approval, model calibration, Gate approval, or publication readiness.'
    ),
  })
  .strict()
  .superRefine((drawSet, context) => {
    const componentRoleValues = drawSet.components.map((component) => component.role);
    if (
      componentRoleValues.some((role, index) => role !== componentRoles[index]) ||
      new Set(componentRoleValues).size !== componentRoles.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Component runs must contain both governed roles in canonical order.',
      });
    }

    const assetIds = drawSet.assets.map((asset) => asset.assetId);
    if (
      new Set(assetIds).size !== assetIds.length ||
      assetIds.some((assetId, index) => assetId !== [...assetIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Component assets must have globally unique canonical identities.',
      });
    }
    const supportedAssets = drawSet.assets.filter(
      (asset): asset is z.infer<typeof supportedAssetSchema> => asset.status === 'supported'
    );
    if (supportedAssets.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'A component draw set must support at least one asset.',
      });
    }
    const supportedById = new Map(supportedAssets.map((asset) => [asset.assetId, asset]));
    const supportedIds = supportedAssets.map((asset) => asset.assetId);

    const drawKeys = drawSet.draws.map((draw) => draw.drawKey);
    const probabilityMass = drawSet.draws.reduce((sum, draw) => sum + draw.probabilityWeight, 0);
    if (
      new Set(drawKeys).size !== drawKeys.length ||
      drawSet.draws.some((draw, index) => draw.drawIndex !== index) ||
      Math.abs(probabilityMass - 1) > FLOAT_TOLERANCE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['draws'],
        message: 'Joint draws require unique keys, contiguous indices, and unit probability mass.',
      });
    }

    const expectedFactorKeys = drawSet.draws[0].sharedFactorStates.map(
      (factor) => `${factor.kind}:${factor.factorKey}`
    );
    for (const [drawIndex, draw] of drawSet.draws.entries()) {
      const outcomeIds = draw.assetOutcomes.map((outcome) => outcome.assetId);
      const factorKeys = draw.sharedFactorStates.map(
        (factor) => `${factor.kind}:${factor.factorKey}`
      );
      if (
        outcomeIds.length !== supportedIds.length ||
        outcomeIds.some((assetId, index) => assetId !== supportedIds[index]) ||
        factorKeys.some((factorKey, index) => factorKey !== expectedFactorKeys[index]) ||
        new Set(factorKeys).size !== factorKeys.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['draws', drawIndex],
          message:
            'Every joint draw must contain the same supported assets and shared-factor keys in canonical order.',
        });
      }
      for (const outcome of draw.assetOutcomes) {
        if (supportedById.get(outcome.assetId)?.componentRole !== outcome.componentRole) {
          context.addIssue({
            code: 'custom',
            path: ['draws', drawIndex, 'assetOutcomes'],
            message: 'Draw asset component roles must match the declared asset handoff.',
          });
        }
      }
    }

    const uncertaintyKinds = drawSet.uncertaintyTreatments.map((item) => item.kind);
    if (
      uncertaintyKinds.some((kind, index) => kind !== AFL_TRADE_UNCERTAINTY_COMPONENTS[index]) ||
      new Set(uncertaintyKinds).size !== AFL_TRADE_UNCERTAINTY_COMPONENTS.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['uncertaintyTreatments'],
        message: 'Every uncertainty component must be declared once in canonical order.',
      });
    }
    const monteCarloTreatment = drawSet.uncertaintyTreatments.find(
      (item) => item.kind === 'monte_carlo_error'
    );
    if (
      (drawSet.execution.mode === 'exact_joint_mixture' &&
        monteCarloTreatment?.treatment !== 'not_available') ||
      (drawSet.execution.mode === 'deterministic_counter_sample' &&
        monteCarloTreatment?.treatment !== 'reported_separately')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['uncertaintyTreatments'],
        message: 'Monte Carlo uncertainty treatment must match the draw execution mode.',
      });
    }
  });

export const aflTradeComponentDrawSetSchema = z
  .object({
    componentDrawSetId: aflTradeContentAddressedIdSchema('component-draw-set'),
    content: aflTradeComponentDrawSetContentSchema,
  })
  .strict()
  .superRefine((drawSet, context) => {
    addAflTradeContentAddressIssue(
      'component-draw-set',
      drawSet.componentDrawSetId,
      drawSet.content,
      context,
      ['componentDrawSetId']
    );
  });

export type AflTradeComponentDrawSetContent = z.infer<typeof aflTradeComponentDrawSetContentSchema>;
export type AflTradeComponentDrawSet = z.infer<typeof aflTradeComponentDrawSetSchema>;

export function createAflTradeComponentDrawSet(
  unparsedContent: AflTradeComponentDrawSetContent
): AflTradeComponentDrawSet {
  const content = aflTradeComponentDrawSetContentSchema.parse({
    ...unparsedContent,
    components: [...unparsedContent.components].sort(
      (left, right) => componentRoles.indexOf(left.role) - componentRoles.indexOf(right.role)
    ),
    assets: [...unparsedContent.assets].sort((left, right) =>
      left.assetId.localeCompare(right.assetId)
    ),
    draws: [...unparsedContent.draws]
      .sort((left, right) => left.drawIndex - right.drawIndex)
      .map((draw) => ({
        ...draw,
        sharedFactorStates: [...draw.sharedFactorStates].sort((left, right) =>
          `${left.kind}:${left.factorKey}`.localeCompare(`${right.kind}:${right.factorKey}`)
        ),
        assetOutcomes: [...draw.assetOutcomes]
          .sort((left, right) => left.assetId.localeCompare(right.assetId))
          .map((outcome) => ({
            ...outcome,
            forecasts: [...outcome.forecasts]
              .sort(
                (left, right) =>
                  forecastViews.indexOf(left.view) - forecastViews.indexOf(right.view)
              )
              .map((forecast) => ({
                ...forecast,
                seasons: [...forecast.seasons].sort(
                  (left, right) => left.seasonOffset - right.seasonOffset
                ),
              })),
          })),
      })),
    uncertaintyTreatments: [...unparsedContent.uncertaintyTreatments].sort(
      (left, right) =>
        AFL_TRADE_UNCERTAINTY_COMPONENTS.indexOf(left.kind) -
        AFL_TRADE_UNCERTAINTY_COMPONENTS.indexOf(right.kind)
    ),
  });
  return aflTradeComponentDrawSetSchema.parse({
    componentDrawSetId: createAflTradeContentAddress('component-draw-set', content),
    content,
  });
}
