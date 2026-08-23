import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseAflTradePrivateValuationSourceAdmission,
  type AflTradePrivateValuationSourceAdmission,
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
