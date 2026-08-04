import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeCalculationRunSchema } from './calculationRunContracts';

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z.string().trim().min(1).max(200);

export const AFL_TRADE_OPERATIONAL_HEALTH_STATES = [
  'healthy',
  'degraded',
  'blocked',
  'critical',
] as const;

export const AFL_TRADE_PUBLICATION_RECOMMENDATIONS = [
  'serve_active',
  'serve_active_with_warning',
  'retain_last_good',
  'suppress_numbers',
  'withdraw_active',
] as const;

export const AFL_TRADE_CALCULATION_RECOMMENDATIONS = [
  'none',
  'monitor',
  'retry',
  'investigate',
  'stop_new_work',
] as const;

export const AFL_TRADE_OPERATIONAL_ALERT_CODES = [
  'source_rights_not_approved',
  'source_rights_evidence_stale',
  'active_projection_integrity_failed',
  'active_projection_unavailable',
  'active_projection_check_stale',
  'active_publication_stale',
  'calculation_attempt_stalled',
  'calculation_failed_retryable',
  'calculation_failed_terminal',
  'calculation_cancelled',
  'candidate_awaiting_governance',
  'no_active_publication',
] as const;

const activePublicationSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    registryRevision: z.number().int().nonnegative(),
    activatedAt: isoDateTimeSchema,
    dataAsOf: isoDateTimeSchema,
  })
  .strict();

const projectionCheckSchema = z
  .object({
    publicationId: aflTradeContentAddressedIdSchema('publication'),
    projectionId: aflTradeContentAddressedIdSchema('projection'),
    status: z.enum(['healthy', 'unavailable', 'integrity_failed']),
    checkedAt: isoDateTimeSchema,
    evidenceId: publicIdSchema,
  })
  .strict();

export const aflTradeOperationalHealthInputSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-operational-health-input/v1'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    evaluatedAt: isoDateTimeSchema,
    sourceRights: z
      .object({
        status: z.enum(['approved', 'blocked', 'withdrawn', 'unknown']),
        checkedAt: isoDateTimeSchema,
        evidenceId: publicIdSchema,
      })
      .strict(),
    activePublication: activePublicationSchema.nullable(),
    activeProjectionCheck: projectionCheckSchema.nullable(),
    latestRun: aflTradeCalculationRunSchema.nullable(),
    thresholds: z
      .object({
        maximumPublicationAgeSeconds: z.number().int().positive().max(31_536_000),
        maximumRunSilenceSeconds: z.number().int().positive().max(86_400),
        maximumSourceEvidenceAgeSeconds: z.number().int().positive().max(31_536_000),
        maximumProjectionCheckAgeSeconds: z.number().int().positive().max(604_800),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const evaluatedAt = Date.parse(input.evaluatedAt);
    if (Date.parse(input.sourceRights.checkedAt) > evaluatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRights', 'checkedAt'],
        message: 'Source-rights evidence cannot postdate the health evaluation.',
      });
    }
    if (input.activePublication) {
      if (
        Date.parse(input.activePublication.activatedAt) > evaluatedAt ||
        Date.parse(input.activePublication.dataAsOf) >
          Date.parse(input.activePublication.activatedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['activePublication'],
          message: 'Publication data must exist by activation, which cannot postdate evaluation.',
        });
      }
      if (!input.activeProjectionCheck) {
        context.addIssue({
          code: 'custom',
          path: ['activeProjectionCheck'],
          message: 'An active publication requires a projection check.',
        });
      }
    } else if (input.activeProjectionCheck) {
      context.addIssue({
        code: 'custom',
        path: ['activeProjectionCheck'],
        message: 'Projection checks require an active publication.',
      });
    }
    if (input.activePublication && input.activeProjectionCheck) {
      if (
        input.activePublication.publicationId !== input.activeProjectionCheck.publicationId ||
        input.activePublication.projectionId !== input.activeProjectionCheck.projectionId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['activeProjectionCheck'],
          message: 'The projection check must pin the active publication and projection.',
        });
      }
      if (Date.parse(input.activeProjectionCheck.checkedAt) > evaluatedAt) {
        context.addIssue({
          code: 'custom',
          path: ['activeProjectionCheck', 'checkedAt'],
          message: 'Projection evidence cannot postdate the health evaluation.',
        });
      }
    }
    if (input.latestRun && input.latestRun.inputs.scopeKey !== input.scopeKey) {
      context.addIssue({
        code: 'custom',
        path: ['latestRun', 'inputs', 'scopeKey'],
        message: 'The latest calculation run must match the evaluated public scope.',
      });
    }
    if (input.latestRun && Date.parse(input.latestRun.updatedAt) > evaluatedAt) {
      context.addIssue({
        code: 'custom',
        path: ['latestRun', 'updatedAt'],
        message: 'Calculation activity cannot postdate the health evaluation.',
      });
    }
  });

