import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateValuationCaptureSourceRoleSchema,
  getAflTradePrivateValuationCaptureSourceRole,
  parseAflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureSourceRole,
} from './privateValuationCaptureBinding';
import type { AflTradePrivateValuationCaptureBindingRepository } from './privateValuationRawDataCoordinator';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const claimIdSchema = z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/);
const leaseTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const normalizationRunIdSchema = z
  .string()
  .regex(/^provider-normalization-run:[a-f0-9]{64}$/);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireExactRequest(
  binding: AflTradePrivateValuationCaptureBinding,
  request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>
): AflTradePrivateValuationCaptureBinding {
  if (canonicalizeAflTradeJson(binding.content.request) !== canonicalizeAflTradeJson(request)) {
    throw new TypeError('Retained capture binding conflicts with the requested dispatch.');
  }
  return binding;
}

export class PostgresAflTradePrivateValuationCaptureBindingRepository
  implements AflTradePrivateValuationCaptureBindingRepository
{
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async load(
    unparsedRequest: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>,
    unparsedSourceRole: AflTradePrivateValuationCaptureSourceRole = 'factual_input'
  ): Promise<AflTradePrivateValuationCaptureBinding | null> {
    const request = aflTradePrivateValuationDispatchRequestSchema.parse(unparsedRequest);
    const sourceRole = aflTradePrivateValuationCaptureSourceRoleSchema.parse(unparsedSourceRole);
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly binding_json: unknown }>(
        `SELECT binding_json
           FROM outcome_private_valuation_capture_binding
          WHERE request_id=$1 AND source_role=$2`,
        [request.requestId, sourceRole]
      );
    });
    const row = result.rows[0];
    if (row === undefined) return null;
    if (result.rows.length !== 1) {
      throw new TypeError('Dispatch has more than one accepted capture binding.');
    }
    const binding = requireExactRequest(
      parseAflTradePrivateValuationCaptureBinding(row.binding_json),
      request
    );
    if (getAflTradePrivateValuationCaptureSourceRole(binding) !== sourceRole) {
      throw new TypeError('Retained capture binding conflicts with the requested source role.');
    }
    return binding;
  }

  async accept(input: {
    readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
    readonly sourceRole?: AflTradePrivateValuationCaptureSourceRole;
    readonly normalizationRunId: string;
  }): Promise<AflTradePrivateValuationCaptureBinding> {
    const request = aflTradePrivateValuationDispatchRequestSchema.parse(input.request);
    const claimId = claimIdSchema.parse(input.claim.claimId);
    const leaseToken = leaseTokenSchema.parse(input.claim.leaseToken);
    const sourceRole = aflTradePrivateValuationCaptureSourceRoleSchema.parse(
      input.sourceRole ?? 'factual_input'
    );
    const normalizationRunId = normalizationRunIdSchema.parse(input.normalizationRunId);
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly binding_json: unknown }>(
        `SELECT accept_outcome_private_valuation_dispatch_capture($1,$2,$3,$4,$5)
                AS binding_json`,
        [request.requestId, claimId, sha256(leaseToken), sourceRole, normalizationRunId]
      );
    });
    const binding = requireExactRequest(
      parseAflTradePrivateValuationCaptureBinding(result.rows[0]?.binding_json),
      request
    );
    if (
      result.rows.length !== 1 ||
      binding.content.dispatchClaimId !== claimId ||
      getAflTradePrivateValuationCaptureSourceRole(binding) !== sourceRole ||
      binding.content.normalizationRunId !== normalizationRunId
    ) {
      throw new TypeError('Accepted capture binding disagrees with its dispatch claim or source.');
    }
    return binding;
  }
}
