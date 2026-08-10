import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeExternalCanonicalPromotionReviewDecisionSchema,
  parseAflTradeExternalCanonicalPromotionReviewDecision,
} from './externalCanonicalPromotionReviewContracts';
import {
  aflTradeExternalCanonicalPromotionApprovalEvidenceSchema,
  authenticateAflTradeExternalCanonicalPromotionProposal,
} from './externalCanonicalPromotionContracts';
import {
  type AflTradeExternalCanonicalPromotionReviewRepository,
  type PersistAflTradeExternalCanonicalPromotionReviewInput,
  type PersistedAflTradeExternalCanonicalPromotionReview,
} from './externalCanonicalPromotionReviewService';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';

export class AflTradeExternalCanonicalPromotionReviewPersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'CANDIDATE_UNAVAILABLE' | 'STALE_REVISION' | 'CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalCanonicalPromotionReviewPersistenceError';
  }
}

interface CandidateRow extends Record<string, unknown> {
  status: string;
  finalized_at: Date | string | null;
  issue_count: number | string;
  candidate_json: unknown;
}

interface HeadRow extends Record<string, unknown> {
  revision: number | string;
  decision_id: string;
  proposal_id: string;
  status: string;
  decision_json: unknown;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

async function selectCandidate(
  client: Pick<AflOutcomeSqlClient, 'query'>,
  candidateId: string,
  lock = false
): Promise<AflTradeExternalReconciliationCandidateRecord> {
  const result = await client.query<CandidateRow>(
    `SELECT status,finalized_at,issue_count,candidate_json
       FROM outcome_external_reconciliation_candidate
      WHERE candidate_id=$1${lock ? ' FOR SHARE' : ''}`,
    [candidateId]
  );
  const row = result.rows[0];
  if (
    result.rows.length !== 1 ||
    row?.status !== 'finalized' ||
    row.finalized_at === null ||
    Number(row.issue_count) !== 0
  ) {
    throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
      'CANDIDATE_UNAVAILABLE',
      'Promotion review requires one finalized issue-free reconciliation candidate.'
    );
  }
  try {
    const candidate = parseAflTradeExternalReconciliationCandidate(row.candidate_json);
    if (candidate.candidateId !== candidateId) throw new TypeError('Candidate identity mismatch.');
    return candidate;
  } catch (error) {
    throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
      'CANDIDATE_UNAVAILABLE',
      error instanceof Error ? error.message : 'Candidate content is invalid.'
    );
  }
}

async function selectHead(
  client: Pick<AflOutcomeSqlClient, 'query'>,
  candidateId: string,
  lock = false
): Promise<HeadRow | null> {
  const result = await client.query<HeadRow>(
    `SELECT head.revision,head.decision_id,head.proposal_id,head.status,decision.decision_json
       FROM outcome_external_canonical_promotion_review_head head
       JOIN outcome_external_canonical_promotion_review_decision decision
         ON decision.decision_id=head.decision_id
      WHERE head.candidate_id=$1${lock ? ' FOR UPDATE OF head' : ''}`,
    [candidateId]
  );
  if (result.rows.length > 1) {
    throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
      'CONFLICT',
      'Promotion review has more than one current head.'
    );
  }
  return result.rows[0] ?? null;
}

