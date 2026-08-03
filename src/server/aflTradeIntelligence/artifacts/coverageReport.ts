import { z } from 'zod';

import {
  AFL_TRADE_DECISION_ENVIRONMENTS,
  type AflTradeDecisionEnvironment,
} from '../governance/gateDecisionTypes';
import {
  aflTradeDataSufficiencyProtocolSchema,
  aflTradeExactRatioSchema,
  type AflTradeDataSufficiencyProtocol,
  type AflTradeExactRatio,
} from '../governance/dataSufficiencyProtocol';
import { aflTradeArtifactRefSchema } from './artifactReference';
import { addAflTradeContentAddressIssue, aflTradeContentAddressedIdSchema } from './contentAddress';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const boundedTextSchema = z.string().trim().min(1).max(1000);
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const measuredObservationSchema = z
  .object({
    measureId: publicIdSchema,
    cohortId: publicIdSchema,
    status: z.literal('measured'),
    observedRatio: aflTradeExactRatioSchema,
    supportingArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(50),
  })
  .strict();

const unmeasurableObservationSchema = z
  .object({
    measureId: publicIdSchema,
    cohortId: publicIdSchema,
    status: z.literal('unmeasurable'),
    reason: z.enum([
      'source_field_unavailable',
      'denominator_unavailable',
      'identity_unresolved',
      'lineage_unresolved',
      'cohort_empty',
      'evidence_invalid',
    ]),
    explanation: boundedTextSchema,
    supportingArtifacts: z.array(aflTradeArtifactRefSchema).max(50),
  })
  .strict();

export const aflTradeCoverageObservationSchema = z.discriminatedUnion('status', [
  measuredObservationSchema,
  unmeasurableObservationSchema,
]);

export const aflTradeCoverageReportContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-coverage-report/v1'),
    protocolId: aflTradeContentAddressedIdSchema('data-sufficiency-protocol'),
    evidenceManifestId: aflTradeContentAddressedIdSchema('evidence'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    sourceRegisterIds: z.array(publicIdSchema).min(1).max(50),
    measurementStartedAt: isoDateTimeSchema,
    measurementCompletedAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    observations: z.array(aflTradeCoverageObservationSchema).min(1).max(100_000),
    findings: z.array(boundedTextSchema).max(1000),
    excludedCohorts: z.array(publicIdSchema).max(500),
  })
  .strict()
  .superRefine((report, context) => {
    if (new Set(report.sourceRegisterIds).size !== report.sourceRegisterIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRegisterIds'],
        message: 'Coverage-report sources must be unique.',
      });
    }
    const observationKeys = report.observations.map(
      (observation) => `${observation.measureId}|${observation.cohortId}`
    );
    if (new Set(observationKeys).size !== observationKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Each measure and cohort pair must have exactly one observation.',
      });
    }
    if (Date.parse(report.measurementCompletedAt) < Date.parse(report.measurementStartedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['measurementCompletedAt'],
        message: 'Coverage measurement cannot finish before it starts.',
      });
    }
    if (Date.parse(report.createdAt) < Date.parse(report.measurementCompletedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'A coverage report cannot be created before measurement completes.',
      });
    }
  });

export const aflTradeCoverageReportSchema = z
  .object({
    reportId: aflTradeContentAddressedIdSchema('coverage-report'),
    content: aflTradeCoverageReportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue('coverage-report', report.reportId, report.content, context, [
      'reportId',
    ]);
  });

export type AflTradeCoverageProtocolIssueCode =
  | 'protocol_invalid'
  | 'report_invalid'
  | 'protocol_mismatch'
  | 'evidence_mismatch'
  | 'environment_mismatch'
  | 'protocol_not_preregistered'
  | 'observation_missing'
  | 'observation_unknown';

export interface AflTradeCoverageProtocolIssue {
  code: AflTradeCoverageProtocolIssueCode;
  subject: string;
  message: string;
}

export interface AflTradeCoverageThresholdOutcome {
  measureId: string;
  cohortId: string;
  requiredForApproval: boolean;
  status: 'met' | 'not_met' | 'unmeasurable' | 'missing' | 'report_only';
}

export interface AflTradeCoverageProtocolValidation {
  valid: boolean;
  approvalEligible: boolean;
  issues: AflTradeCoverageProtocolIssue[];
  outcomes: AflTradeCoverageThresholdOutcome[];
}

function ratioAtLeast(observed: AflTradeExactRatio, minimum: AflTradeExactRatio): boolean {
  return (
    BigInt(observed.numerator) * BigInt(minimum.denominator) >=
    BigInt(minimum.numerator) * BigInt(observed.denominator)
  );
}

interface CoverageRequirement {
  measureId: string;
  cohortId: string;
  requiredForApproval: boolean;
  minimumRatio: AflTradeExactRatio | null;
}

type CoverageObservation = z.infer<typeof aflTradeCoverageObservationSchema>;

function observationKey(measureId: string, cohortId: string): string {
  return `${measureId}|${cohortId}`;
}

