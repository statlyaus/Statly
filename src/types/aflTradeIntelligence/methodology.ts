import { z } from 'zod';

import {
  addAflTradeUniqueArrayIssue,
  aflTradeIsoDateTimeSchema,
  aflTradeNextActionSchema,
  aflTradePublicHrefSchema,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
  aflTradeScopeDescriptionSchema,
  aflTradeValueUnitSchema,
} from './shared';
import { aflTradeConsistencyEnvelopeSchema } from './response';
import { AFL_TRADE_VALUATION_VIEWS, aflTradeValuationViewSchema } from './value';

export const AFL_TRADE_METHODOLOGY_COMPONENT_ROLES = [
  'player_contribution_and_availability',
  'draft_pick_and_future_pick_distribution',
] as const;

export const aflTradeMethodologyComponentSchema = z
  .object({
    role: z.enum(AFL_TRADE_METHODOLOGY_COMPONENT_ROLES),
    modelVersion: aflTradePublicIdSchema,
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

export const aflTradeTrainingPeriodSchema = z
  .object({
    firstSeason: z.number().int().min(1897).max(2200),
    lastSeason: z.number().int().min(1897).max(2200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.firstSeason > value.lastSeason) {
      context.addIssue({
        code: 'custom',
        path: ['lastSeason'],
        message: 'The training period cannot end before it starts.',
      });
    }
  });

export const aflTradePublishedMethodologySchema = z
  .object({
    valuationBundleId: z.string().regex(/^valuation-bundle:[a-f0-9]{64}$/),
    modelVersion: aflTradePublicIdSchema,
    components: z.array(aflTradeMethodologyComponentSchema).length(
      AFL_TRADE_METHODOLOGY_COMPONENT_ROLES.length
    ),
    valueUnit: aflTradeValueUnitSchema,
    primaryOutcome: z
      .object({
        code: aflTradePublicIdSchema,
        label: z.string().trim().min(1).max(120),
        definition: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    trainingPeriod: aflTradeTrainingPeriodSchema,
    calculationAsOf: aflTradeIsoDateTimeSchema,
    supportedViews: z.array(aflTradeValuationViewSchema).min(1).max(
      AFL_TRADE_VALUATION_VIEWS.length
    ),
    supportedDataCoverage: z.array(aflTradeScopeDescriptionSchema).min(1).max(100),
    knownLimitations: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
    materialChangesFromPrevious: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = value.components.map((component) => component.role);
    addAflTradeUniqueArrayIssue(
      roles,
      context,
      'Published methodology components must have unique roles.',
      ['components']
    );
    if (AFL_TRADE_METHODOLOGY_COMPONENT_ROLES.some((role) => !roles.includes(role))) {
      context.addIssue({
        code: 'custom',
        path: ['components'],
        message: 'Published methodology must identify every governed valuation component.',
      });
    }
    addAflTradeUniqueArrayIssue(
      value.supportedViews,
      context,
      'Published methodology views must be unique.',
      ['supportedViews']
    );
    addAflTradeUniqueArrayIssue(
      value.supportedDataCoverage,
      context,
      'Published methodology coverage entries must be unique.',
      ['supportedDataCoverage']
    );
    addAflTradeUniqueArrayIssue(
      value.knownLimitations,
      context,
      'Published methodology limitations must be unique.',
      ['knownLimitations']
    );
    addAflTradeUniqueArrayIssue(
      value.materialChangesFromPrevious,
      context,
      'Published methodology change entries must be unique.',
      ['materialChangesFromPrevious']
    );
  });

const methodologyResponseBase = {
  consistency: aflTradeConsistencyEnvelopeSchema,
  methodologyHref: aflTradePublicHrefSchema,
};

const unavailableMethodologyResponseSchema = z
  .object({
    ...methodologyResponseBase,
    availability: z.literal('unavailable'),
    reasonCode: aflTradePublicIdSchema,
    message: aflTradePublicMessageSchema,
    nextAction: aflTradeNextActionSchema.nullable(),
    methodology: z.null(),
  })
  .strict();

const publishedMethodologyResponseSchema = z
  .object({
    ...methodologyResponseBase,
    availability: z.literal('published'),
    methodology: aflTradePublishedMethodologySchema,
  })
  .strict();

export const aflTradeMethodologyResponseSchema = z
  .discriminatedUnion('availability', [
    unavailableMethodologyResponseSchema,
    publishedMethodologyResponseSchema,
  ])
  .superRefine((value, context) => {
    if (value.availability === 'unavailable') {
      if (value.consistency.selection !== 'none' || value.consistency.publication !== null) {
        context.addIssue({
          code: 'custom',
          path: ['consistency'],
          message: 'Unavailable methodology must not claim a selected publication.',
        });
      }
      return;
    }

    const publication = value.consistency.publication;
    if (publication === null || value.consistency.selection === 'none') {
      context.addIssue({
        code: 'custom',
        path: ['consistency', 'publication'],
        message: 'Published methodology requires one selected immutable publication.',
      });
      return;
    }
    if (publication.state === 'withdrawn') {
      context.addIssue({
        code: 'custom',
        path: ['consistency', 'publication', 'state'],
        message: 'Withdrawn publications cannot expose published methodology as active.',
      });
    }
    if (value.methodology.valuationBundleId !== publication.valuationBundleId) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'valuationBundleId'],
        message: 'Methodology must describe the selected publication valuation bundle.',
      });
    }
    if (value.methodology.valueUnit.id !== publication.valueUnitId) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'valueUnit', 'id'],
        message: 'Methodology must describe the selected publication value unit.',
      });
    }
    if (value.methodology.calculationAsOf !== value.consistency.calculationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'calculationAsOf'],
        message: 'Methodology calculation time must match the selected projection.',
      });
    }
    const supportedViews = new Set(value.methodology.supportedViews);
    if (
      value.methodology.supportedViews.length !== AFL_TRADE_VALUATION_VIEWS.length ||
      AFL_TRADE_VALUATION_VIEWS.some((view) => !supportedViews.has(view))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['methodology', 'supportedViews'],
        message: 'Published methodology must explain every public valuation view.',
      });
    }
  });

export type AflTradePublishedMethodology = z.infer<typeof aflTradePublishedMethodologySchema>;
export type AflTradeMethodologyResponse = z.infer<typeof aflTradeMethodologyResponseSchema>;
