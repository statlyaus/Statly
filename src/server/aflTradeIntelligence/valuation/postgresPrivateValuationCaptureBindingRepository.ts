import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION,
  aflTradePrivateValuationCaptureSourceRoleSchema,
  getAflTradePrivateValuationCaptureSourceRole,
  parseAflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureBinding,
  type AflTradePrivateValuationCaptureSourceRole,
} from './privateValuationCaptureBinding';
import {
  aflTradePrivateValuationHpnSourceAdmissionSchema,
  aflTradePrivateValuationHpnSourceRoleSchema,
  type AflTradePrivateValuationHpnSourceAdmission,
} from './privateValuationHpnSourceAdmission';
import type { AflTradePrivateValuationCaptureBindingRepository } from './privateValuationRawDataCoordinator';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const claimIdSchema = z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/);
const leaseTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const normalizationRunIdSchema = z
  .string()
  .regex(/^provider-normalization-run:[a-f0-9]{64}$/);
const projectedFieldMapIdSchema = z
  .string()
  .regex(/^hpn-pav-field-map:[a-f0-9]{64}$/);
const factualOutputIdSchema = z
  .string()
  .regex(/^private-valuation-factual-output:[a-f0-9]{64}$/);
const hpnAdmissionResultSchema = z
  .object({
    state: z.enum(['admitted', 'already_admitted']),
    admission: aflTradePrivateValuationHpnSourceAdmissionSchema,
  })
  .strict();

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

  async admitHpnSource(input: {
    readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
    readonly claim: { readonly claimId: string; readonly leaseToken: string };
    readonly factualOutputId: string;
    readonly binding: AflTradePrivateValuationCaptureBinding;
    readonly projectedFieldMapId: string;
  }): Promise<{
    readonly state: 'admitted' | 'already_admitted';
    readonly admission: AflTradePrivateValuationHpnSourceAdmission;
  }> {
    const request = aflTradePrivateValuationDispatchRequestSchema.parse(input.request);
    const claimId = claimIdSchema.parse(input.claim.claimId);
    const leaseToken = leaseTokenSchema.parse(input.claim.leaseToken);
    const factualOutputId = factualOutputIdSchema.parse(input.factualOutputId);
    const binding = requireExactRequest(
      parseAflTradePrivateValuationCaptureBinding(input.binding),
      request
    );
    if (
      binding.content.schemaVersion !==
      AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION
    ) {
      throw new TypeError('HPN source admission requires role-aware capture custody.');
    }
    const sourceRole = aflTradePrivateValuationHpnSourceRoleSchema.parse(
      binding.content.sourceRole
    );
    const projectedFieldMapId = projectedFieldMapIdSchema.parse(
      input.projectedFieldMapId
    );
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly admission_result: unknown }>(
        `SELECT admit_outcome_private_valuation_hpn_source($1,$2,$3,$4,$5,$6,$7)
                AS admission_result`,
        [
          request.requestId,
          claimId,
          sha256(leaseToken),
          factualOutputId,
          sourceRole,
          binding.bindingId,
          projectedFieldMapId,
        ]
      );
    });
    if (result.rows.length !== 1) {
      throw new TypeError('HPN source admission did not return one exact receipt.');
    }
    const admitted = hpnAdmissionResultSchema.parse(result.rows[0]?.admission_result);
    if (
      admitted.admission.content.requestId !== request.requestId ||
      admitted.admission.content.dispatchClaimId !== binding.content.dispatchClaimId ||
      admitted.admission.content.sourceRole !== sourceRole ||
      admitted.admission.content.captureBindingId !== binding.bindingId ||
      admitted.admission.content.sourceCaptureId !== binding.content.sourceCaptureId ||
      admitted.admission.content.normalizationRunId !==
        binding.content.normalizationRunId ||
      admitted.admission.content.projectedFieldMapId !== projectedFieldMapId
    ) {
      throw new TypeError('HPN source admission disagrees with its dispatch source custody.');
    }
    return admitted;
  }
}
