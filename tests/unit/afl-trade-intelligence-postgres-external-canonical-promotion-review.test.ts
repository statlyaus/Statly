import { describe, expect, it } from 'vitest';

import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import { createAflTradeExternalCanonicalPromotionReviewDecision } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionReviewContracts';
import { createAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  AflTradeExternalCanonicalPromotionReviewPersistenceError,
  PostgresAflTradeExternalCanonicalPromotionReviewRepository,
} from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionReviewRepository';

const sha = (value: string) => value.repeat(64);

function fixture() {
  const candidate = createAflTradeExternalReconciliationCandidate({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatchIds: [`external-evidence-batch:${sha('b')}`],
    identityResolutionIds: [],
    transactions: [],
    transfers: [],
    draftSelections: [
      {
        selectionId: `external-draft-selection:${sha('f')}`,
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        pickId: `draft-pick:${sha('d')}`,
        playerId: 'player-harry-kyle',
        clubId: 'club-western-bulldogs',
        status: 'single_source',
        supportingProviders: ['draftguru'],
        evidenceIds: [`external-evidence:${sha('e')}`],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    issues: [],
    reconciledAt: '2026-08-09T07:30:00.000Z',
    publicationEligible: false,
  });
  const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate,
    proposedAt: '2026-08-09T07:31:00.000Z',
    draftEvents: [
      {
        draftYear: 2025,
        draftType: 'national',
        eventDate: '2025-11-19',
        officialName: '2025 AFL National Draft',
      },
    ],
  });
  const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1]!,
    proposal,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    rationale: 'Reviewed exact complete candidate.',
    authorityEvidenceId: `reviewer-authority-evidence:${sha('a')}`,
    decidedBy: 'operator:canonical-promoter',
    decidedAt: '2026-08-09T07:32:00.000Z',
  });
  return { candidate, proposal, decision };
}

class PromotionReviewSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly candidate = fixture().candidate;
  head: { revision: number; decision_id: string; proposal_id: string; status: string } | null =
    null;
  decisions = new Map<string, unknown>();
  writes: string[] = [];

  async transaction<T>(callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>) {
    return callback(this);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
    const result = (rows: T[], rowCount = rows.length) => ({ rows, rowCount });
    if (sql.includes('FROM outcome_external_reconciliation_candidate')) {
      return result([
        {
          status: 'finalized',
          finalized_at: '2026-08-09T07:30:00.000Z',
          issue_count: 0,
          candidate_json: this.candidate,
        },
      ] as T[]);
    }
    if (sql.includes('FROM outcome_external_canonical_promotion_review_head head')) {
      const decision = this.head ? this.decisions.get(this.head.decision_id) : null;
      return result(
        (this.head && decision ? [{ ...this.head, decision_json: decision }] : []) as T[]
      );
    }
    if (sql.includes('INSERT INTO outcome_review_decision')) {
      this.writes.push('generic');
      return result([] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_external_canonical_promotion_review_decision')) {
      this.writes.push('typed');
      this.decisions.set(String(params[0]), JSON.parse(String(params[11])));
      return result([] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_external_canonical_promotion_review_head')) {
      this.writes.push('head');
      this.head = {
        revision: Number(params[1]),
        decision_id: String(params[2]),
        proposal_id: String(params[3]),
        status: String(params[4]),
      };
      return result([] as T[], 1);
    }
    return result([] as T[]);
  }
}

describe('PostgresAflTradeExternalCanonicalPromotionReviewRepository', () => {
  it('atomically appends generic and typed decisions before advancing the head', async () => {
    const input = fixture();
    const sql = new PromotionReviewSql();
    const repository = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);

    const result = await repository.persistDecision(input);

    expect(result).toMatchObject({
      candidateId: input.candidate.candidateId,
      decisionId: input.decision.decisionId,
      revision: 1,
      status: 'approved',
      idempotentReplay: false,
    });
    expect(sql.writes).toEqual(['generic', 'typed', 'head']);
  });

  it('returns an exact current replay without another write', async () => {
    const input = fixture();
    const sql = new PromotionReviewSql();
    const repository = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);
    await repository.persistDecision(input);
    sql.writes = [];

    await expect(repository.persistDecision(input)).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(sql.writes).toEqual([]);
  });

  it('rejects a stale first revision when a different head already exists', async () => {
    const input = fixture();
    const sql = new PromotionReviewSql();
    sql.head = {
      revision: 1,
      decision_id: `review-decision:${sha('9')}`,
      proposal_id: input.proposal.proposalId,
      status: 'rejected',
    };
    sql.decisions.set(sql.head.decision_id, input.decision);
    const repository = new PostgresAflTradeExternalCanonicalPromotionReviewRepository(sql);

    await expect(repository.persistDecision(input)).rejects.toMatchObject<
      Partial<AflTradeExternalCanonicalPromotionReviewPersistenceError>
    >({ code: 'STALE_REVISION' });
  });
});