export class PostgresAflTradeExternalCanonicalPromotionReviewRepository implements AflTradeExternalCanonicalPromotionReviewRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async loadCandidate(candidateId: string): Promise<AflTradeExternalReconciliationCandidateRecord> {
    return selectCandidate(this.client, candidateId);
  }

  async loadCurrentDecision(candidateId: string) {
    const row = await selectHead(this.client, candidateId);
    return row ? parseAflTradeExternalCanonicalPromotionReviewDecision(row.decision_json) : null;
  }

  async persistDecision(
    input: PersistAflTradeExternalCanonicalPromotionReviewInput
  ): Promise<PersistedAflTradeExternalCanonicalPromotionReview> {
    let parsed: PersistAflTradeExternalCanonicalPromotionReviewInput;
    try {
      const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
      const decision = aflTradeExternalCanonicalPromotionReviewDecisionSchema.parse(input.decision);
      const proposal = decision.content.proposal;
      authenticateAflTradeExternalCanonicalPromotionProposal({ candidate, proposal });
      if (!exactJson(proposal, input.proposal)) throw new TypeError('Proposal payload mismatch.');
      parsed = { candidate, proposal, decision };
    } catch (error) {
      throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Promotion review input is invalid.'
      );
    }

    return this.client.transaction(async (transaction) => {
      const { candidate, proposal, decision } = parsed;
      const candidateId = candidate.candidateId;
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-canonical-promotion-review:${candidateId}`,
      ]);
      const storedCandidate = await selectCandidate(transaction, candidateId, true);
      if (!exactJson(storedCandidate, candidate)) {
        throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
          'CONFLICT',
          'Stored reconciliation candidate differs from the reviewed candidate.'
        );
      }
      const head = await selectHead(transaction, candidateId, true);
      if (head?.decision_id === decision.decisionId) {
        if (!exactJson(head.decision_json, decision)) {
          throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
            'CONFLICT',
            'Stored promotion review decision differs from the exact replay.'
          );
        }
        return {
          candidateId,
          proposalId: proposal.proposalId,
          decisionId: decision.decisionId,
          revision: decision.content.revision,
          status: decision.content.decision,
          idempotentReplay: true,
        };
      }
      const currentRevision = head ? Number(head.revision) : 0;
      if (
        decision.content.revision !== currentRevision + 1 ||
        decision.content.supersedesDecisionId !== (head?.decision_id ?? null)
      ) {
        throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
          'STALE_REVISION',
          'Promotion review does not advance the exact current decision.'
        );
      }

      const approvalEvidence = aflTradeExternalCanonicalPromotionApprovalEvidenceSchema.parse({
        schemaVersion: 'afl-trade-external-canonical-promotion-approval/v1',
        proposalId: proposal.proposalId,
        proposalSha256: proposal.proposalId.split(':')[1],
        proposal,
        authorityEvidenceId: decision.content.authorityEvidenceId,
      });
      await insertGenericDecision(transaction, decision, approvalEvidence);
      await insertTypedDecision(transaction, parsed);
      const headWrite = head
        ? await transaction.query(
            `UPDATE outcome_external_canonical_promotion_review_head
                SET revision=$2,decision_id=$3,proposal_id=$4,status=$5,updated_at=$6
              WHERE candidate_id=$1 AND revision=$7 AND decision_id=$8`,
            [
              candidateId,
              decision.content.revision,
              decision.decisionId,
              proposal.proposalId,
              decision.content.decision,
              decision.content.decidedAt,
              currentRevision,
              head.decision_id,
            ]
          )
        : await transaction.query(
            `INSERT INTO outcome_external_canonical_promotion_review_head
              (candidate_id,revision,decision_id,proposal_id,status,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              candidateId,
              decision.content.revision,
              decision.decisionId,
              proposal.proposalId,
              decision.content.decision,
              decision.content.decidedAt,
            ]
          );
      if (head && headWrite.rowCount !== 1) {
        throw new AflTradeExternalCanonicalPromotionReviewPersistenceError(
          'STALE_REVISION',
          'Promotion review head changed before compare-and-swap.'
        );
      }
      return {
        candidateId,
        proposalId: proposal.proposalId,
        decisionId: decision.decisionId,
        revision: decision.content.revision,
        status: decision.content.decision,
        idempotentReplay: false,
      };
    });
  }
}

async function insertGenericDecision(
  transaction: AflOutcomeSqlTransaction,
  decision: PersistAflTradeExternalCanonicalPromotionReviewInput['decision'],
  approvalEvidence: unknown
): Promise<void> {
  await transaction.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,canonical_record_type,canonical_record_id,
       supersedes_decision_id,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'external_reconciliation_candidate',$2,$3,NULL,NULL,$4,$5,$6::jsonb,$7,$8)`,
    [
      decision.decisionId,
      decision.content.candidateId,
      decision.content.decision,
      decision.content.supersedesDecisionId,
      decision.content.rationale,
      canonicalizeAflTradeJson(approvalEvidence),
      decision.content.decidedBy,
      decision.content.decidedAt,
    ]
  );
}

async function insertTypedDecision(
  transaction: AflOutcomeSqlTransaction,
  input: PersistAflTradeExternalCanonicalPromotionReviewInput
): Promise<void> {
  const { decision, proposal } = input;
  const decisionCanonical = canonicalizeAflTradeJson(decision.content);
  const proposalCanonical = canonicalizeAflTradeJson(proposal.content);
  await transaction.query(
    `INSERT INTO outcome_external_canonical_promotion_review_decision
      (decision_id,candidate_id,proposal_id,proposal_sha256,proposal_canonical_json,revision,
       outcome,authority_evidence_id,supersedes_decision_id,decision_sha256,
       decision_canonical_json,decision_json,decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
    [
      decision.decisionId,
      decision.content.candidateId,
      proposal.proposalId,
      sha256AflTradeCanonicalJson(proposal.content),
      proposalCanonical,
      decision.content.revision,
      decision.content.decision,
      decision.content.authorityEvidenceId,
      decision.content.supersedesDecisionId,
      sha256AflTradeCanonicalJson(decision.content),
      decisionCanonical,
      canonicalizeAflTradeJson(decision),
      decision.content.decidedAt,
    ]
  );
}
