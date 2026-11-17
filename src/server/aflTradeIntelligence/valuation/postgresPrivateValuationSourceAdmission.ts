import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateValuationSupplementalSourceAdmissionSchema,
  parseAflTradePrivateValuationSupplementalSourceAdmission,
  parseAflTradePrivateValuationSourceAdmission,
  type AflTradePrivateValuationSourceAdmission,
  type AflTradePrivateValuationSupplementalSourceAdmission,
} from './privateValuationSourceAdmission';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const requestIdSchema = z.string().regex(/^private-valuation-dispatch:[a-f0-9]{64}$/);
const claimIdSchema = z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/);
const leaseTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const admissionResultSchema = z
  .object({
    state: z.enum(['admitted', 'already_admitted']),
    admission: z.unknown(),
  })
  .strict();

export type AflTradePrivateValuationSourceAdmissionResult =
  | { readonly state: 'admitted'; readonly admission: AflTradePrivateValuationSourceAdmission }
  | {
      readonly state: 'already_admitted';
      readonly admission: AflTradePrivateValuationSourceAdmission;
    };

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class PostgresAflTradePrivateValuationSourceAdmission {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async admitSupplemental(input: Pick<
    AflTradePrivateValuationSupplementalSourceAdmission['content'],
    | 'requestId' | 'sourceRole' | 'primarySourceAdmissionId' | 'captureBindingId'
    | 'sourceCaptureId' | 'normalizationRunId' | 'factBatchId' | 'factualRunId'
  > & { readonly claim: { readonly claimId: string; readonly leaseToken: string } }): Promise<{
    readonly state: 'admitted' | 'already_admitted';
    readonly admission: AflTradePrivateValuationSupplementalSourceAdmission;
  }> {
    const selected = aflTradePrivateValuationSupplementalSourceAdmissionSchema.shape.content.pick({
      requestId: true, sourceRole: true, primarySourceAdmissionId: true, captureBindingId: true,
      sourceCaptureId: true, normalizationRunId: true, factBatchId: true, factualRunId: true,
    }).parse({
      requestId: input.requestId, sourceRole: input.sourceRole,
      primarySourceAdmissionId: input.primarySourceAdmissionId, captureBindingId: input.captureBindingId,
      sourceCaptureId: input.sourceCaptureId, normalizationRunId: input.normalizationRunId,
      factBatchId: input.factBatchId, factualRunId: input.factualRunId,
    });
    const claimId = claimIdSchema.parse(input.claim.claimId);
    const leaseToken = leaseTokenSchema.parse(input.claim.leaseToken);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const retained = await transaction.query<{ admission_result: unknown }>(
        `SELECT admit_outcome_private_valuation_supplemental_source($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          AS admission_result`,
        [selected.requestId, claimId, sha256(leaseToken), selected.sourceRole,
          selected.primarySourceAdmissionId, selected.captureBindingId, selected.sourceCaptureId,
          selected.normalizationRunId, selected.factBatchId, selected.factualRunId]
      );
      if (retained.rows.length !== 1) throw new TypeError('Expected one exact supplemental source admission.');
      const result = admissionResultSchema.parse(retained.rows[0]?.admission_result);
      const admission = parseAflTradePrivateValuationSupplementalSourceAdmission(result.admission);
      for (const key of Object.keys(selected) as (keyof typeof selected)[]) {
        if (admission.content[key] !== selected[key]) {
          throw new TypeError('Database custody disagrees with the exact supplemental source selection.');
        }
      }
      return { state: result.state, admission };
    });
  }

  async admit(input: {
    readonly requestId: string;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
  }): Promise<AflTradePrivateValuationSourceAdmissionResult> {
    const requestId = requestIdSchema.parse(input.requestId);
    const claimId = claimIdSchema.parse(input.claim.claimId);
    const leaseToken = leaseTokenSchema.parse(input.claim.leaseToken);
    const retained = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ admission_result: unknown }>(
        `SELECT admit_outcome_private_valuation_dispatch_source($1,$2,$3)
                AS admission_result`,
        [requestId, claimId, sha256(leaseToken)]
      );
    });
    if (retained.rows.length !== 1) {
      throw new TypeError('Source admission did not retain exactly one result.');
    }
    const result = admissionResultSchema.parse(retained.rows[0]?.admission_result);
    return {
      state: result.state,
      admission: parseAflTradePrivateValuationSourceAdmission(result.admission),
    };
  }
}
