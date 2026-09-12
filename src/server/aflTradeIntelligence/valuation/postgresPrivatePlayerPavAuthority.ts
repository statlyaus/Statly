import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';

const selectionSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: aflTradeSha256Schema,
      })
      .strict(),
    policyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
  })
  .strict();

const bindingSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    factualOutputId: aflTradeContentAddressedIdSchema('private-valuation-factual-output'),
    policyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    policyApprovalDecisionId: aflTradeContentAddressedIdSchema('review-decision'),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
    lineageId: aflTradeContentAddressedIdSchema('corpus-factual-lineage'),
    corpusId: aflTradeContentAddressedIdSchema('corpus'),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
    featureHistorySeasons: z.number().int().min(1).max(10),
    fixedHorizonSeasons: z.number().int().min(1).max(15),
    predictionSeasons: z.array(z.number().int().min(1998).max(2200)).min(4),
    requiredMeasurementSeasons: z.array(z.number().int().min(1998).max(2200)).min(1),
    sourceMemberSetSha256: aflTradeSha256Schema,
    canonicalMemberSetSha256: aflTradeSha256Schema,
  })
  .strict()
  .superRefine((binding, context) => {
    for (const [field, seasons] of [
      ['predictionSeasons', binding.predictionSeasons],
      ['requiredMeasurementSeasons', binding.requiredMeasurementSeasons],
    ] as const) {
      if (seasons.some((season, index) => index > 0 && seasons[index - 1]! >= season)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must be unique and canonically ordered.`,
        });
      }
    }
  });

export type AflTradePrivatePlayerPavAuthorityBinding = z.infer<typeof bindingSchema>;

/** Bind a live private dispatch to an independently admitted historical player-PAV corpus. */
export class PostgresAflTradePrivatePlayerPavAuthority {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async bind(
    input: z.input<typeof selectionSchema>
  ): Promise<AflTradePrivatePlayerPavAuthorityBinding> {
    const selection = selectionSchema.parse(input);
    return this.client.transaction(async (transaction) => {
      await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      const result = await transaction.query<{ readonly binding_json: unknown }>(
        `SELECT bind_outcome_private_player_pav_authority($1,$2,$3,$4,$5)
                AS binding_json`,
        [
          selection.requestId,
          selection.claim.claimId,
          createHash('sha256').update(selection.claim.leaseToken, 'utf8').digest('hex'),
          selection.policyId,
          selection.lineageAdmissionId,
        ]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Private player-PAV authority lookup is ambiguous.');
      }
      const binding = bindingSchema.parse(result.rows[0]!.binding_json);
      if (
        binding.requestId !== selection.requestId ||
        binding.policyId !== selection.policyId ||
        binding.lineageAdmissionId !== selection.lineageAdmissionId
      ) {
        throw new TypeError('Private player-PAV authority differs from its exact selection.');
      }
      return binding;
    });
  }
}
