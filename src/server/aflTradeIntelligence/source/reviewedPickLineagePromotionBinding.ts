import { z } from 'zod';
import {
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import { bindReviewedPickLineage } from './reviewedPickLineage';
import { reviewedPickLineageRegistrationSchema } from './reviewedPickLineageRegistrationContracts';

const inputSchema = z
  .object({
    registrationId: aflTradeContentAddressedIdSchema('reviewed-pick-lineage-registration'),
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    environment: z.enum(['test_fixture', 'non_production']),
  })
  .strict();

/** Use within the promotion transaction; retained inspection receipts never substitute for these checks. */
export async function bindRegisteredLineageForPromotion(
  transaction: AflOutcomeSqlTransaction,
  input: z.infer<typeof inputSchema>
) {
  const parsed = inputSchema.parse(input);
  await transaction.query(
    'SELECT singleton_id FROM outcome_gate_ledger_head WHERE singleton_id=1 FOR SHARE'
  );
  const stored = await transaction.query<{ registration: unknown }>(
    'SELECT read_outcome_reviewed_pick_lineage($1) AS registration',
    [parsed.registrationId]
  );
  const registration = reviewedPickLineageRegistrationSchema.parse(stored.rows[0]?.registration);
  if (
    registration.content.candidateId !== parsed.candidateId ||
    registration.content.environment !== parsed.environment
  )
    throw new TypeError(
      'Reviewed promotion must match the exact registered candidate and environment.'
    );
  const result = await transaction.query<{ candidate_json: unknown; current: boolean }>(
    `SELECT candidate_json,outcome_external_candidate_retained_sources_current(candidate_id,clock_timestamp()) AS current
     FROM outcome_external_reconciliation_candidate WHERE candidate_id=$1`,
    [parsed.candidateId]
  );
  if (result.rows[0]?.current !== true)
    throw new TypeError('Reviewed promotion requires current candidate source authority.');
  const candidate = parseAflTradeExternalReconciliationCandidate(result.rows[0].candidate_json);
  const { records } = bindReviewedPickLineage(candidate, registration.content.records);
  const artifactIds = [
    ...new Set(records.flatMap((record) => record.evidence.map((ref) => ref.artifactId))),
  ].sort();
  const captures = await transaction.query<{
    source_artifact_id: string;
    source_url: string;
    batch_id: string;
    current: boolean;
  }>(
    `SELECT c.source_artifact_id,c.manifest_json->>'sourceUrl' AS source_url,b.batch_id,
      outcome_external_retained_batch_is_current(b.batch_id,clock_timestamp()) AS current
     FROM outcome_source_capture c JOIN outcome_external_evidence_batch b ON b.capture_id=c.capture_id
     WHERE c.source_artifact_id=ANY($1::text[]) AND c.environment::text=$2 AND c.competition=$3`,
    [artifactIds, parsed.environment, candidate.content.competition]
  );
  for (const record of records) {
    for (const movement of record.movements) {
      if (
        movement.source &&
        !captures.rows.some(
          (capture) =>
            capture.source_artifact_id === movement.source!.artifact.artifactId &&
            capture.source_url === movement.source!.sourceUrl &&
            capture.current === true
        )
      )
        throw new TypeError(
          'Reviewed movement source permission or exact URL is no longer current.'
        );
    }
  }
  // Non-capture references include the user's retained factual verification. They do not become source permissions.
  for (const id of new Set(captures.rows.map((capture) => capture.source_artifact_id))) {
    if (
      !captures.rows.some(
        (capture) => capture.source_artifact_id === id && capture.current === true
      )
    )
      throw new TypeError('Reviewed endpoint source permission is no longer current.');
  }
  const facts = records.map((record) => ({
    transferId: record.transferId,
    originalClubId: record.originalClubId,
    retainedSourceLabel: record.retainedSourceLabel,
    acceptedTradeTimePick: record.acceptedTradeTimePick,
    custody: record.movements.map((movement, ordinal) => ({ ordinal, ...movement })),
    endpoint: record.endpoint,
    attribution: record.attribution,
    evidence: record.evidence,
  }));
  const content = {
    schemaVersion: 'afl-trade-reviewed-lineage-promotion-binding/v1' as const,
    registrationId: registration.registrationId,
    candidateId: candidate.candidateId,
    environment: parsed.environment,
    facts,
  };
  return {
    bindingId: createAflTradeContentAddress('reviewed-lineage-promotion-binding', content),
    content,
    reviewAuthorityAuthenticated: true as const,
    sourceAuthorityAuthenticated: true as const,
    canonicalAdmission: false as const,
    originalCandidateIssueCount: candidate.content.issues.length,
  };
}
