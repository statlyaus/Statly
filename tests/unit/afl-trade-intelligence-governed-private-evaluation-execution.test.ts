import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createUnavailableGovernedPrivateEvaluationAuthorityInspection } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationAuthoritySnapshot';
import { createPostgresGovernedPrivateEvaluationExecutionService } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationExecutionService';
import { createGovernedPrivateEvaluationTransitionIntent } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';

const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const generationId = `local-private-trade-evaluation-generation:${'b'.repeat(64)}`;
const priorGenerationId = `local-private-trade-evaluation-generation:${'a'.repeat(64)}`;
const transitionId = `private-evaluation-transition:${'c'.repeat(64)}`;
const operationId = `private-evaluation-operation:${'d'.repeat(64)}`;
const now = '2026-08-19T10:01:00.000Z';

type InspectionHead = Readonly<{
  status: 'active' | 'withdrawn';
  revision: number;
  generationId: string | null;
}>;

function retainedInspection(
  head: InspectionHead = { status: 'active', revision: 1, generationId }
) {
  return createUnavailableGovernedPrivateEvaluationAuthorityInspection({
    selector,
    capturedAt: '2026-08-19T10:00:00.000Z',
    validThrough: '2026-08-19T10:05:00.000Z',
    head,
    lastTransitionId: transitionId,
    blockers: [{ code: 'model_not_approved', message: 'Approved model runs are unavailable.' }],
  });
}

class ExecutionSqlClient implements AflOutcomeSqlClient {
  readonly retained;
  private readonly operatorAuthorized;
  private readonly stagedIntent;

  constructor(
    options: Readonly<{
      operatorAuthorized?: boolean;
      head?: InspectionHead;
      stagedIntent?: ReturnType<typeof createGovernedPrivateEvaluationTransitionIntent>;
    }> = {}
  ) {
    this.operatorAuthorized = options.operatorAuthorized ?? true;
    this.retained = retainedInspection(options.head);
    this.stagedIntent = options.stagedIntent;
  }

