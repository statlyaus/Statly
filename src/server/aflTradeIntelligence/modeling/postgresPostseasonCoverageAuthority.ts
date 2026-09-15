import { z } from 'zod';
import { doesAflTradeArtifactRefMatchBytes } from '../artifacts/artifactReference';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeHpnPavMethodAuthority } from './hpnPavCalculationService';
import { loadCurrentAflTradePostseasonCalculation } from './postgresPostseasonCalculationAuthority';
import {
  aflTradePostseasonCoverageSubject,
  aflTradePostseasonSeasonCoverageSchema,
} from './postseasonSeasonCoverage';

const requestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.literal('AFLM'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    seasonYear: z.number().int().min(1998).max(2200),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/** Absence is explicit missing coverage; retained materialization reads must compare their original binding. */
export async function loadCurrentAflTradePostseasonCoverage(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  methodAuthority: AflTradeHpnPavMethodAuthority,
  evidence: AflTradeAcquisitionRegistrationEvidenceReader
) {
  const request = requestSchema.parse(input);
  const subject = aflTradePostseasonCoverageSubject(request);
  const clock = await transaction.query<{ cutoff_valid: boolean }>(
    'SELECT $2::timestamptz<=transaction_timestamp() AS cutoff_valid, pg_advisory_xact_lock(hashtextextended($1,0))',
    [`outcome-review-subject:postseason_season_coverage:${subject}`, request.knowledgeCutoffAt]
  );
  if (!clock.rows[0]?.cutoff_valid) throw new Error('Season coverage cutoff is in the future.');
  const result = await transaction.query<{
    decision_id: string;
    evidence_json: unknown;
    decided_at: Date;
  }>(
    `SELECT decision_id,evidence_json,decided_at FROM outcome_review_decision review
     WHERE subject_type='postseason_season_coverage' AND subject_id=$1
       AND decision='approved' AND decided_at<=$2::timestamptz
       AND $2::timestamptz<=transaction_timestamp()
       AND NOT EXISTS (SELECT 1 FROM outcome_review_decision successor WHERE successor.supersedes_decision_id=review.decision_id)
     FOR SHARE`,
    [subject, request.knowledgeCutoffAt]
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) throw new Error('Season coverage has ambiguous current authority.');
  const row = result.rows[0]!;
  const coverage = aflTradePostseasonSeasonCoverageSchema.parse(row.evidence_json);
  const c = coverage.content;
  if (aflTradePostseasonCoverageSubject(c) !== subject)
    throw new Error('Season coverage scope differs.');
  const current = await transaction.query<{ valid: boolean }>(
    `SELECT outcome_acquisition_registration_review_current($1,'postseason_season_coverage',$2,
       $3::jsonb,$4::timestamptz,$5::timestamptz,transaction_timestamp())
       AND outcome_acquisition_registration_evidence_exact($6::jsonb,$7,$4::timestamptz,$5::timestamptz) AS valid`,
    [
      row.decision_id,
      subject,
      canonicalizeAflTradeJson(coverage),
      c.createdAt,
      row.decided_at,
      canonicalizeAflTradeJson([c.evidence]),
      request.environment,
    ]
  );
  if (
    !current.rows[0]?.valid ||
    !doesAflTradeArtifactRefMatchBytes(c.evidence, await evidence.read(c.evidence))
  )
    throw new Error('Season coverage review or evidence is not current and exact.');
  const authenticated = await loadCurrentAflTradePostseasonCalculation(
    transaction,
    {
      ...request,
      calculationId: c.calculationId,
    },
    methodAuthority
  );
  const actual = authenticated.inputSet.content.completedMatches
    .map(({ matchId }) => matchId)
    .sort();
  const expected = new Set(c.expectedMatchIds);
  if (
    actual.some((id) => !expected.has(id)) ||
    (c.state === 'complete' &&
      canonicalizeAflTradeJson(actual) !== canonicalizeAflTradeJson(c.expectedMatchIds)) ||
    Date.parse(authenticated.calculation.content.calculatedAt) > Date.parse(c.createdAt)
  ) {
    throw new Error('Reviewed season coverage differs from authenticated completed matches.');
  }
  return { ...authenticated, coverage, reviewDecisionId: row.decision_id };
}
