import { z } from 'zod';

import {
  addAflTradeUniqueArrayIssue,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
} from './shared';
import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeOutcomeDistributionSummarySchema,
  aflTradeUncertaintySchema,
  aflTradeValuationViewSchema,
  aflTradeValueFactorSchema,
} from './value';

export const AFL_TRADE_PUBLIC_ASSET_KINDS = [
  'player',
  'current_pick_entitlement',
  'future_pick_entitlement',
  'draft_selection',
  'package',
  'unresolved',
  'unsupported_consideration',
] as const;

const currentValueComponentsSchema = z
  .object({
    realizedValue: z.number().finite(),
    remainingValue: z.number().finite(),
  })
  .strict();

export const aflTradeAssetValueAvailableSchema = z
  .object({
    status: z.literal('valued'),
    view: aflTradeValuationViewSchema,
    estimate: z.number().finite(),
    estimateStatistic: z.literal('mean'),
    uncertainty: aflTradeUncertaintySchema,
    distribution: aflTradeOutcomeDistributionSummarySchema,
    factors: z.array(aflTradeValueFactorSchema).max(20),
    currentComponents: currentValueComponentsSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.view === 'current') {
      if (value.currentComponents === null) {
        context.addIssue({
          code: 'custom',
          path: ['currentComponents'],
          message: 'Current asset value requires realized and remaining components.',
        });
      } else if (
        Math.abs(
          value.currentComponents.realizedValue +
            value.currentComponents.remainingValue -
            value.estimate
        ) > 1e-9
      ) {
        context.addIssue({
          code: 'custom',
          path: ['currentComponents'],
          message: 'Current asset value must equal realized plus remaining value.',
        });
      }
    } else if (value.currentComponents !== null) {
      context.addIssue({
        code: 'custom',
        path: ['currentComponents'],
        message: 'Only the current view may contain realized and remaining components.',
      });
    }
    if (
      value.distribution.downside.value > value.uncertainty.median ||
      value.uncertainty.median > value.distribution.upside.value
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distribution'],
        message: 'Asset downside and upside values must bracket the median.',
      });
    }
  });

export const aflTradeAssetValueExcludedSchema = z
  .object({
    status: z.literal('excluded'),
    view: aflTradeValuationViewSchema,
    reasonCode: aflTradePublicIdSchema,
    message: aflTradePublicMessageSchema,
  })
  .strict();

export const aflTradeAssetValueResultSchema = z.discriminatedUnion('status', [
  aflTradeAssetValueAvailableSchema,
  aflTradeAssetValueExcludedSchema,
]);

export const aflTradeAssetLineageSummarySchema = z
  .object({
    status: z.enum(['resolved', 'partial']),
    rootAssetId: aflTradePublicIdSchema,
    creditedAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(
      value.creditedAssetIds,
      context,
      'Credited lineage asset identifiers must be unique.',
      ['creditedAssetIds']
    );
  });

export const aflTradeAssetBreakdownSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    assetKind: z.enum(AFL_TRADE_PUBLIC_ASSET_KINDS),
    label: z.string().trim().min(1).max(200),
    receivedByAflClubId: aflTradePublicIdSchema,
    lineage: aflTradeAssetLineageSummarySchema,
    values: z.array(aflTradeAssetValueResultSchema).min(1).max(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lineage.rootAssetId !== value.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'rootAssetId'],
        message: 'An asset breakdown must use the traded asset as its lineage root.',
      });
    }
    addAflTradeUniqueArrayIssue(
      value.values.map((assetValue) => assetValue.view),
      context,
      'Asset valuation views must be unique.',
      ['values']
    );
  });

const unavailableLineageSummarySchema = z
  .object({
    status: z.literal('unavailable'),
    totalAssetCount: z.null(),
    resolvedAssetCount: z.null(),
    unresolvedAssetCount: z.null(),
    lineageEdgeCount: z.null(),
    maximumDepth: z.null(),
  })
  .strict();

const resolvedLineageSummarySchema = z
  .object({
    status: z.literal('resolved'),
    totalAssetCount: z.number().int().positive(),
    resolvedAssetCount: z.number().int().positive(),
    unresolvedAssetCount: z.literal(0),
    lineageEdgeCount: z.number().int().nonnegative(),
    maximumDepth: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolvedAssetCount !== value.totalAssetCount) {
      context.addIssue({ code: 'custom', message: 'Resolved lineage must include every asset.' });
    }
  });

const partialLineageSummarySchema = z
  .object({
    status: z.literal('partial'),
    totalAssetCount: z.number().int().positive(),
    resolvedAssetCount: z.number().int().nonnegative(),
    unresolvedAssetCount: z.number().int().positive(),
    lineageEdgeCount: z.number().int().nonnegative(),
    maximumDepth: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolvedAssetCount + value.unresolvedAssetCount !== value.totalAssetCount) {
      context.addIssue({
        code: 'custom',
        message: 'Partial lineage resolved and unresolved counts must equal the total.',
      });
    }
  });

export const aflTradeLineageSummarySchema = z.discriminatedUnion('status', [
  unavailableLineageSummarySchema,
  resolvedLineageSummarySchema,
  partialLineageSummarySchema,
]);

export type AflTradeAssetValueResult = z.infer<typeof aflTradeAssetValueResultSchema>;
export type AflTradeAssetBreakdown = z.infer<typeof aflTradeAssetBreakdownSchema>;
export type AflTradeLineageSummary = z.infer<typeof aflTradeLineageSummarySchema>;
