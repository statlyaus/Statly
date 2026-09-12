import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { PostgresAflTradePlayerPavObservationRepository } from '../modeling/postgresPlayerPavObservationRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivatePlayerPavAuthority } from './postgresPrivatePlayerPavAuthority';

const selectionSchema = z
  .object({
    requestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    claim: z
      .object({
        claimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
        leaseToken: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
    policyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    lineageAdmissionId: aflTradeContentAddressedIdSchema('corpus-factual-lineage-admission'),
  })
  .strict();

/** Materialize private player-PAV observations only after PostgreSQL authenticates their parents. */
export class PostgresAflTradePrivatePlayerPavPreparation {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async prepare(input: z.input<typeof selectionSchema>) {
    const selection = selectionSchema.parse(input);
    const { authority, materialized } = await this.client.transaction(async (transaction) => {
      const transactionClient: AflOutcomeSqlClient = {
        query: transaction.query.bind(transaction),
        transaction: async (work) => work(transaction),
      };
      const authority = await new PostgresAflTradePrivatePlayerPavAuthority(transactionClient).bind(
        selection
      );
      const materialized = await new PostgresAflTradePlayerPavObservationRepository(
        transactionClient
      ).materializePrivateAndPersist({ requestId: authority.requestId });
      return { authority, materialized };
    });
    const set = materialized.observationSet;
    if (
      set.content.policy.policyId !== authority.policyId ||
      set.content.releaseId !== authority.releaseId ||
      set.content.knowledgeCutoffAt !== authority.knowledgeCutoffAt
    ) {
      throw new TypeError('Private player-PAV result differs from its authenticated authority.');
    }
    return {
      state: materialized.idempotentReplay ? ('already_prepared' as const) : ('prepared' as const),
      requestId: authority.requestId,
      policyId: authority.policyId,
      lineageAdmissionId: authority.lineageAdmissionId,
      releaseId: authority.releaseId,
      observationSetId: set.observationSetId,
      publicationEligible: false as const,
    };
  }
}
