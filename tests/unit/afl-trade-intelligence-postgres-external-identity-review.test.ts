import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeExternalCanonicalIdentityTargetSnapshot,
  createAflTradeExternalIdentityReviewDecision,
  createAflTradeExternalIdentityReviewPackage,
  createAflTradeExternalIdentityReviewWorkItem,
  createAflTradeExternalIdentitySubject,
} from '@/server/aflTradeIntelligence/source/externalIdentityReviewContracts';
import {
  AflTradeExternalIdentityReviewPersistenceError,
  PostgresAflTradeExternalIdentityReviewRepository,
} from '@/server/aflTradeIntelligence/source/postgresExternalIdentityReviewRepository';

const sha = (character: string) => character.repeat(64);

function fixture() {
  const subject = createAflTradeExternalIdentitySubject({
    environment: 'test_fixture',
    competition: 'AFLM',
    provider: 'draftguru',
    entityKind: 'player',
    identityScope: { kind: 'provider_native_id', nativeId: 'player-14' },
  });
  const workItem = createAflTradeExternalIdentityReviewWorkItem({
    subject,
    observations: [
      {
        evidenceId: `external-evidence:${sha('1')}`,
        batchId: `external-evidence-batch:${sha('2')}`,
        sourceIdentity: { nativeId: 'player-14', recordedName: 'Harry Kyle' },
        seasonYear: 2025,
        capturedAt: '2026-08-10T00:00:01.000Z',
      },
      {
        evidenceId: `external-evidence:${sha('3')}`,
        batchId: `external-evidence-batch:${sha('4')}`,
        sourceIdentity: { nativeId: 'player-14', recordedName: 'H. Kyle' },
        seasonYear: 2025,
        capturedAt: '2026-08-10T00:00:02.000Z',
      },
    ],
  });
  const reviewPackage = createAflTradeExternalIdentityReviewPackage({
    completionId: `external-historical-capture-completion:${sha('5')}`,
    completionSha256: sha('5'),
    environment: 'test_fixture',
    competition: 'AFLM',
    completedAt: '2026-08-10T00:00:03.000Z',
    items: [workItem],
  });
  const decision = createAflTradeExternalIdentityReviewDecision({
    subject,
    reviewPackageId: reviewPackage.packageId,
    reviewPackageSha256: reviewPackage.packageId.split(':')[1]!,
    workItemId: workItem.workItemId,
    workItemSha256: workItem.workItemId.split(':')[1]!,
    workItem,
    revision: 1,
    supersedesDecisionId: null,
    decision: 'approved',
    canonicalTarget: createAflTradeExternalCanonicalIdentityTargetSnapshot({
      entityKind: 'player',
      canonicalId: 'player:harry-kyle',
      recordedLabel: 'Harry Kyle',
    }),
    rationale: 'Reviewed against the official draft selection.',
    authorityEvidenceId: `reviewer-authority-evidence:${sha('6')}`,
    decidedBy: 'reviewer:fixture',
    decidedAt: '2026-08-10T00:00:04.000Z',
  });
  return { subject, workItem, reviewPackage, decision };
}

class IdentityReviewSql implements AflOutcomeSqlClient, AflOutcomeSqlTransaction {
  head: {
    subject_id: string;
    revision: number;
    decision_id: string;
    status: string;
    updated_at: string;
  } | null = null;
  decisions = new Map<string, unknown>();
  readonly writes: string[] = [];

