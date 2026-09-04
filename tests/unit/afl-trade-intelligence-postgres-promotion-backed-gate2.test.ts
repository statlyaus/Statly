import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradePromotionBackedGate2AffectedArtifacts } from '@/server/aflTradeIntelligence/outcomes/promotionBackedGate2AdmissionContracts';
import { createAflTradePromotionBackedFactualLineage } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AflTradePromotionBackedGate2PersistenceError,
  PostgresAflTradePromotionBackedGate2Repository,
} from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedGate2Repository';

const sha = (value: string) => value.repeat(64);

function typedRows<Row>(rows: readonly unknown[]): Row[] {
  return [...rows] as Row[];
}

function factualBundle() {
  const promotionId = `external-canonical-promotion:${sha('a')}`;
  const canonicalRecordId = `event-version:${sha('b')}`;
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:02.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:01.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: sha('a'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:00.000Z',
        promotionRecordCount: 1,
      },
    ],
    members: [
      {
        promotionId,
        recordKind: 'transaction',
        sourceRecordId: 'trade:2025:1',
        canonicalRecordId,
        recordSha256: sha('c'),
      },
    ],
  });
  return createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
    createdAt: '2026-08-10T00:00:03.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:draftguru-trade-1',
        sourceSnapshotId: `source-snapshot:${sha('d')}`,
        rightsArtifactId: `source-rights:${sha('e')}`,
        gateDecisionId: `gate-decision:${sha('f')}`,
        recordSha256: sha('0'),
        recordedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:draftguru-trade-1'] }],
    canonicalMembers: [
      {
        recordKind: 'transaction',
        canonicalRecordId,
        canonicalRecordSha256: sha('1'),
      },
    ],
  });
}

