import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

const claimInputSchema = z.object({
  requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
  claim: z
    .object({
      claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
      leaseToken: aflTradeSha256Schema,
    })
    .strict(),
});
const selectionSchema = claimInputSchema
  .extend({
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
  })
  .strict();

export const aflTradePrivateValuationCohortBindingSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    factualOperationId: aflTradeContentAddressedIdSchema(
      'current-valuation-factual-refresh-operation'
    ),
    privateFactualCandidateId: aflTradeContentAddressedIdSchema('private-factual-candidate'),
    privateFactualRevision: z.number().int().positive(),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    cohortCandidateId: aflTradeContentAddressedIdSchema('factual-release-candidate'),
    cohortReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    cohortScopeKey: z.literal('afl-men:2025-trades'),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
    sourceCaptureSetSha256: aflTradeSha256Schema,
    promotionSourceSetSha256: aflTradeSha256Schema,
    effectiveThrough: z.iso.datetime({ offset: true }),
    cohortTradeIds: z.array(z.string().trim().min(1).max(1000)).min(1).max(100_000),
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.cohortTradeIds.some(
        (id, index) => index > 0 && binding.cohortTradeIds[index - 1]! >= id
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cohortTradeIds'],
        message: 'Cohort transaction identifiers must be unique and canonically ordered.',
      });
    }
  });

export type AflTradePrivateValuationCohortBinding = z.infer<
  typeof aflTradePrivateValuationCohortBindingSchema
>;

/** Select existing admitted target-cohort custody; never construct or approve source authority. */
export class PostgresAflTradePrivateValuationCohortBinding {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async bind(
    input: z.input<typeof selectionSchema>
  ): Promise<AflTradePrivateValuationCohortBinding> {
    const selection = selectionSchema.parse(input);
    const binding = await this.read(selection, selection.lineageAdmissionId);
    if (binding === null) throw new TypeError('Cohort selection was not retained.');
    if (binding.lineageAdmissionId !== selection.lineageAdmissionId) {
      throw new TypeError('Cohort binding names another selected lineage admission.');
    }
    return binding;
  }

  async load(
    input: z.input<typeof claimInputSchema>
  ): Promise<AflTradePrivateValuationCohortBinding | null> {
    return this.read(claimInputSchema.parse(input));
  }

  private async read(input: z.infer<typeof claimInputSchema>, lineageAdmissionId?: string) {
    return this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const claimParameters = [
        input.requestId,
        input.claim.claimId,
        createHash('sha256').update(input.claim.leaseToken, 'utf8').digest('hex'),
      ];
      if (lineageAdmissionId === undefined) {
        await transaction.query(
          'SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)',
          claimParameters
        );
      }
      const result = await transaction.query<{ readonly binding_json: unknown }>(
        lineageAdmissionId === undefined
          ? 'SELECT load_outcome_private_valuation_cohort_input($1) AS binding_json'
          : 'SELECT bind_outcome_private_valuation_cohort_input($1,$2,$3,$4) AS binding_json',
        lineageAdmissionId === undefined
          ? [input.requestId]
          : [...claimParameters, lineageAdmissionId]
      );
      if (result.rows.length !== 1) throw new TypeError('Cohort authority lookup is ambiguous.');
      if (result.rows[0]!.binding_json === null) return null;
      const binding = aflTradePrivateValuationCohortBindingSchema.parse(
        result.rows[0]!.binding_json
      );
      if (binding.requestId !== input.requestId)
        throw new TypeError('Cohort binding belongs to another request.');
      return binding;
    });
  }
}
