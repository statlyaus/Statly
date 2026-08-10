import { z } from 'zod';

import {
  addAflTradeUniqueArrayIssue,
  aflTradeIsoDateTimeSchema,
  aflTradePublicationRefSchema,
  aflTradePublicIdSchema,
  aflTradePublicWarningSchema,
  aflTradeScopeDescriptionSchema,
} from './shared';
import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradeValuationViewSchema,
  aflTradeValueResultSchema,
  isAflTradeValueBearingAvailability,
  type AflTradeValueBearing,
  type AflTradeValueResult,
} from './value';
import { aflTradeValueSummarySchema, type AflTradeValueSummary } from './summary';
import {
  aflTradeAssetBreakdownSchema,
  aflTradeLineageSummarySchema,
  type AflTradeAssetBreakdown,
  type AflTradeLineageSummary,
} from './detail';

export const aflTradeProjectionBuildIdSchema = z.string().regex(/^projection:[a-f0-9]{64}$/);

export const aflTradeConsistencyEnvelopeSchema = z
  .object({
    contractVersion: z.literal('afl-trade-value/v2'),
    selection: z.enum(['active', 'explicit_historical', 'none']),
    publication: aflTradePublicationRefSchema.nullable(),
    registryRevision: z.number().int().nonnegative(),
    projectionBuildId: aflTradeProjectionBuildIdSchema.nullable(),
    servedAt: aflTradeIsoDateTimeSchema,
    calculationAsOf: aflTradeIsoDateTimeSchema.nullable(),
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema.nullable(),
    freshness: z.enum(['current', 'stale', 'withdrawn', 'unavailable']),
    supportedScope: z.array(aflTradeScopeDescriptionSchema).max(100),
    excludedScope: z.array(aflTradeScopeDescriptionSchema).max(100),
    warnings: z.array(aflTradePublicWarningSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(
      value.supportedScope,
      context,
      'Supported scope entries must be unique.',
      ['supportedScope']
    );
    addAflTradeUniqueArrayIssue(
      value.excludedScope,
      context,
      'Excluded scope entries must be unique.',
      ['excludedScope']
    );
    const overlap = value.supportedScope.filter((entry) => value.excludedScope.includes(entry));
    if (overlap.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['excludedScope'],
        message: 'A scope cannot be both supported and excluded.',
      });
    }

    if (value.selection === 'none') {
      if (
        value.publication !== null ||
        value.projectionBuildId !== null ||
        value.calculationAsOf !== null ||
        value.knowledgeCutoffAt !== null ||
        value.freshness !== 'unavailable'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'No-publication selection cannot contain publication calculation metadata.',
        });
      }
      return;
    }

    if (
      value.publication === null ||
      value.projectionBuildId === null ||
      value.calculationAsOf === null ||
      value.knowledgeCutoffAt === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Selected publications require complete consistency metadata.',
      });
      return;
    }
    if (value.selection === 'active' && value.publication.state !== 'published') {
      context.addIssue({
        code: 'custom',
        path: ['publication', 'state'],
        message: 'The active selection must reference a published publication.',
      });
    }
    if (value.freshness === 'withdrawn' && value.publication.state !== 'withdrawn') {
      context.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'Withdrawn freshness requires a withdrawn publication.',
      });
    }
    if (value.publication.state === 'withdrawn' && value.freshness !== 'withdrawn') {
      context.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'A withdrawn publication must be served with withdrawn freshness.',
      });
    }
    const servedAt = Date.parse(value.servedAt);
    const calculationAsOf = Date.parse(value.calculationAsOf);
    const knowledgeCutoffAt = Date.parse(value.knowledgeCutoffAt);
    const publishedAt = Date.parse(value.publication.publishedAt);
    if (calculationAsOf > servedAt || publishedAt > servedAt) {
      context.addIssue({
        code: 'custom',
        path: ['servedAt'],
        message: 'A response cannot be served before its calculation or publication.',
      });
    }
    if (knowledgeCutoffAt > calculationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'The publication knowledge cutoff cannot follow its calculation as-of time.',
      });
    }
  });

