import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS, aflTradeGateScopeSchema } from './gateDecisionTypes';

const isoDateTimeSchema = z.string().datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeNonNegativeIntegerStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const aflTradePositiveIntegerStringSchema = z.string().regex(/^[1-9][0-9]*$/);

export const aflTradeExactRatioSchema = z
  .object({
    numerator: aflTradeNonNegativeIntegerStringSchema,
    denominator: aflTradePositiveIntegerStringSchema,
  })
  .strict()
  .superRefine((ratio, context) => {
    if (BigInt(ratio.numerator) > BigInt(ratio.denominator)) {
      context.addIssue({
        code: 'custom',
        path: ['numerator'],
        message: 'A ratio numerator cannot exceed its denominator.',
      });
    }
  });

const temporalWindowSchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Window must be non-empty.' });
    }
  });

const cohortSchema = z
  .object({
    cohortId: publicIdSchema,
    description: boundedTextSchema,
    dimensions: z
      .array(
        z
          .object({
            name: publicIdSchema,
            values: z.array(publicIdSchema).min(1).max(500),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict();

const measureSchema = z
  .object({
    measureId: publicIdSchema,
    category: z.enum([
      'coverage',
      'missingness',
      'identity_readiness',
      'lineage_readiness',
      'reconciliation',
      'cohort_maturity',
      'split_eligibility',
    ]),
    description: boundedTextSchema,
    numeratorDefinition: boundedTextSchema,
    denominatorDefinition: boundedTextSchema,
    cohortIds: z.array(publicIdSchema).min(1).max(500),
    requiredForApproval: z.boolean(),
    minimumRatio: aflTradeExactRatioSchema.nullable(),
  })
  .strict()
  .superRefine((measure, context) => {
    if (measure.requiredForApproval && measure.minimumRatio === null) {
      context.addIssue({
        code: 'custom',
        path: ['minimumRatio'],
        message: 'A required measure needs a prespecified minimum ratio.',
      });
    }
    if (new Set(measure.cohortIds).size !== measure.cohortIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['cohortIds'],
        message: 'Measure cohort references must be unique.',
      });
    }
  });

export const aflTradeDataSufficiencyProtocolContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-data-sufficiency-protocol/v1'),
    protocolKey: publicIdSchema,
    version: z.number().int().positive(),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    evidenceManifestId: aflTradeContentAddressedIdSchema('evidence'),
    scope: aflTradeGateScopeSchema,
    estimand: boundedTextSchema,
    cohorts: z.array(cohortSchema).min(1).max(500),
    measures: z.array(measureSchema).min(1).max(1000),
    nullZeroSemantics: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(300),
            unknownMeaning: boundedTextSchema,
            observedZeroMeaning: boundedTextSchema,
          })
          .strict()
      )
      .min(1)
      .max(1000),
    candidateWindows: z
      .object({
        train: temporalWindowSchema,
        calibration: temporalWindowSchema,
        validation: temporalWindowSchema,
        finalTest: temporalWindowSchema,
        embargoDays: z.number().int().nonnegative(),
      })
      .strict(),
    exclusions: z.array(boundedTextSchema).max(500),
    proposedAt: isoDateTimeSchema,
    proposedBy: publicIdSchema,
    proposalOrigin: z.enum(['human_authored', 'agent_assisted']),
  })
  .strict()
  .superRefine((protocol, context) => {
    const cohortIds = protocol.cohorts.map((cohort) => cohort.cohortId);
    if (new Set(cohortIds).size !== cohortIds.length) {
      context.addIssue({ code: 'custom', path: ['cohorts'], message: 'Cohorts must be unique.' });
    }
    const knownCohorts = new Set(cohortIds);
    const measureIds = protocol.measures.map((measure) => measure.measureId);
    if (new Set(measureIds).size !== measureIds.length) {
      context.addIssue({ code: 'custom', path: ['measures'], message: 'Measures must be unique.' });
    }
    for (const [index, measure] of protocol.measures.entries()) {
      if (measure.cohortIds.some((cohortId) => !knownCohorts.has(cohortId))) {
        context.addIssue({
          code: 'custom',
          path: ['measures', index, 'cohortIds'],
          message: 'Every measure cohort must be declared by the protocol.',
        });
      }
    }
    const windows = [
      protocol.candidateWindows.train,
      protocol.candidateWindows.calibration,
      protocol.candidateWindows.validation,
      protocol.candidateWindows.finalTest,
    ];
    for (let index = 1; index < windows.length; index += 1) {
      const requiredFrom =
        Date.parse(windows[index - 1].to) + protocol.candidateWindows.embargoDays * 86_400_000;
      if (Date.parse(windows[index].from) < requiredFrom) {
        context.addIssue({
          code: 'custom',
          path: ['candidateWindows'],
          message: 'Candidate windows must be chronological and respect the declared embargo.',
        });
        break;
      }
    }
  });

export const aflTradeDataSufficiencyProtocolSchema = z
  .object({
    protocolId: aflTradeContentAddressedIdSchema('data-sufficiency-protocol'),
    content: aflTradeDataSufficiencyProtocolContentSchema,
  })
  .strict()
  .superRefine((protocol, context) => {
    addAflTradeContentAddressIssue(
      'data-sufficiency-protocol',
      protocol.protocolId,
      protocol.content,
      context,
      ['protocolId']
    );
  });

export type AflTradeExactRatio = z.infer<typeof aflTradeExactRatioSchema>;
export type AflTradeDataSufficiencyProtocol = z.infer<typeof aflTradeDataSufficiencyProtocolSchema>;