  async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
    if (sql.includes('SELECT from_generation_id')) {
      return {
        rows: [{ from_generation_id: priorGenerationId }],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_private_evaluation_transition_receipt')) {
      return { rows: [], rowCount: 0 } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_private_evaluation_transition_intent')) {
      return {
        rows: this.stagedIntent === undefined ? [] : [{ intent_json: this.stagedIntent }],
        rowCount: this.stagedIntent === undefined ? 0 : 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_private_evaluation_inspection_receipt ir')) {
      return {
        rows: [
          {
            receipt_json: this.retained.inspection,
            snapshot_json: this.retained.snapshot,
          },
        ],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('transaction_timestamp()')) {
      return {
        rows: [{ trusted_at: new Date(now) }],
        rowCount: 1,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    if (sql.includes('FROM outcome_operational_principal_authority')) {
      return {
        rows: this.operatorAuthorized
          ? [{ authority_evidence_id: `reviewer-authority-evidence:${'e'.repeat(64)}` }]
          : [],
        rowCount: this.operatorAuthorized ? 1 : 0,
      } as AflOutcomeSqlQueryResult<Row>;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  async transaction<T>(
    work: (transaction: AflOutcomeSqlTransaction) => Promise<T>
  ): Promise<T> {
    return work(this);
  }
}

describe('governed private evaluation execution service', () => {
  it('derives operator identity internally and withdraws from unavailable model authority', async () => {
    const client = new ExecutionSqlClient();
    const stage = vi.fn(async (input) => ({
      transitionIntentId: input.intent.transitionIntentId,
      generationId: null,
    }));
    const retainArtifact = vi.fn(async (artifact) => artifact.reference);
    const commit = vi.fn(async (input) => ({
      state: 'committed' as const,
      head: input.receipt.content.toHead,
      transitionId: input.receipt.transitionId,
    }));
    const service = createPostgresGovernedPrivateEvaluationExecutionService({
      client,
      principalId: 'firebase:authenticated-operator',
      staging: { stage, retainArtifact },
      lifecycle: { commit },
      reconstruction: { verify: vi.fn() },
    });
    const inspectionId = client.retained.inspection.inspectionId;

    await expect(
      service.execute({
        inspectionId,
        operationId,
        action: { kind: 'withdraw', reason: 'Remove the unavailable active grade.' },
        review: { rationale: 'Fail closed while model authority is unavailable.' },
      })
    ).resolves.toMatchObject({
      state: 'withdrawn',
      selector,
      inspectionId,
      operationId,
      head: { status: 'withdrawn', revision: 2, generationId: null },
    });
    expect(stage).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          content: expect.objectContaining({
            authoritySnapshotId: null,
            review: {
              principalId: 'firebase:authenticated-operator',
              rationale: 'Fail closed while model authority is unavailable.',
            },
          }),
        }),
      })
    );
    expect(retainArtifact).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('resumes the exact staged intent when retrying an operation before receipt commit', async () => {
    const retained = retainedInspection();
    const stagedIntent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: retained.inspection.inspectionId,
      authoritySnapshotId: null,
      operationId,
      action: { kind: 'withdraw', reason: 'Remove the unavailable active grade.' },
      expectedHead: retained.inspection.content.head,
      review: {
        principalId: 'firebase:authenticated-operator',
        rationale: 'Fail closed while model authority is unavailable.',
      },
      requestedAt: '2026-08-19T10:00:30.000Z',
      expiresAt: retained.inspection.content.validThrough,
    });
    const client = new ExecutionSqlClient({ stagedIntent });
    const stage = vi.fn();
    const retainArtifact = vi.fn(async (artifact) => artifact.reference);
    const commit = vi.fn(async (input) => ({
      state: 'committed' as const,
      head: input.receipt.content.toHead,
      transitionId: input.receipt.transitionId,
    }));
    const service = createPostgresGovernedPrivateEvaluationExecutionService({
      client,
      principalId: 'firebase:authenticated-operator',
      staging: { stage, retainArtifact },
      lifecycle: { commit },
      reconstruction: { verify: vi.fn() },
    });

    await expect(
      service.execute({
        inspectionId: client.retained.inspection.inspectionId,
        operationId,
        action: { kind: 'withdraw', reason: 'Remove the unavailable active grade.' },
        review: { rationale: 'Fail closed while model authority is unavailable.' },
      })
    ).resolves.toMatchObject({ state: 'withdrawn', operationId });

    expect(stage).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt: expect.objectContaining({
          content: expect.objectContaining({
            intent: stagedIntent,
            transitionedAt: stagedIntent.content.requestedAt,
          }),
        }),
      })
    );
  });

  it('keeps construction unavailable without approved component model runs', async () => {
    const client = new ExecutionSqlClient();
    const stage = vi.fn();
    const service = createPostgresGovernedPrivateEvaluationExecutionService({
      client,
      principalId: 'firebase:authenticated-operator',
      staging: { stage, retainArtifact: vi.fn() },
      lifecycle: { commit: vi.fn() },
      reconstruction: { verify: vi.fn() },
    });

    await expect(
      service.execute({
        inspectionId: client.retained.inspection.inspectionId,
        operationId,
        action: { kind: 'construct_and_activate' },
        review: { rationale: 'Attempt construction.' },
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      selector,
      blockers: [{ code: 'model_not_approved' }],
    });
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'rollback',
      head: { status: 'active', revision: 2, generationId } as const,
      action: { kind: 'rollback', targetGenerationId: priorGenerationId } as const,
    },
    {
      label: 'recovery',
      head: { status: 'withdrawn', revision: 2, generationId: null } as const,
      action: { kind: 'recover' } as const,
    },
  ])('rejects $label when calculation authority is unavailable', async ({ head, action }) => {
    const client = new ExecutionSqlClient({ head });
    const stage = vi.fn();
    const commit = vi.fn(async (input) => ({
      state: 'committed' as const,
      head: input.receipt.content.toHead,
      transitionId: input.receipt.transitionId,
    }));
    const verify = vi.fn();
    const service = createPostgresGovernedPrivateEvaluationExecutionService({
      client,
      principalId: 'firebase:authenticated-operator',
      staging: { stage, retainArtifact: vi.fn() },
      lifecycle: { commit },
      reconstruction: { verify },
    });

    await expect(
      service.execute({
        inspectionId: client.retained.inspection.inspectionId,
        operationId,
        action,
        review: { rationale: 'Unavailable real authority cannot reactivate a fixture grade.' },
      })
    ).resolves.toMatchObject({
      state: 'invalid_transition',
      selector,
      message: 'Rollback and recovery require exact ready calculation authority.',
    });
    expect(verify).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects an authenticated identity without current governed operator authority', async () => {
    const client = new ExecutionSqlClient({ operatorAuthorized: false });
    const service = createPostgresGovernedPrivateEvaluationExecutionService({
      client,
      principalId: 'firebase:authenticated-reader',
      staging: { stage: vi.fn(), retainArtifact: vi.fn() },
      lifecycle: { commit: vi.fn() },
      reconstruction: { verify: vi.fn() },
    });

    await expect(
      service.execute({
        inspectionId: client.retained.inspection.inspectionId,
        operationId,
        action: { kind: 'withdraw', reason: 'Attempt an unauthorized withdrawal.' },
        review: { rationale: 'A registered reader must not control lifecycle state.' },
      })
    ).rejects.toThrow('current governed operator authority');
  });
});