interface ResponseConsistencyValue {
  consistency: z.infer<typeof aflTradeConsistencyEnvelopeSchema>;
  results: readonly (AflTradeValueResult | AflTradeValueSummary)[];
}

function validateResponseConsistency(value: ResponseConsistencyValue, context: z.RefinementCtx) {
  const hasValue = value.results.some((result) =>
    isAflTradeValueBearingAvailability(result.availability)
  );
  if (hasValue && value.consistency.publication === null) {
    context.addIssue({
      code: 'custom',
      path: ['consistency', 'publication'],
      message: 'Numerical results require one selected immutable publication.',
    });
  }
  if (hasValue && value.consistency.publication?.state === 'withdrawn') {
    context.addIssue({
      code: 'custom',
      path: ['consistency', 'publication', 'state'],
      message: 'Withdrawn publications cannot serve numerical results.',
    });
  }
  if (
    value.consistency.publication !== null &&
    value.results.some(
      (result) =>
        'unit' in result && result.unit.id !== value.consistency.publication?.valueUnitId
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['consistency', 'publication', 'valueUnitId'],
      message: 'Every numerical result must use the selected publication value unit.',
    });
  }
  const hasWithdrawn = value.results.some((result) => result.availability === 'withdrawn');
  if (hasWithdrawn && value.consistency.publication?.state !== 'withdrawn') {
    context.addIssue({
      code: 'custom',
      path: ['consistency', 'publication'],
      message: 'Withdrawn results must identify the withdrawn publication.',
    });
  }
}

export const aflTradeValueListItemSchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    valuation: aflTradeValueSummarySchema,
  })
  .strict();

export const aflTradeValueListResponseSchema = z
  .object({
    consistency: aflTradeConsistencyEnvelopeSchema,
    requestedView: aflTradeValuationViewSchema,
    items: z.array(aflTradeValueListItemSchema).max(100),
    page: z
      .object({
        limit: z.number().int().min(1).max(100),
        nextCursor: z.string().min(1).max(1000).nullable(),
        total: z.number().int().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.items.length > value.page.limit) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'A list response cannot contain more items than its page limit.',
      });
    }
    if (value.page.total !== null && value.page.total < value.items.length) {
      context.addIssue({
        code: 'custom',
        path: ['page', 'total'],
        message: 'A reported total cannot be smaller than the returned page.',
      });
    }
    addAflTradeUniqueArrayIssue(
      value.items.map((item) => item.tradeId),
      context,
      'List trade identifiers must be unique.',
      ['items']
    );
    if (value.items.some((item) => item.valuation.view !== value.requestedView)) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Every list valuation must match the requested view.',
      });
    }
    validateResponseConsistency(
      { consistency: value.consistency, results: value.items.map((item) => item.valuation) },
      context
    );
  });

interface DetailBreakdownValue {
  valuations: readonly AflTradeValueResult[];
  assets: readonly AflTradeAssetBreakdown[];
  lineageSummary: AflTradeLineageSummary;
}