function collectCoverageRelationshipIssues(
  protocol: AflTradeDataSufficiencyProtocol,
  report: AflTradeCoverageReport
): AflTradeCoverageProtocolIssue[] {
  const issues: AflTradeCoverageProtocolIssue[] = [];
  if (report.content.protocolId !== protocol.protocolId) {
    issues.push({
      code: 'protocol_mismatch',
      subject: report.content.protocolId,
      message: 'The coverage report must reference the exact prespecified protocol.',
    });
  }
  if (report.content.evidenceManifestId !== protocol.content.evidenceManifestId) {
    issues.push({
      code: 'evidence_mismatch',
      subject: report.content.evidenceManifestId,
      message: 'The coverage report and protocol must reference the same evidence manifest.',
    });
  }
  if (report.content.environment !== protocol.content.environment) {
    issues.push({
      code: 'environment_mismatch',
      subject: report.content.environment,
      message: 'The coverage report and protocol must use the same environment.',
    });
  }
  if (Date.parse(protocol.content.proposedAt) > Date.parse(report.content.measurementStartedAt)) {
    issues.push({
      code: 'protocol_not_preregistered',
      subject: protocol.protocolId,
      message: 'The sufficiency protocol must exist before coverage measurement starts.',
    });
  }
  return issues;
}

function indexCoverageRequirements(
  protocol: AflTradeDataSufficiencyProtocol
): Map<string, CoverageRequirement> {
  const expected = new Map<string, CoverageRequirement>();
  for (const measure of protocol.content.measures) {
    for (const cohortId of measure.cohortIds) {
      expected.set(observationKey(measure.measureId, cohortId), {
        measureId: measure.measureId,
        cohortId,
        requiredForApproval: measure.requiredForApproval,
        minimumRatio: measure.minimumRatio,
      });
    }
  }
  return expected;
}

function indexCoverageObservations(
  report: AflTradeCoverageReport
): Map<string, CoverageObservation> {
  return new Map(
    report.content.observations.map((observation) => [
      observationKey(observation.measureId, observation.cohortId),
      observation,
    ])
  );
}

function collectCoverageObservationIssues(
  expected: ReadonlyMap<string, CoverageRequirement>,
  observations: ReadonlyMap<string, CoverageObservation>
): AflTradeCoverageProtocolIssue[] {
  const issues: AflTradeCoverageProtocolIssue[] = [];
  for (const key of expected.keys()) {
    if (!observations.has(key)) {
      issues.push({
        code: 'observation_missing',
        subject: key,
        message: `Coverage observation ${key} is missing.`,
      });
    }
  }
  for (const key of observations.keys()) {
    if (!expected.has(key)) {
      issues.push({
        code: 'observation_unknown',
        subject: key,
        message: `Coverage observation ${key} was not prespecified.`,
      });
    }
  }
  return issues;
}

function coverageOutcomeStatus(
  requirement: CoverageRequirement,
  observation: CoverageObservation | undefined
): AflTradeCoverageThresholdOutcome['status'] {
  if (!observation) return 'missing';
  if (observation.status === 'unmeasurable') return 'unmeasurable';
  if (requirement.minimumRatio === null) return 'report_only';
  return ratioAtLeast(observation.observedRatio, requirement.minimumRatio) ? 'met' : 'not_met';
}

function evaluateCoverageOutcomes(
  expected: ReadonlyMap<string, CoverageRequirement>,
  observations: ReadonlyMap<string, CoverageObservation>
): AflTradeCoverageThresholdOutcome[] {
  return [...expected].map(([key, requirement]) => ({
    measureId: requirement.measureId,
    cohortId: requirement.cohortId,
    requiredForApproval: requirement.requiredForApproval,
    status: coverageOutcomeStatus(requirement, observations.get(key)),
  }));
}

export function validateAflTradeCoverageAgainstProtocol(
  unparsedProtocol: AflTradeDataSufficiencyProtocol,
  unparsedReport: AflTradeCoverageReport
): AflTradeCoverageProtocolValidation {
  const issues: AflTradeCoverageProtocolIssue[] = [];
  const parsedProtocol = aflTradeDataSufficiencyProtocolSchema.safeParse(unparsedProtocol);
  const parsedReport = aflTradeCoverageReportSchema.safeParse(unparsedReport);
  if (!parsedProtocol.success) {
    issues.push({
      code: 'protocol_invalid',
      subject: 'protocol',
      message: 'The data-sufficiency protocol is malformed or fails content-address validation.',
    });
  }
  if (!parsedReport.success) {
    issues.push({
      code: 'report_invalid',
      subject: 'report',
      message: 'The coverage report is malformed or fails content-address validation.',
    });
  }
  if (!parsedProtocol.success || !parsedReport.success) {
    return { valid: false, approvalEligible: false, issues, outcomes: [] };
  }
  const protocol = parsedProtocol.data;
  const report = parsedReport.data;
  issues.push(...collectCoverageRelationshipIssues(protocol, report));

  const expected = indexCoverageRequirements(protocol);
  const observations = indexCoverageObservations(report);
  issues.push(...collectCoverageObservationIssues(expected, observations));
  const outcomes = evaluateCoverageOutcomes(expected, observations);

  const valid = issues.length === 0;
  const approvalEligible =
    valid && outcomes.every((outcome) => !outcome.requiredForApproval || outcome.status === 'met');
  return { valid, approvalEligible, issues, outcomes };
}

export type AflTradeCoverageObservation = z.infer<typeof aflTradeCoverageObservationSchema>;
export type AflTradeCoverageReport = z.infer<typeof aflTradeCoverageReportSchema>;
export type AflTradeCoverageEnvironment = AflTradeDecisionEnvironment;
