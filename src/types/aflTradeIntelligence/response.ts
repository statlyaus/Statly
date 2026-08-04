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
  type AflTradeValueResult,
} from './value';

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
  results: readonly AflTradeValueResult[];
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
    valuation: aflTradeValueResultSchema,
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

export const aflTradeValueDetailResponseSchema = z
  .object({
    consistency: aflTradeConsistencyEnvelopeSchema,
    tradeId: aflTradePublicIdSchema,
    valuations: z.array(aflTradeValueResultSchema).min(1).max(AFL_TRADE_VALUATION_VIEWS.length),
    lineageStatus: z.enum(['resolved', 'partial', 'unavailable']),
    unresolvedAssetCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(
      value.valuations.map((valuation) => valuation.view),
      context,
      'Detail valuations must have unique views.',
      ['valuations']
    );
    if (value.lineageStatus === 'resolved' && value.unresolvedAssetCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedAssetCount'],
        message: 'Resolved lineage cannot report unresolved assets.',
      });
    }
    if (value.lineageStatus === 'partial' && value.unresolvedAssetCount < 1) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedAssetCount'],
        message: 'Partial lineage must report at least one unresolved asset.',
      });
    }
    validateResponseConsistency(
      { consistency: value.consistency, results: value.valuations },
      context
    );
  });

export type AflTradeConsistencyEnvelope = z.infer<typeof aflTradeConsistencyEnvelopeSchema>;
export type AflTradeValueListItem = z.infer<typeof aflTradeValueListItemSchema>;
export type AflTradeValueListResponse = z.infer<typeof aflTradeValueListResponseSchema>;
export type AflTradeValueDetailResponse = z.infer<typeof aflTradeValueDetailResponseSchema>;
