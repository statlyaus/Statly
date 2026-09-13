import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { bindReviewedPickLineage } from './reviewedPickLineage';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';

/** Authenticated review storage only; source permission and canonical promotion remain separate. */
export async function registerReviewedPickLineage(
  client: AflOutcomeSqlClient,
  input: { registration: unknown; approvalDecisionId: string }
) {
  const registration = reviewedPickLineageRegistrationSchema.parse(input.registration);
  const decisionId = aflTradeContentAddressedIdSchema('review-decision').parse(
    input.approvalDecisionId
  );
  return client.transaction(async (transaction) => {
    const candidate = await transaction.query<{ candidate_json: unknown }>(
      'SELECT candidate_json FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1',
      [registration.content.candidateId]
    );
    if (!candidate.rows[0]) throw new TypeError('Reviewed lineage candidate is absent.');
    bindReviewedPickLineage(candidate.rows[0].candidate_json, registration.content.records);
    const result = await transaction.query<{
      registration_json: unknown;
      idempotent_replay: boolean;
    }>('SELECT * FROM register_outcome_reviewed_pick_lineage($1::jsonb,$2)', [
      canonicalizeAflTradeJson(registration),
      decisionId,
    ]);
    const row = result.rows[0];
    const retained = reviewedPickLineageRegistrationSchema.parse(row?.registration_json);
    if (!row || canonicalizeAflTradeJson(retained) !== canonicalizeAflTradeJson(registration))
      throw new TypeError('Reviewed lineage readback differs from the approved content.');
    return {
      registration: retained,
      idempotentReplay: row.idempotent_replay,
      reviewAuthorityAuthenticated: true as const,
      sourceAuthorityAuthenticated: false as const,
      canonicalAdmission: false as const,
    };
  });
}

export async function readReviewedPickLineage(client: AflOutcomeSqlClient, registrationId: string) {
  const id = aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration').parse(
    registrationId
  );
  const result = await client.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [id]
  );
  return {
    registration: reviewedPickLineageRegistrationSchema.parse(result.rows[0]?.registration),
    reviewAuthorityAuthenticated: true as const,
    sourceAuthorityAuthenticated: false as const,
    canonicalAdmission: false as const,
  };
}