function gateLedger(
  parent: ReturnType<typeof createAflTradePromotionBackedFactualLineage>,
  state: 'approved' | 'withdrawn' = 'approved'
): AflTradeGateDecisionLedger {
  const affectedArtifacts = createAflTradePromotionBackedGate2AffectedArtifacts(parent);
  const scope = {
    scopeKey: parent.content.scopeKey,
    description: 'Approve one exact fixture factual lineage.',
    dimensions: [
      { name: 'competition', values: [parent.content.competition] },
      { name: 'valid_from_season', values: [String(parent.content.validFromSeason)] },
      { name: 'valid_through_season', values: [String(parent.content.validThroughSeason)] },
    ],
    exclusions: ['Valuation and public activation'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey: `gate2:${parent.lineageId}`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve exact fixture lineage.',
    alternativesConsidered: ['Keep it private.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${sha('2')}`],
    affectedArtifacts,
    proposedAt: '2026-08-10T00:00:05.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: proposal.content.environment,
    scope,
    state,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${sha('3')}`],
    conditionResults: [],
    rationale: 'Fixture approval.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-10T00:00:06.000Z',
    effectiveAt: '2026-08-10T00:00:06.000Z',
    revalidateAt: '2027-08-10T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: state === 'withdrawn' ? ['Keep release unavailable.'] : [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposals: [proposal], decisions: [decision] };
}

class FixtureSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  readonly factual = factualBundle();
  lineage: unknown = null;
  admission: unknown = null;
  ledger: AflTradeGateDecisionLedger = { proposals: [], decisions: [] };
  currentAuthorityCopies = 1;

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    return work(this);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('FROM outcome_corpus_factual_lineage lineage')) {
      const rows =
        this.lineage === null || this.admission === null
          ? []
          : Array.from({ length: this.currentAuthorityCopies }, () => ({
              lineage_json: this.lineage,
              admission_json: this.admission,
            }));
      return { rows: typedRows<Row>(rows), rowCount: rows.length };
    }
    if (sql.includes('FROM outcome_factual_release_candidate candidate')) {
      return {
        rows: typedRows<Row>([
          {
            candidate_json: this.factual.candidate,
            manifest_json: this.factual.release,
            corpus_json: this.factual.corpus,
            status: 'approved',
            finalized_at: this.factual.candidate.content.createdAt,
          },
        ]),
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT lineage_json FROM outcome_corpus_factual_lineage ')) {
      return {
        rows: this.lineage === null ? [] : typedRows<Row>([{ lineage_json: this.lineage }]),
        rowCount: this.lineage === null ? 0 : 1,
      };
    }
    if (sql.startsWith('INSERT INTO outcome_corpus_factual_lineage\n')) {
      this.lineage = parameters.find(
        (value) => typeof value === 'object' && value !== null && 'lineageId' in value
      );
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_gate_ledger_head')) {
      return { rows: typedRows<Row>([{ revision: this.ledger.decisions.length }]), rowCount: 1 };
    }
    if (sql.includes('FROM outcome_gate_proposal')) {
      return {
        rows: typedRows<Row>(
          this.ledger.proposals.map((proposal) => ({ proposal_json: proposal }))
        ),
        rowCount: this.ledger.proposals.length,
      };
    }
    if (sql.includes('FROM outcome_gate_decision')) {
      return {
        rows: typedRows<Row>(
          this.ledger.decisions.map((decision) => ({ decision_json: decision }))
        ),
        rowCount: this.ledger.decisions.length,
      };
    }
    if (sql.includes('FROM outcome_corpus_factual_lineage_admission')) {
      return {
        rows: this.admission === null ? [] : typedRows<Row>([{ admission_json: this.admission }]),
        rowCount: this.admission === null ? 0 : 1,
      };
    }
    if (sql.startsWith('INSERT INTO outcome_corpus_factual_lineage_admission')) {
      this.admission = parameters.find(
        (value) => typeof value === 'object' && value !== null && 'admissionId' in value
      );
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('Postgres promotion-backed Gate 2 repository', () => {
  it('stages one deterministic lineage and returns exact replay', async () => {
    const sql = new FixtureSql();
    const repository = new PostgresAflTradePromotionBackedGate2Repository(sql);
    const request = {
      factualCandidateId: sql.factual.candidate.candidateId,
      createdAt: '2026-08-10T00:00:04.000Z',
    };

    const staged = await repository.stage(request);
    expect(staged).toMatchObject({ status: 'staged', idempotentReplay: false });
    expect(staged.decisionKey).toBe(`gate2:${staged.lineageId}`);
    await expect(repository.stage(request)).resolves.toEqual({
      ...staged,
      idempotentReplay: true,
    });
  });

  it('admits a staged lineage from the locked durable ledger and replays exactly', async () => {
    const sql = new FixtureSql();
    const repository = new PostgresAflTradePromotionBackedGate2Repository(sql);
    const staged = await repository.stage({
      factualCandidateId: sql.factual.candidate.candidateId,
      createdAt: '2026-08-10T00:00:04.000Z',
    });
    sql.ledger = gateLedger(
      sql.lineage as ReturnType<typeof createAflTradePromotionBackedFactualLineage>
    );

    const admitted = await repository.admit({
      lineageId: staged.lineageId,
      evaluatedAt: '2026-08-10T00:00:07.000Z',
    });
    expect(admitted).toMatchObject({ status: 'admitted', idempotentReplay: false });
    await expect(
      repository.admit({
        lineageId: staged.lineageId,
        evaluatedAt: '2026-08-10T00:00:08.000Z',
      })
    ).resolves.toEqual({ ...admitted, idempotentReplay: true });
    await expect(repository.loadCurrentAuthority(sql.factual.release.releaseId)).resolves.toEqual({
      lineage: sql.lineage,
      admission: sql.admission,
    });
  });

  it('returns no current authority and rejects ambiguous or malformed lookups', async () => {
    const sql = new FixtureSql();
    const repository = new PostgresAflTradePromotionBackedGate2Repository(sql);
    await expect(
      repository.loadCurrentAuthority(sql.factual.release.releaseId)
    ).resolves.toBeNull();
    await expect(repository.loadCurrentAuthority('release:invalid')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });

    const staged = await repository.stage({
      factualCandidateId: sql.factual.candidate.candidateId,
      createdAt: '2026-08-10T00:00:04.000Z',
    });
    sql.ledger = gateLedger(
      sql.lineage as ReturnType<typeof createAflTradePromotionBackedFactualLineage>
    );
    await repository.admit({
      lineageId: staged.lineageId,
      evaluatedAt: '2026-08-10T00:00:07.000Z',
    });
    sql.currentAuthorityCopies = 2;
    await expect(
      repository.loadCurrentAuthority(sql.factual.release.releaseId)
    ).rejects.toMatchObject({ code: 'GATE2_UNAVAILABLE' });
  });

  it('rolls back admission when Gate 2 is absent or withdrawn', async () => {
    for (const state of ['absent', 'withdrawn'] as const) {
      const sql = new FixtureSql();
      const repository = new PostgresAflTradePromotionBackedGate2Repository(sql);
      const staged = await repository.stage({
        factualCandidateId: sql.factual.candidate.candidateId,
        createdAt: '2026-08-10T00:00:04.000Z',
      });
      if (state === 'withdrawn') {
        sql.ledger = gateLedger(
          sql.lineage as ReturnType<typeof createAflTradePromotionBackedFactualLineage>,
          'withdrawn'
        );
      }

      await expect(
        repository.admit({
          lineageId: staged.lineageId,
          evaluatedAt: '2026-08-10T00:00:07.000Z',
        })
      ).rejects.toMatchObject({
        code: 'GATE2_UNAVAILABLE',
      } satisfies Partial<AflTradePromotionBackedGate2PersistenceError>);
      expect(sql.admission).toBeNull();
    }
  });
});
