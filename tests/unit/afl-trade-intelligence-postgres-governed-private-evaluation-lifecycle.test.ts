import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionReceipt,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';
import {
  createReadyFixtureGovernedPrivateEvaluationAuthorityInspection,
  createUnavailableGovernedPrivateEvaluationAuthorityInspection,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationAuthoritySnapshot';
import { createPostgresGovernedPrivateEvaluationLifecycleRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationLifecycleRepository';

const selector = {
  valuationScopeKey: 'afl-trade-history:scope-b',
  tradeId: 'trade:shared-id',
};
const generationId = `local-private-trade-evaluation-generation:${'c'.repeat(64)}`;
const operationId = `private-evaluation-operation:${'d'.repeat(64)}`;
const transitionTime = '2026-08-19T10:01:00.000Z';

interface QueryCall {
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

class RecordingSqlClient implements AflOutcomeSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly respond: (
      sql: string,
      parameters: readonly unknown[]
    ) => AflOutcomeSqlQueryResult<unknown>
  ) {}

  async query<Row>(
    sql: string,
    parameters: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    this.calls.push({ sql, parameters });
    return this.respond(sql, parameters) as AflOutcomeSqlQueryResult<Row>;
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

function retainedAuthority(input: {
  readonly head: { status: 'absent' | 'active' | 'withdrawn'; revision: number; generationId: string | null };
  readonly lastTransitionId: string | null;
}) {
  return createReadyFixtureGovernedPrivateEvaluationAuthorityInspection({
    selector,
    capturedAt: '2026-08-19T10:00:00.000Z',
    validThrough: '2026-08-19T10:05:00.000Z',
    head: input.head,
    lastTransitionId: input.lastTransitionId,
    playerModelRunId: `model-run:${'1'.repeat(64)}`,
    pickModelRunId: `model-run:${'2'.repeat(64)}`,
  });
}

function activationFixture() {
  const retained = retainedAuthority({
    head: { status: 'absent', revision: 0, generationId: null },
    lastTransitionId: null,
  });
  const intent = createGovernedPrivateEvaluationTransitionIntent({
    selector,
    inspectionId: retained.inspection.inspectionId,
    authoritySnapshotId: retained.snapshot.snapshotId,
    operationId,
    action: { kind: 'construct_and_activate' },
    expectedHead: { status: 'absent', revision: 0, generationId: null },
    review: {
      principalId: 'firebase:operator-1',
      rationale: 'Activate the retained fixture generation.',
    },
    requestedAt: '2026-08-19T10:00:00.000Z',
    expiresAt: '2026-08-19T10:05:00.000Z',
  });
  const receipt = createGovernedPrivateEvaluationTransitionReceipt({
    intent,
    previousTransitionId: null,
    toGenerationId: generationId,
    transitionedAt: transitionTime,
  });
  return { receipt, retained };
}

async function repositoryFor(
  client: AflOutcomeSqlClient,
  retained: ReturnType<typeof retainedAuthority>
) {
  const artifactRepository = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  for (const document of [retained.snapshot, retained.inspection]) {
    const reference = createAflTradeCanonicalJsonArtifactRef(
      document,
      retained.snapshot.content.capturedAt
    );
    await artifactRepository.putIfAbsent(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document))
    );
  }
  return createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client,
    artifactRepository,
    maximumArtifactBytes: 1024 * 1024,
  });
}

function storedAuthority(
  sql: string,
  receipt: ReturnType<typeof createGovernedPrivateEvaluationTransitionReceipt>,
  retained: ReturnType<typeof retainedAuthority>
): AflOutcomeSqlQueryResult<unknown> | null {
  if (!sql.includes('FROM outcome_private_evaluation_transition_intent ti')) return null;
  const intent = receipt.content.intent.content;
  return {
    rows: [
      {
        intent_json: receipt.content.intent,
        authority_snapshot_id: intent.authoritySnapshotId,
        inspection_snapshot_id: intent.authoritySnapshotId,
        inspection_state: 'ready',
        inspection_valid_through: intent.expiresAt,
        inspection_head_status: intent.expectedHead.status,
        inspection_head_revision: intent.expectedHead.revision,
        inspection_head_generation_id: intent.expectedHead.generationId,
        snapshot_id: intent.authoritySnapshotId,
        snapshot_valid_through: intent.expiresAt,
        snapshot_head_status: intent.expectedHead.status,
        snapshot_head_revision: intent.expectedHead.revision,
        snapshot_head_generation_id: intent.expectedHead.generationId,
        snapshot_json: retained.snapshot,
        inspection_json: retained.inspection,
        snapshot_artifact_id: createAflTradeCanonicalJsonArtifactRef(
          retained.snapshot,
          retained.snapshot.content.capturedAt
        ).artifactId,
        snapshot_artifact_sha256: createAflTradeCanonicalJsonArtifactRef(
          retained.snapshot,
          retained.snapshot.content.capturedAt
        ).contentSha256,
        snapshot_artifact_storage_uri: createAflTradeCanonicalJsonArtifactRef(
          retained.snapshot,
          retained.snapshot.content.capturedAt
        ).storageUri,
        snapshot_artifact_media_type: 'application/json',
        snapshot_artifact_byte_length: new TextEncoder().encode(
          canonicalizeAflTradeJson(retained.snapshot)
        ).byteLength,
        snapshot_artifact_created_at: retained.snapshot.content.capturedAt,
        inspection_artifact_id: createAflTradeCanonicalJsonArtifactRef(
          retained.inspection,
          retained.snapshot.content.capturedAt
        ).artifactId,
        inspection_artifact_sha256: createAflTradeCanonicalJsonArtifactRef(
          retained.inspection,
          retained.snapshot.content.capturedAt
        ).contentSha256,
        inspection_artifact_storage_uri: createAflTradeCanonicalJsonArtifactRef(
          retained.inspection,
          retained.snapshot.content.capturedAt
        ).storageUri,
        inspection_artifact_media_type: 'application/json',
        inspection_artifact_byte_length: new TextEncoder().encode(
          canonicalizeAflTradeJson(retained.inspection)
        ).byteLength,
        inspection_artifact_created_at: retained.snapshot.content.capturedAt,
      },
    ],
    rowCount: 1,
  };
}

