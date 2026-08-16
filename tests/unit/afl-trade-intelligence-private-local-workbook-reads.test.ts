import { describe, expect, it, vi } from 'vitest';

import {
  createPrivateLocalWorkbookReads,
  type PrivateLocalWorkbookReadEnvironment,
} from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
import type { LocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';
import type {
  LocalWorkbookEvaluationArchive,
  LocalWorkbookEvaluationService,
} from '@/server/aflTradeIntelligence/development/localWorkbookEvaluation';

const admittedEnvironment: PrivateLocalWorkbookReadEnvironment = {
  NODE_ENV: 'development',
  STATLY_ENABLE_DEV_TOOLS: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/private/AFL Drafts Trades.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: 'a'.repeat(64),
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://postgres:postgres@127.0.0.1:55432/statly_outcomes_test?sslmode=disable',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'b'.repeat(64),
};

const archive = { year: 2025, publicationEligible: false } as LocalWorkbookEvaluationArchive;

const readinessFixture: LocalAflTradeValuationReadiness = {
  state: 'blocked',
  numericalCalculationsAvailable: false,
  qualificationReportCreated: false,
  qualificationReportId: null,
  factualReleaseId: null,
  qualificationEvaluatedAt: null,
  privateEvaluationAuthorityState: 'not_authorized',
  privateEvaluationEvidenceKind: null,
  privateEvaluationDecisionId: null,
  privateEvaluationDecidedAt: null,
  privateEvaluationEvidenceBundleId: null,
  retainedEvidenceCandidateCount: null,
  retainedEvidenceDecisionCount: null,
  retainedEvidenceSourceCaptureCount: null,
  retainedEvidenceSourceRightsCount: null,
  preparedInputSetCreated: false,
  preparedInputSetCount: 0,
  preparedInputSetIds: [],
  scopeKey: 'afl-men:2025-trades',
  blockerCodes: ['source_qualification_not_run', 'private_evaluation_not_authorized'],
  sources: [],
  requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
  explanation: 'blocked',
};

function dependencies(input?: {
  authenticate?: () => Promise<string | null>;
  authenticateRuntime?: (environment: PrivateLocalWorkbookReadEnvironment) => Promise<void>;
  inspectValuationReadiness?: (
    environment: PrivateLocalWorkbookReadEnvironment,
    scopeKey: string
  ) => Promise<LocalAflTradeValuationReadiness>;
  readValuationReadinessGeneration?: (
    environment: PrivateLocalWorkbookReadEnvironment
  ) => Promise<string>;
  environment?: () => PrivateLocalWorkbookReadEnvironment;
}) {
  const inspectValuationReadiness =
    input?.inspectValuationReadiness ?? vi.fn().mockResolvedValue(readinessFixture);
  const readValuationReadinessGeneration =
    input?.readValuationReadinessGeneration ?? vi.fn().mockResolvedValue('0/1');
  const evaluation: LocalWorkbookEvaluationService = {
    loadArchive: vi.fn(async (_query, _environment, inspect) => ({
      ...archive,
      numericalEvaluation: {
        state: 'blocked' as const,
        readiness: await inspect('afl-men:2025-trades'),
      },
    })),
    loadTrade: vi.fn().mockResolvedValue(null),
  };
  return {
    evaluation,
    inspectValuationReadiness,
    readValuationReadinessGeneration,
    reads: createPrivateLocalWorkbookReads({
      authenticate: input?.authenticate ?? vi.fn().mockResolvedValue('statly-dev-tester'),
      authenticateRuntime: input?.authenticateRuntime ?? vi.fn().mockResolvedValue(undefined),
      inspectValuationReadiness,
      readValuationReadinessGeneration,
      environment: input?.environment ?? (() => admittedEnvironment),
      evaluation,
    }),
  };
}

describe('private local workbook reads', () => {
  it.each([null, 'another-authenticated-user'])(
    'conceals the workbook from a non-operator identity (%s)',
    async (userId) => {
      const { reads, evaluation, inspectValuationReadiness } = dependencies({
        authenticate: vi.fn().mockResolvedValue(userId),
      });

      await expect(reads.loadArchive({ year: 2025 })).resolves.toBeNull();

      expect(evaluation.loadArchive).not.toHaveBeenCalled();
      expect(inspectValuationReadiness).not.toHaveBeenCalled();
    }
  );

  it('passes one validated environment snapshot to the admitted workbook operation', async () => {
    const sourceEnvironment = { ...admittedEnvironment };
    const authenticateRuntime = vi.fn().mockResolvedValue(undefined);
    const { reads, evaluation, inspectValuationReadiness } = dependencies({
      authenticateRuntime,
      environment: () => sourceEnvironment,
    });

    await expect(reads.loadArchive({ year: 2025 })).resolves.toMatchObject({
      ...archive,
      numericalEvaluation: {
        state: 'blocked',
        readiness: { preparedInputSetCount: 0 },
      },
    });

    expect(evaluation.loadArchive).toHaveBeenCalledWith(
      { year: 2025 },
      expect.objectContaining(admittedEnvironment),
      expect.any(Function)
    );
    expect(vi.mocked(evaluation.loadArchive).mock.calls[0]?.[1]).not.toBe(sourceEnvironment);
    expect(authenticateRuntime).toHaveBeenCalledWith(
      vi.mocked(evaluation.loadArchive).mock.calls[0]?.[1]
    );
    expect(inspectValuationReadiness).toHaveBeenCalledWith(
      vi.mocked(evaluation.loadArchive).mock.calls[0]?.[1],
      'afl-men:2025-trades'
    );
  });

  it('does not read workbook data when PostgreSQL rejects the runtime nonce', async () => {
    const authenticateRuntime = vi
      .fn()
      .mockRejectedValue(new Error('The outcomes runtime nonce does not match.'));
    const { reads, evaluation } = dependencies({ authenticateRuntime });

    await expect(reads.loadArchive({ year: 2025 })).rejects.toThrow(
      'The outcomes runtime nonce does not match.'
    );
    expect(evaluation.loadArchive).not.toHaveBeenCalled();
  });

  it('reuses authenticated readiness while the PostgreSQL generation is unchanged', async () => {
    const { reads, inspectValuationReadiness, readValuationReadinessGeneration } = dependencies();

    await expect(reads.loadArchive({ year: 2025 })).resolves.not.toBeNull();
    await expect(reads.loadArchive({ year: 2025 })).resolves.not.toBeNull();

    expect(readValuationReadinessGeneration).toHaveBeenCalledTimes(2);
    expect(inspectValuationReadiness).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent readiness authentication for one PostgreSQL generation', async () => {
    let resolveReadiness!: (readiness: LocalAflTradeValuationReadiness) => void;
    const pendingReadiness = new Promise<LocalAflTradeValuationReadiness>((resolve) => {
      resolveReadiness = resolve;
    });
    const inspectValuationReadiness = vi.fn().mockReturnValue(pendingReadiness);
    const { reads } = dependencies({ inspectValuationReadiness });

    const first = reads.loadArchive({ year: 2025 });
    const second = reads.loadArchive({ year: 2025 });
    await vi.waitFor(() => expect(inspectValuationReadiness).toHaveBeenCalledTimes(1));
    resolveReadiness(readinessFixture);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(inspectValuationReadiness).toHaveBeenCalledTimes(1);
  });

  it('re-authenticates readiness after the PostgreSQL generation advances', async () => {
    const currentReadiness = {
      ...readinessFixture,
      explanation: 'current generation',
    };
    const readValuationReadinessGeneration = vi
      .fn()
      .mockResolvedValueOnce('0/1')
      .mockResolvedValueOnce('0/2');
    const inspectValuationReadiness = vi
      .fn()
      .mockResolvedValueOnce(readinessFixture)
      .mockResolvedValueOnce(currentReadiness);
    const { reads } = dependencies({
      inspectValuationReadiness,
      readValuationReadinessGeneration,
    });

    await expect(reads.loadArchive({ year: 2025 })).resolves.toMatchObject({
      numericalEvaluation: { readiness: readinessFixture },
    });
    await expect(reads.loadArchive({ year: 2025 })).resolves.toMatchObject({
      numericalEvaluation: { readiness: currentReadiness },
    });

    expect(inspectValuationReadiness).toHaveBeenCalledTimes(2);
  });

  it('evicts a failed readiness authentication so the same generation can retry', async () => {
    const inspectValuationReadiness = vi
      .fn()
      .mockRejectedValueOnce(new Error('readiness authentication failed'))
      .mockResolvedValueOnce(readinessFixture);
    const { reads } = dependencies({ inspectValuationReadiness });

    await expect(reads.loadArchive({ year: 2025 })).rejects.toThrow(
      'readiness authentication failed'
    );
    await expect(reads.loadArchive({ year: 2025 })).resolves.not.toBeNull();

    expect(inspectValuationReadiness).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['production mode', { NODE_ENV: 'production' }],
    ['disabled development tools', { STATLY_ENABLE_DEV_TOOLS: 'false' }],
    ['disabled workbook reads', { AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'false' }],
  ])('conceals the workbook in %s', async (_label, override) => {
    const { reads, evaluation } = dependencies({
      environment: () => ({ ...admittedEnvironment, ...override }),
    });

    await expect(reads.loadArchive({ year: 2025 })).resolves.toBeNull();
    expect(evaluation.loadArchive).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid workbook digest', { AFL_OUTCOMES_DEV_WORKBOOK_SHA256: 'not-a-digest' }],
    [
      'a non-loopback database',
      { AFL_OUTCOMES_DATABASE_URL: 'postgresql://db/statly_outcomes_test' },
    ],
    [
      'the wrong database',
      {
        AFL_OUTCOMES_DATABASE_URL:
          'postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable',
      },
    ],
    ['an invalid runtime nonce', { STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'not-a-nonce' }],
  ])('fails closed when enabled with %s', async (_label, override) => {
    const { reads, evaluation } = dependencies({
      environment: () => ({ ...admittedEnvironment, ...override }),
    });

    await expect(reads.loadArchive({ year: 2025 })).rejects.toThrow(
      'Private workbook evaluation runtime configuration is invalid.'
    );
    expect(evaluation.loadArchive).not.toHaveBeenCalled();
  });
});