function validateDetailBreakdowns(value: DetailBreakdownValue, context: z.RefinementCtx) {
  const numericalValuations = value.valuations.filter(
    (valuation): valuation is AflTradeValueBearing =>
      isAflTradeValueBearingAvailability(valuation.availability)
  );
  if (numericalValuations.length === 0) {
    if (value.assets.length > 0 || value.lineageSummary.status !== 'unavailable') {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Detail without numerical valuations cannot claim asset attribution or lineage.',
      });
    }
    return;
  }

  if (value.assets.length === 0 || value.lineageSummary.status === 'unavailable') {
    context.addIssue({
      code: 'custom',
      path: ['assets'],
      message: 'Numerical detail requires asset attribution and a resolved or partial lineage summary.',
    });
    return;
  }

  addAflTradeUniqueArrayIssue(
    value.assets.map((asset) => asset.assetId),
    context,
    'Detail asset identifiers must be unique.',
    ['assets']
  );
  addAflTradeUniqueArrayIssue(
    value.assets.flatMap((asset) => asset.lineage.creditedAssetIds),
    context,
    'A lineage-frontier asset cannot be credited to more than one traded root.',
    ['assets']
  );
  if (value.lineageSummary.totalAssetCount !== value.assets.length) {
    context.addIssue({
      code: 'custom',
      path: ['lineageSummary', 'totalAssetCount'],
      message: 'Lineage total must equal the number of attributed trade assets.',
    });
  }
  const partialLineageCount = value.assets.filter(
    (asset) => asset.lineage.status === 'partial'
  ).length;
  if (
    value.lineageSummary.unresolvedAssetCount !== partialLineageCount ||
    value.lineageSummary.resolvedAssetCount !== value.assets.length - partialLineageCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['lineageSummary'],
      message: 'Lineage summary counts must reconcile with asset lineage statuses.',
    });
  }

  const numericalViews = numericalValuations.map((valuation) => valuation.view).sort();
  for (const [assetIndex, asset] of value.assets.entries()) {
    const assetViews = asset.values.map((assetValue) => assetValue.view).sort();
    if (
      assetViews.length !== numericalViews.length ||
      assetViews.some((view, index) => view !== numericalViews[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets', assetIndex, 'values'],
        message: 'Every asset must report each and only numerical detail view.',
      });
    }
  }

  for (const valuation of numericalValuations) {
    if (valuation.coverage.totalAssetCount !== value.assets.length) {
      context.addIssue({
        code: 'custom',
        path: ['valuations'],
        message: 'Valuation coverage total must equal the detail asset count.',
      });
    }

    const excludedAssetIds = value.assets
      .filter((asset) =>
        asset.values.some(
          (assetValue) => assetValue.view === valuation.view && assetValue.status === 'excluded'
        )
      )
      .map((asset) => asset.assetId)
      .sort();
    const coverageExcludedAssetIds = valuation.coverage.excludedAssets
      .map((asset) => asset.assetId)
      .sort();
    if (
      excludedAssetIds.length !== coverageExcludedAssetIds.length ||
      excludedAssetIds.some((assetId, index) => assetId !== coverageExcludedAssetIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Per-asset exclusions must exactly match valuation coverage exclusions.',
      });
    }

    for (const clubValue of valuation.clubValues) {
      const attributedEstimate = value.assets.reduce((sum, asset) => {
        if (asset.receivedByAflClubId !== clubValue.aflClubId) return sum;
        const assetValue = asset.values.find((entry) => entry.view === valuation.view);
        return assetValue?.status === 'valued' ? sum + assetValue.estimate : sum;
      }, 0);
      if (Math.abs(attributedEstimate - clubValue.estimate) > 1e-9) {
        context.addIssue({
          code: 'custom',
          path: ['assets'],
          message: `Attributed ${valuation.view} asset values must sum to ${clubValue.aflClubId}'s club value.`,
        });
      }
    }

    const valuedClubIds = new Set(valuation.clubValues.map((clubValue) => clubValue.aflClubId));
    if (value.assets.some((asset) => !valuedClubIds.has(asset.receivedByAflClubId))) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Every receiving AFL club must belong to the valued trade comparison.',
      });
    }
  }
}

export const aflTradeValueDetailResponseSchema = z
  .object({
    consistency: aflTradeConsistencyEnvelopeSchema,
    tradeId: aflTradePublicIdSchema,
    valuations: z.array(aflTradeValueResultSchema).min(1).max(AFL_TRADE_VALUATION_VIEWS.length),
    assets: z.array(aflTradeAssetBreakdownSchema).max(100),
    lineageSummary: aflTradeLineageSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(
      value.valuations.map((valuation) => valuation.view),
      context,
      'Detail valuations must have unique views.',
      ['valuations']
    );
    validateDetailBreakdowns(value, context);
    validateResponseConsistency(
      { consistency: value.consistency, results: value.valuations },
      context
    );
  });

export type AflTradeConsistencyEnvelope = z.infer<typeof aflTradeConsistencyEnvelopeSchema>;
export type AflTradeValueListItem = z.infer<typeof aflTradeValueListItemSchema>;
export type AflTradeValueListResponse = z.infer<typeof aflTradeValueListResponseSchema>;
export type AflTradeValueDetailResponse = z.infer<typeof aflTradeValueDetailResponseSchema>;