function operatorAuthority(sql: string): AflOutcomeSqlQueryResult<unknown> | null {
  if (!sql.includes('FROM outcome_operational_principal_authority')) return null;
  return {
    rows: [{ authority_evidence_id: `reviewer-authority-evidence:${'e'.repeat(64)}` }],
    rowCount: 1,
  };
}

describe('PostgreSQL governed private evaluation lifecycle repository', () => {
  it('rejects activation when exact stored snapshot authority is absent', async () => {
    const { receipt, retained } = activationFixture();
    const client = new RecordingSqlClient((sql) => {
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM outcome_local_private_trade_evaluation_generation')) {
        return { rows: [{ generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).rejects.toThrow(/stored|snapshot|authority/i);
  });

  it('locks, proves, and CAS-activates by valuation scope and trade together', async () => {
    const { receipt, retained } = activationFixture();
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      const operator = operatorAuthority(sql);
      if (operator !== null) return operator;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes('FROM outcome_local_private_trade_evaluation_generation')
      ) {
        return { rows: [{ generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);
    const receiptArtifact = createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime);

    await expect(repository.commit({ receipt, receiptArtifact })).resolves.toEqual({
      state: 'committed',
      head: receipt.content.toHead,
      transitionId: receipt.transitionId,
    });

    const lock = client.calls.find(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    expect(lock?.parameters[0]).toContain(selector.valuationScopeKey);
    expect(lock?.parameters[0]).toContain(selector.tradeId);
    const headRead = client.calls.find(({ sql }) =>
      sql.includes('FROM outcome_local_private_trade_evaluation_head')
    );
    expect(headRead?.sql).toContain('valuation_scope_key=$1');
    expect(headRead?.sql).toContain('trade_id=$2');
    expect(headRead?.parameters).toEqual([
      selector.valuationScopeKey,
      selector.tradeId,
    ]);
    const headWrite = client.calls.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')
    );
    expect(headWrite?.sql).toContain('ON CONFLICT (valuation_scope_key,trade_id)');
  });

  it('returns conflict before writing when the composite head is stale', async () => {
    const { receipt, retained } = activationFixture();
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      const operator = operatorAuthority(sql);
      if (operator !== null) return operator;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return {
          rows: [
            {
              status: 'active',
              revision: 7,
              generation_id: generationId,
              last_transition_id: `private-evaluation-transition:${'e'.repeat(64)}`,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).resolves.toMatchObject({
      state: 'conflict',
      actualHead: { status: 'active', revision: 7 },
    });
    expect(
      client.calls.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')
      )
    ).toBe(false);
  });

  it('recovers only the generation retained by the exact withdrawal receipt', async () => {
    const previousTransitionId = `private-evaluation-transition:${'f'.repeat(64)}`;
    const retained = retainedAuthority({
      head: { status: 'withdrawn', revision: 2, generationId: null },
      lastTransitionId: previousTransitionId,
    });
    const intent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: retained.inspection.inspectionId,
      authoritySnapshotId: retained.snapshot.snapshotId,
      operationId,
      action: { kind: 'recover' },
      expectedHead: { status: 'withdrawn', revision: 2, generationId: null },
      review: {
        principalId: 'firebase:operator-1',
        rationale: 'Recover the last withdrawn fixture generation.',
      },
      requestedAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2026-08-19T10:05:00.000Z',
    });
    const receipt = createGovernedPrivateEvaluationTransitionReceipt({
      intent,
      previousTransitionId,
      toGenerationId: generationId,
      transitionedAt: transitionTime,
    });
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      const operator = operatorAuthority(sql);
      if (operator !== null) return operator;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return {
          rows: [
            {
              status: 'withdrawn',
              revision: 2,
              generation_id: null,
              last_transition_id: receipt.content.previousTransitionId,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("action='withdraw'")) {
        return { rows: [{ from_generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_local_private_trade_evaluation_generation')) {
        return { rows: [{ generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).resolves.toMatchObject({ state: 'committed' });
    const recoveryRead = client.calls.find(({ sql }) => sql.includes("action='withdraw'"));
    expect(recoveryRead?.parameters).toEqual([
      selector.valuationScopeKey,
      selector.tradeId,
      2,
      receipt.content.previousTransitionId,
    ]);
  });

  it('rejects recovery when relational columns claim ready but retained authority is unavailable', async () => {
    const previousTransitionId = `private-evaluation-transition:${'f'.repeat(64)}`;
    const retained = createUnavailableGovernedPrivateEvaluationAuthorityInspection({
      selector,
      capturedAt: '2026-08-19T10:00:00.000Z',
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'withdrawn', revision: 2, generationId: null },
      lastTransitionId: previousTransitionId,
      blockers: [{ code: 'model_not_approved', message: 'Model evidence is unavailable.' }],
    });
    const intent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: retained.inspection.inspectionId,
      authoritySnapshotId: retained.snapshot.snapshotId,
      operationId,
      action: { kind: 'recover' },
      expectedHead: { status: 'withdrawn', revision: 2, generationId: null },
      review: {
        principalId: 'firebase:operator-1',
        rationale: 'Attempt recovery without exact ready calculation authority.',
      },
      requestedAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2026-08-19T10:05:00.000Z',
    });
    const receipt = createGovernedPrivateEvaluationTransitionReceipt({
      intent,
      previousTransitionId,
      toGenerationId: generationId,
      transitionedAt: transitionTime,
    });
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      const operator = operatorAuthority(sql);
      if (operator !== null) return operator;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return {
          rows: [
            {
              status: 'withdrawn',
              revision: 2,
              generation_id: null,
              last_transition_id: previousTransitionId,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("action='withdraw'")) {
        return { rows: [{ from_generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_local_private_trade_evaluation_generation')) {
        return { rows: [{ generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).rejects.toThrow(/retained|ready|authority/i);
    expect(
      client.calls.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')
      )
    ).toBe(false);
  });

  it('rejects authentic retained authority from a different selector', async () => {
    const retained = createReadyFixtureGovernedPrivateEvaluationAuthorityInspection({
      selector: { valuationScopeKey: 'afl-trade-history:other-scope', tradeId: selector.tradeId },
      capturedAt: '2026-08-19T10:00:00.000Z',
      validThrough: '2026-08-19T10:05:00.000Z',
      head: { status: 'absent', revision: 0, generationId: null },
      lastTransitionId: null,
      playerModelRunId: `model-run:${'1'.repeat(64)}`,
      pickModelRunId: `model-run:${'2'.repeat(64)}`,
    });
    const intent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: retained.inspection.inspectionId,
      authoritySnapshotId: retained.snapshot.snapshotId,
      operationId,
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      review: {
        principalId: 'firebase:operator-1',
        rationale: 'Attempt cross-scope authority reuse.',
      },
      requestedAt: '2026-08-19T10:00:00.000Z',
      expiresAt: '2026-08-19T10:05:00.000Z',
    });
    const receipt = createGovernedPrivateEvaluationTransitionReceipt({
      intent,
      previousTransitionId: null,
      toGenerationId: generationId,
      transitionedAt: transitionTime,
    });
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      const operator = operatorAuthority(sql);
      if (operator !== null) return operator;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM outcome_local_private_trade_evaluation_generation')) {
        return { rows: [{ generation_id: generationId }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).rejects.toThrow(/retained|selector|authority/i);
    expect(
      client.calls.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_private_evaluation_transition_receipt')
      )
    ).toBe(false);
  });

  it('rejects a staged transition when operator authority is absent at CAS time', async () => {
    const { receipt, retained } = activationFixture();
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      if (sql.includes('FROM outcome_operational_principal_authority')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = await repositoryFor(client, retained);

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).rejects.toThrow('current governed operator authority');
  });

  it('rejects relational authority when its retained snapshot bytes are absent', async () => {
    const { receipt, retained } = activationFixture();
    const client = new RecordingSqlClient((sql) => {
      const authority = storedAuthority(sql, receipt, retained);
      if (authority !== null) return authority;
      if (sql.includes('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')) {
        return { rows: [], rowCount: null };
      }
      if (sql.includes('WHERE operation_id=$1')) return { rows: [], rowCount: 0 };
      if (sql.includes('transaction_timestamp()')) {
        return { rows: [{ trusted_at: transitionTime }], rowCount: 1 };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('FROM outcome_local_private_trade_evaluation_head')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPostgresGovernedPrivateEvaluationLifecycleRepository({
      client,
      artifactRepository: createAflTradeFixtureArtifactRepository({
        artifactClass: 'derived_private',
      }),
      maximumArtifactBytes: 1024 * 1024,
    });

    await expect(
      repository.commit({
        receipt,
        receiptArtifact: createAflTradeCanonicalJsonArtifactRef(receipt, transitionTime),
      })
    ).rejects.toThrow('exact retained authority bytes');
  });
});
