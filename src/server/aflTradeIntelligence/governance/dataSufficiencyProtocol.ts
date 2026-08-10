import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS, aflTradeGateScopeSchema } from './gateDecisionTypes';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeNonNegativeIntegerStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const aflTradePositiveIntegerStringSchema = z.string().regex(/^[1-9][0-9]*$/);

export const AFL_TRADE_REQUIRED_EVIDENCE_LANES = [
  'transactions_and_lineage',
  'player_contribution_and_availability',
  'point_in_time_current_state',
] as const;

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
  .strict()
  .superRefine((cohort, context) => {
    const dimensionNames = cohort.dimensions.map((dimension) => dimension.name);
    if (new Set(dimensionNames).size !== dimensionNames.length) {
      context.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Cohort dimension names must be unique.',
      });
    }
    cohort.dimensions.forEach((dimension, index) => {
      if (new Set(dimension.values).size !== dimension.values.length) {
        context.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'values'],
          message: 'Cohort dimension values must be unique.',
        });
      }
    });
  });

const evidenceLaneSchema = z
  .object({
    lane: z.enum(AFL_TRADE_REQUIRED_EVIDENCE_LANES),
    description: boundedTextSchema,
    requiredFields: z.array(publicIdSchema).min(1).max(500),
    cohortIds: z.array(publicIdSchema).min(1).max(500),
  })
  .strict()
  .superRefine((lane, context) => {
    if (new Set(lane.requiredFields).size !== lane.requiredFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['requiredFields'],
        message: 'Evidence-lane fields must be unique.',
      });
    }
    if (new Set(lane.cohortIds).size !== lane.cohortIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['cohortIds'],
        message: 'Evidence-lane cohort references must be unique.',
      });
    }
  });

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
    evidenceLanes: z.array(z.enum(AFL_TRADE_REQUIRED_EVIDENCE_LANES)).min(1),
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
    if (new Set(measure.evidenceLanes).size !== measure.evidenceLanes.length) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceLanes'],
        message: 'Measure evidence-lane references must be unique.',
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
    evidenceLanes: z.array(evidenceLaneSchema).length(AFL_TRADE_REQUIRED_EVIDENCE_LANES.length),
    identityAndQuarantinePolicy: z
      .object({
        automaticIdentityMerge: z.literal('prohibited'),
        ambiguousIdentity: z.literal('quarantine'),
        unresolvedIdentity: z.literal('quarantine'),
        conflictingEvidence: z.literal('quarantine'),
        quarantinedApprovalNumerator: z.literal('excluded'),
        quarantinedEligibleDenominator: z.literal('included'),
        manualResolutionRequiresEvidence: z.literal(true),
      })
      .strict(),
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
    const evidenceLaneIds = protocol.evidenceLanes.map((lane) => lane.lane);
    const knownEvidenceLanes = new Set(evidenceLaneIds);
    const requiredEvidenceLanes = new Set(AFL_TRADE_REQUIRED_EVIDENCE_LANES);
    if (
      knownEvidenceLanes.size !== evidenceLaneIds.length ||
      evidenceLaneIds.some((lane) => !requiredEvidenceLanes.has(lane)) ||
      AFL_TRADE_REQUIRED_EVIDENCE_LANES.some((lane) => !knownEvidenceLanes.has(lane))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceLanes'],
        message: 'Evidence lanes must cover the exact required set once each.',
      });
    }
    protocol.evidenceLanes.forEach((lane, index) => {
      if (lane.cohortIds.some((cohortId) => !knownCohorts.has(cohortId))) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceLanes', index, 'cohortIds'],
          message: 'Every evidence-lane cohort must be declared by the protocol.',
        });
      }
    });
    const measureIds = protocol.measures.map((measure) => measure.measureId);
    if (new Set(measureIds).size !== measureIds.length) {
      context.addIssue({ code: 'custom', path: ['measures'], message: 'Measures must be unique.' });
    }
    const semanticFields = protocol.nullZeroSemantics.map((semantic) => semantic.field);
    if (new Set(semanticFields).size !== semanticFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['nullZeroSemantics'],
        message: 'Null and zero semantics must declare each field exactly once.',
      });
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
    const approvalCoverage = new Map<string, Set<string>>();
    for (const measure of protocol.measures) {
      if (!measure.requiredForApproval) continue;
      for (const lane of measure.evidenceLanes) {
        const coveredCohorts = approvalCoverage.get(lane) ?? new Set<string>();
        for (const cohortId of measure.cohortIds) coveredCohorts.add(cohortId);
        approvalCoverage.set(lane, coveredCohorts);
      }
    }
    for (const [laneIndex, lane] of protocol.evidenceLanes.entries()) {
      for (const cohortId of lane.cohortIds) {
        if (!approvalCoverage.get(lane.lane)?.has(cohortId)) {
          context.addIssue({
            code: 'custom',
            path: ['evidenceLanes', laneIndex, 'cohortIds'],
            message: `Evidence lane ${lane.lane} cohort ${cohortId} requires an approval measure.`,
          });
        }
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
