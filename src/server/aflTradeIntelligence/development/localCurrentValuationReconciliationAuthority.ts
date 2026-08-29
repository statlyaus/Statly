import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeCurrentValuationReconciliationAuthority } from '../valuation/currentValuationEvidenceOrchestration';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from './localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from './localOfficialAfl2026Review';
import { loadExactLocalReviewedProviderEvidenceBundle } from './localReviewedProviderEvidence';

const REQUIRED_REVIEW_SETS = [
  {
    decisionId: `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}`,
    evidenceSetSha256: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
    reviewerId: 'local-five-season-evidence-reviewer',
  },
  {
    decisionId: `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
    evidenceSetSha256: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
    reviewerId: 'local-workbook-evidence-reviewer',
  },
] as const;

interface ReviewSetAuthorityRow extends Record<string, unknown> {
  readonly decision_id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly decision: string;
  readonly canonical_record_type: string | null;
  readonly canonical_record_id: string | null;
  readonly supersedes_decision_id: string | null;
  readonly evidence_json: unknown;
  readonly decided_by: string;
  readonly current: boolean;
}

export function createLocalAflTradeCurrentValuationReconciliationAuthority(
  client: AflOutcomeSqlClient,
  dependencies: {
    readonly loadReviewedBundle?: typeof loadExactLocalReviewedProviderEvidenceBundle;
  } = {}
): AflTradeCurrentValuationReconciliationAuthority {
  const loadReviewedBundle =
    dependencies.loadReviewedBundle ?? loadExactLocalReviewedProviderEvidenceBundle;
  return {
    assessCurrent: () =>
      client.transaction(async (transaction) => {
        const reviewSets = await transaction.query<ReviewSetAuthorityRow>(
          `SELECT decision.decision_id,decision.subject_type,decision.subject_id,
                  decision.decision,decision.canonical_record_type,
                  decision.canonical_record_id,decision.supersedes_decision_id,
                  decision.evidence_json,decision.decided_by,
                  NOT EXISTS (
                    SELECT 1 FROM outcome_review_decision successor
                     WHERE successor.supersedes_decision_id=decision.decision_id
                  ) AS current
             FROM outcome_review_decision decision
            WHERE decision.decision_id=ANY($1::text[])`,
          [REQUIRED_REVIEW_SETS.map(({ decisionId }) => decisionId)]
        );
        const rowsById = new Map(reviewSets.rows.map((row) => [row.decision_id, row]));
        if (REQUIRED_REVIEW_SETS.some(({ decisionId }) => !rowsById.has(decisionId))) {
          return {
            state: 'unavailable',
            stage: 'reconciliation_authority',
            cause: 'missing',
          } as const;
        }
        if (
          reviewSets.rows.length !== REQUIRED_REVIEW_SETS.length ||
          REQUIRED_REVIEW_SETS.some(({ decisionId }) => !rowsById.get(decisionId)?.current)
        ) {
          return {
            state: 'unavailable',
            stage: 'reconciliation_authority',
            cause: REQUIRED_REVIEW_SETS.some(({ decisionId }) => !rowsById.get(decisionId)?.current)
              ? 'stale'
              : 'unauthenticated',
          } as const;
        }
        const malformed = REQUIRED_REVIEW_SETS.some(
          ({ decisionId, evidenceSetSha256, reviewerId }) => {
            const row = rowsById.get(decisionId)!;
            const evidence = row.evidence_json as Record<string, unknown> | null;
            return (
              row.subject_type !== 'local_review_set' ||
              row.subject_id !== evidenceSetSha256 ||
              row.decision !== 'approved' ||
              row.canonical_record_type !== 'local_review_set' ||
              row.canonical_record_id !== evidenceSetSha256 ||
              row.supersedes_decision_id !== null ||
              evidence?.evidenceSetSha256 !== evidenceSetSha256 ||
              row.decided_by !== reviewerId
            );
          }
        );
        if (malformed) {
          return {
            state: 'unavailable',
            stage: 'reconciliation_authority',
            cause: 'unauthenticated',
          } as const;
        }
        const trusted = await transaction.query<{ trusted_at: Date }>(
          `SELECT transaction_timestamp()::timestamptz(3) AS trusted_at`
        );
        try {
          await loadReviewedBundle(transaction, trusted.rows[0]!.trusted_at.toISOString());
          return { state: 'ready' } as const;
        } catch {
          return {
            state: 'unavailable',
            stage: 'reconciliation',
            cause: 'mismatched',
          } as const;
        }
      }),
  };
}