  async transaction<T>(
    callback: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return callback(this);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
    const result = (rows: T[]) => ({ rows, rowCount: rows.length });
    if (
      sql.includes('FROM outcome_external_identity_review_decision typed') &&
      sql.includes('WHERE typed.decision_id')
    ) {
      const decision = this.decisions.get(String(params[0]));
      return result((decision ? [{ decision_json: decision }] : []) as T[]);
    }
    if (
      sql.includes('JOIN outcome_external_identity_review_decision typed') &&
      sql.includes('WHERE head.subject_id=$1')
    ) {
      const decision = this.head ? this.decisions.get(this.head.decision_id) : null;
      return result(
        (decision && this.head
          ? [
              {
                ...this.head,
                decision_json: decision,
                current: true,
              },
            ]
          : []) as T[]
      );
    }
    if (
      sql.includes('FROM outcome_external_identity_resolution_head head') &&
      sql.includes('WHERE head.subject_id=$1')
    ) {
      return result((this.head ? [this.head] : []) as T[]);
    }
    if (sql.includes('FROM outcome_player') && sql.includes('player_id=$1')) {
      return result([
        { canonical_id: 'player:harry-kyle', recorded_label: 'Harry Kyle', status: 'approved' },
      ] as T[]);
    }
    if (sql.includes('FROM outcome_operational_principal_authority')) {
      return result([{ authority_evidence_id: `reviewer-authority-evidence:${sha('6')}` }] as T[]);
    }
    if (sql.includes('FROM outcome_external_identity_subject') && sql.includes('subject_json')) {
      const { subject } = fixture();
      return result([{ subject_json: subject }] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_review_decision')) {
      this.writes.push('generic-decision');
      return result([] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_external_identity_review_decision')) {
      this.writes.push('typed-decision');
      this.decisions.set(String(params[0]), JSON.parse(String(params[17])));
      return result([] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_external_identity_resolution_head')) {
      this.writes.push('head');
      this.head = {
        subject_id: String(params[0]),
        revision: Number(params[1]),
        decision_id: String(params[2]),
        status: String(params[3]),
        updated_at: String(params[4]),
      };
      return result([] as T[]);
    }
    if (sql.includes('INSERT INTO outcome_external_identity_subject')) {
      this.writes.push('subject');
      return result([] as T[]);
    }
    if (
      sql.includes('JOIN outcome_external_identity_review_decision typed') &&
      sql.includes('ANY($1::text[])')
    ) {
      const decision = this.head ? this.decisions.get(this.head.decision_id) : null;
      return result(
        (decision && this.head
          ? [
              {
                subject_id: this.head.subject_id,
                revision: this.head.revision,
                decision_id: this.head.decision_id,
                status: this.head.status,
                decision_json: decision,
                current: true,
              },
            ]
          : []) as T[]
      );
    }
    return result([] as T[]);
  }
}

describe('PostgresAflTradeExternalIdentityReviewRepository', () => {
  it('atomically appends a typed reviewed decision and advances its current head', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);

    const result = await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });

    expect(result).toEqual({
      subjectId: input.subject.subjectId,
      decisionId: input.decision.decisionId,
      revision: 1,
      status: 'approved',
      idempotentReplay: false,
    });
    expect(sql.writes).toEqual(['subject', 'generic-decision', 'typed-decision', 'head']);
  });

  it('returns exact current replay without writing again', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
    await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });
    sql.writes.length = 0;

    const replay = await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(sql.writes).toEqual([]);
  });

  it('expands one current native-ID decision across its exact observed names', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
    await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });

    const resolutions = await repository.loadCurrentResolutions(input.reviewPackage);

    expect(resolutions).toHaveLength(2);
    expect(resolutions.map(({ content }) => content.sourceIdentity.recordedName).sort()).toEqual([
      'H. Kyle',
      'Harry Kyle',
    ]);
    expect(new Set(resolutions.map(({ content }) => content.reviewDecisionId))).toEqual(
      new Set([input.decision.decisionId])
    );
    await expect(repository.loadCurrentDecision(input.subject.subjectId)).resolves.toEqual(
      input.decision
    );
    await expect(
      repository.loadCanonicalTargetSnapshot({
        entityKind: 'player',
        canonicalId: 'player:harry-kyle',
      })
    ).resolves.toEqual(input.decision.content.canonicalTarget);
  });

  it('does not apply an older approval to observations added by a later completion', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
    await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });
    const changedWorkItem = createAflTradeExternalIdentityReviewWorkItem({
      subject: input.subject,
      observations: [
        ...input.workItem.content.observations,
        {
          evidenceId: `external-evidence:${sha('7')}`,
          batchId: `external-evidence-batch:${sha('8')}`,
          sourceIdentity: { nativeId: 'player-14', recordedName: 'Harry J. Kyle' },
          seasonYear: 2026,
          capturedAt: '2027-08-10T00:00:01.000Z',
        },
      ],
    });
    const laterPackage = createAflTradeExternalIdentityReviewPackage({
      completionId: `external-historical-capture-completion:${sha('9')}`,
      completionSha256: sha('9'),
      environment: 'test_fixture',
      competition: 'AFLM',
      completedAt: '2027-08-10T00:00:02.000Z',
      items: [changedWorkItem],
    });

    await expect(repository.loadCurrentResolutions(laterPackage)).resolves.toEqual([]);
  });

  it('fails closed when the requested revision does not match the current head', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    sql.head = {
      subject_id: input.subject.subjectId,
      revision: 2,
      decision_id: `review-decision:${sha('9')}`,
      status: 'approved',
      updated_at: '2026-08-10T00:00:05.000Z',
    };
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);

    await expect(
      repository.persistDecision({ reviewPackage: input.reviewPackage, decision: input.decision })
    ).rejects.toMatchObject({
      code: 'STALE_REVISION',
    } satisfies Partial<AflTradeExternalIdentityReviewPersistenceError>);
  });

  it('uses canonical JSON for the persisted decision preimages', async () => {
    const input = fixture();
    const sql = new IdentityReviewSql();
    const repository = new PostgresAflTradeExternalIdentityReviewRepository(sql);
    await repository.persistDecision({
      reviewPackage: input.reviewPackage,
      decision: input.decision,
    });

    expect(sha256AflTradeCanonicalJson(input.decision.content)).toBe(
      input.decision.decisionId.split(':')[1]
    );
    expect(canonicalizeAflTradeJson(input.decision.content)).toContain('workItem');
  });
});