const alertSchema = z
  .object({
    code: z.enum(AFL_TRADE_OPERATIONAL_ALERT_CODES),
    severity: z.enum(['info', 'warning', 'critical']),
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aflTradeOperationalHealthSnapshotSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-operational-health/v1'),
    healthSnapshotId: aflTradeContentAddressedIdSchema('health-snapshot'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    scopeKey: publicIdSchema,
    evaluatedAt: isoDateTimeSchema,
    state: z.enum(AFL_TRADE_OPERATIONAL_HEALTH_STATES),
    publicationRecommendation: z.enum(AFL_TRADE_PUBLICATION_RECOMMENDATIONS),
    calculationRecommendation: z.enum(AFL_TRADE_CALCULATION_RECOMMENDATIONS),
    activePublicationId: aflTradeContentAddressedIdSchema('publication').nullable(),
    retainedPublicationId: aflTradeContentAddressedIdSchema('publication').nullable(),
    candidatePublicationId: aflTradeContentAddressedIdSchema('publication').nullable(),
    alerts: z.array(alertSchema).max(20),
  })
  .strict();

export type AflTradeOperationalHealthInput = z.infer<typeof aflTradeOperationalHealthInputSchema>;
export type AflTradeOperationalHealthSnapshot = z.infer<
  typeof aflTradeOperationalHealthSnapshotSchema
>;
type OperationalAlert = z.infer<typeof alertSchema>;

function ageSeconds(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 1_000;
}

export function evaluateAflTradeOperationalHealth(
  unparsedInput: AflTradeOperationalHealthInput
): AflTradeOperationalHealthSnapshot {
  const input = aflTradeOperationalHealthInputSchema.parse(unparsedInput);
  const activePublicationId = input.activePublication?.publicationId ?? null;
  const candidatePublicationId = input.latestRun?.candidatePublicationId ?? null;
  const alerts: OperationalAlert[] = [];
  let state: AflTradeOperationalHealthSnapshot['state'] = 'healthy';
  let publicationRecommendation: AflTradeOperationalHealthSnapshot['publicationRecommendation'] =
    input.activePublication ? 'serve_active' : 'suppress_numbers';
  let calculationRecommendation: AflTradeOperationalHealthSnapshot['calculationRecommendation'] =
    'none';
  const sourceEvidenceStale =
    ageSeconds(input.sourceRights.checkedAt, input.evaluatedAt) >
    input.thresholds.maximumSourceEvidenceAgeSeconds;
  const projectionCheckStale =
    input.activeProjectionCheck !== null &&
    ageSeconds(input.activeProjectionCheck.checkedAt, input.evaluatedAt) >
      input.thresholds.maximumProjectionCheckAgeSeconds;

  if (input.sourceRights.status !== 'approved' || sourceEvidenceStale) {
    alerts.push({
      code: sourceEvidenceStale ? 'source_rights_evidence_stale' : 'source_rights_not_approved',
      severity: 'critical',
      message: sourceEvidenceStale
        ? 'Source-rights evidence is older than the approved operational threshold.'
        : 'Approved source use is not currently evidenced; numerical serving must stop.',
    });
    state = input.sourceRights.status === 'unknown' || sourceEvidenceStale ? 'blocked' : 'critical';
    publicationRecommendation = input.activePublication ? 'withdraw_active' : 'suppress_numbers';
    calculationRecommendation = 'stop_new_work';
  } else if (input.activeProjectionCheck?.status === 'integrity_failed') {
    alerts.push({
      code: 'active_projection_integrity_failed',
      severity: 'critical',
      message: 'The active projection failed integrity verification and should be withdrawn.',
    });
    state = 'critical';
    publicationRecommendation = 'withdraw_active';
    calculationRecommendation = 'investigate';
  } else if (input.activeProjectionCheck?.status === 'unavailable') {
    alerts.push({
      code: 'active_projection_unavailable',
      severity: 'critical',
      message:
        'The active projection cannot be read; suppress numbers while operators investigate.',
    });
    state = 'critical';
    publicationRecommendation = 'suppress_numbers';
    calculationRecommendation = 'investigate';
  } else if (projectionCheckStale) {
    alerts.push({
      code: 'active_projection_check_stale',
      severity: 'critical',
      message: 'Projection health evidence is too old to support numerical serving.',
    });
    state = 'critical';
    publicationRecommendation = 'suppress_numbers';
    calculationRecommendation = 'investigate';
  } else if (!input.activePublication) {
    alerts.push({
      code: 'no_active_publication',
      severity: 'warning',
      message: 'No governed publication is active for this public scope.',
    });
    state = 'blocked';
  } else if (
    ageSeconds(input.activePublication.dataAsOf, input.evaluatedAt) >
    input.thresholds.maximumPublicationAgeSeconds
  ) {
    alerts.push({
      code: 'active_publication_stale',
      severity: 'warning',
      message: 'The active publication exceeds the declared freshness threshold.',
    });
    state = 'degraded';
    publicationRecommendation = 'serve_active_with_warning';
  }

  if (input.latestRun && calculationRecommendation !== 'stop_new_work') {
    const run = input.latestRun;
    if (
      (run.state === 'queued' || run.state === 'running') &&
      ageSeconds(run.updatedAt, input.evaluatedAt) > input.thresholds.maximumRunSilenceSeconds
    ) {
      alerts.push({
        code: 'calculation_attempt_stalled',
        severity: 'critical',
        message: 'The latest calculation attempt has exceeded its activity threshold.',
      });
      state = state === 'critical' ? state : 'degraded';
      calculationRecommendation = 'investigate';
    } else if (run.state === 'queued' || run.state === 'running') {
      if (calculationRecommendation === 'none') calculationRecommendation = 'monitor';
    } else if (run.state === 'failed') {
      const latest = run.attempts.at(-1);
      const retryable = latest?.state === 'failed' && latest.result.retryable;
      alerts.push({
        code: retryable ? 'calculation_failed_retryable' : 'calculation_failed_terminal',
        severity: 'warning',
        message: retryable
          ? 'The latest calculation failed and is eligible for a controlled retry.'
          : 'The latest calculation failed and requires investigation before another run.',
      });
      state = state === 'critical' ? state : 'degraded';
      if (calculationRecommendation !== 'investigate') {
        calculationRecommendation = retryable ? 'retry' : 'investigate';
      }
      if (input.activePublication && publicationRecommendation === 'serve_active') {
        publicationRecommendation = 'retain_last_good';
      }
    } else if (run.state === 'cancelled') {
      alerts.push({
        code: 'calculation_cancelled',
        severity: 'info',
        message: 'The latest calculation was cancelled without changing publication authority.',
      });
    } else if (run.state === 'succeeded') {
      alerts.push({
        code: 'candidate_awaiting_governance',
        severity: 'info',
        message: 'A successful candidate exists but still requires publication governance.',
      });
    }
  }

  return aflTradeOperationalHealthSnapshotSchema.parse({
    schemaVersion: 'afl-trade-operational-health/v1',
    healthSnapshotId: createAflTradeContentAddress('health-snapshot', input),
    environment: input.environment,
    scopeKey: input.scopeKey,
    evaluatedAt: input.evaluatedAt,
    state,
    publicationRecommendation,
    calculationRecommendation,
    activePublicationId,
    retainedPublicationId:
      publicationRecommendation === 'retain_last_good' ? activePublicationId : null,
    candidatePublicationId,
    alerts,
  });
}
