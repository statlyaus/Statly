import { describe, expect, it, vi } from 'vitest';

import {
  createPrivateLocalWorkbookReads,
  type PrivateLocalWorkbookReadEnvironment,
} from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
import type { LocalAflTradeValuationReadiness } from '@/server/aflTradeIntelligence/development/localAflTradeValuationReadiness';
import type {
  LocalWorkbookEvaluationArchive,
  LocalWorkbookEvaluationService,
  LocalWorkbookTradeEvaluation,
} from '@/server/aflTradeIntelligence/development/localWorkbookEvaluation';
import type {
  GovernedPrivateEvaluationReadRequest,
  GovernedPrivateEvaluationReadResult,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationWorkspace';

const admittedEnvironment: PrivateLocalWorkbookReadEnvironment = {
  NODE_ENV: 'development',
  STATLY_ENABLE_DEV_TOOLS: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_READ_ENABLED: 'true',
  AFL_OUTCOMES_DEV_WORKBOOK_PATH: '/private/AFL Drafts Trades.xlsx',
  AFL_OUTCOMES_DEV_WORKBOOK_SHA256: 'a'.repeat(64),
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://postgres:postgres@127.0.0.1:55432/statly_outcomes_test?sslmode=disable',
  AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/private/statly-artifacts',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: 'b'.repeat(64),
};

const archive = { year: 2025, publicationEligible: false } as LocalWorkbookEvaluationArchive;
const tradeEvaluation = {
  detail: { trade: { tradeId: 'trade:carlton-fremantle-gold-coast', year: 2025 } },
  publicationEligible: false,
} as LocalWorkbookTradeEvaluation;
const governedGenerationId = `local-private-trade-evaluation-generation:${'c'.repeat(64)}`;

function governedRead(
  kind: 'detail' | 'json_export',
  bytes: Uint8Array,
  selection: GovernedPrivateEvaluationReadRequest['selection'] = { kind: 'current' }
): GovernedPrivateEvaluationReadResult {
  return {
    state: 'available',
    selector: {
      valuationScopeKey: 'afl-men:2025-trades',
      tradeId: 'trade:carlton-fremantle-gold-coast',
    },
    selection,
    generationId: governedGenerationId,
    projectionManifestId: `private-evaluation-projection-manifest:${'d'.repeat(64)}`,
    lifecycle: { status: 'active', current: true },
    document: {
      kind,
      artifact: {
        artifactId: `artifact:${'e'.repeat(64)}`,
        storageUri: `memory://artifact/${'e'.repeat(64)}`,
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        contentSha256: 'f'.repeat(64),
        createdAt: '2026-08-19T00:00:00.000Z',
      },
    },
    bytes,
  };
}

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
  readGovernedEvaluation?: Parameters<
    typeof createPrivateLocalWorkbookReads
  >[0]['readGovernedEvaluation'];
  trade?: LocalWorkbookTradeEvaluation | null;
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
    loadTrade: vi.fn().mockResolvedValue(input?.trade ?? null),
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
      readGovernedEvaluation: input?.readGovernedEvaluation,
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

  it('keeps legacy archive and detail reads available without governed artifact custody', async () => {
    const environment = { ...admittedEnvironment, AFL_TRADE_LOCAL_ARTIFACT_ROOT: undefined };
    const { reads } = dependencies({
      environment: () => environment,
      trade: tradeEvaluation,
    });

    await expect(reads.loadArchive({ year: 2025 })).resolves.toMatchObject(archive);
    await expect(reads.loadTrade('trade:carlton-fremantle-gold-coast')).resolves.toMatchObject({
      detail: tradeEvaluation.detail,
    });
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

  it('derives the governed selector from the real transaction and returns authenticated detail bytes', async () => {
    const detailBytes = new TextEncoder().encode('{"detail":"retained"}');
    const readGovernedEvaluation = vi.fn().mockResolvedValue(governedRead('detail', detailBytes));
    const { reads } = dependencies({ trade: tradeEvaluation, readGovernedEvaluation });

    await expect(reads.loadTrade('trade:carlton-fremantle-gold-coast')).resolves.toMatchObject({
      detail: tradeEvaluation.detail,
      governedEvaluation: {
        state: 'available',
        document: { kind: 'detail' },
        bytes: detailBytes,
      },
    });
    expect(readGovernedEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/private/statly-artifacts' }),
      'statly-dev-tester',
      {
        selector: {
          valuationScopeKey: 'afl-men:2025-trades',
          tradeId: 'trade:carlton-fremantle-gold-coast',
        },
        selection: { kind: 'current' },
        document: { kind: 'detail' },
      }
    );
  });

  it('returns the retained JSON export bytes exactly and conceals them from a non-operator', async () => {
    const exportBytes = new TextEncoder().encode('{"exact":true}\n');
    const readGovernedEvaluation = vi
      .fn()
      .mockResolvedValue(governedRead('json_export', exportBytes));
    const { reads } = dependencies({ trade: tradeEvaluation, readGovernedEvaluation });

    const exported = await reads.loadExactJsonExport(
      'trade:carlton-fremantle-gold-coast',
      governedGenerationId
    );
    expect(exported).toMatchObject({
      state: 'available',
      document: { kind: 'json_export' },
    });
    expect(exported?.state === 'available' ? exported.bytes : null).toBe(exportBytes);

    const concealed = dependencies({
      trade: tradeEvaluation,
      readGovernedEvaluation,
      authenticate: vi.fn().mockResolvedValue('another-authenticated-user'),
    });
    await expect(
      concealed.reads.loadExactJsonExport(
        'trade:carlton-fremantle-gold-coast',
        governedGenerationId
      )
    ).resolves.toBeNull();
  });

  it('reads an explicit JSON generation after the workbook service is recreated', async () => {
    const exportBytes = new TextEncoder().encode('{"export":"generation-a"}\n');
    const readGovernedEvaluation = vi.fn().mockResolvedValue(
      governedRead('json_export', exportBytes, {
        kind: 'generation',
        generationId: governedGenerationId,
      })
    );
    const restarted = dependencies({ trade: tradeEvaluation, readGovernedEvaluation });

    await restarted.reads.loadExactJsonExport(
      'trade:carlton-fremantle-gold-coast',
      governedGenerationId
    );

    expect(readGovernedEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ AFL_TRADE_LOCAL_ARTIFACT_ROOT: '/private/statly-artifacts' }),
      'statly-dev-tester',
      {
        selector: {
          valuationScopeKey: 'afl-men:2025-trades',
          tradeId: 'trade:carlton-fremantle-gold-coast',
        },
        selection: { kind: 'generation', generationId: governedGenerationId },
        document: { kind: 'json_export' },
      }
    );
  });

  it.each([undefined, 'relative/artifacts'])(
    'fails closed for governed reads with invalid artifact custody (%s)',
    async (artifactRoot) => {
      const readGovernedEvaluation = vi.fn();
      const { reads } = dependencies({
        environment: () => ({
          ...admittedEnvironment,
          AFL_TRADE_LOCAL_ARTIFACT_ROOT: artifactRoot,
        }),
        trade: tradeEvaluation,
        readGovernedEvaluation,
      });

      await expect(reads.loadTrade('trade:carlton-fremantle-gold-coast')).rejects.toThrow(
        'Governed private evaluation artifact configuration is invalid.'
      );
      await expect(
        reads.loadExactJsonExport('trade:carlton-fremantle-gold-coast', governedGenerationId)
      ).rejects.toThrow('Governed private evaluation artifact configuration is invalid.');
      expect(readGovernedEvaluation).not.toHaveBeenCalled();
    }
  );

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
