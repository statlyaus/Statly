import { describe, expect, it, vi } from 'vitest';

import {
  createPrivateLocalWorkbookReads,
  type PrivateLocalWorkbookReadEnvironment,
} from '@/server/aflTradeIntelligence/development/privateLocalWorkbookReads';
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

const archive = { publicationEligible: false } as LocalWorkbookEvaluationArchive;

function dependencies(input?: {
  authenticate?: () => Promise<string | null>;
  authenticateRuntime?: (environment: PrivateLocalWorkbookReadEnvironment) => Promise<void>;
  environment?: () => PrivateLocalWorkbookReadEnvironment;
}) {
  const evaluation: LocalWorkbookEvaluationService = {
    loadArchive: vi.fn().mockResolvedValue(archive),
    loadTrade: vi.fn().mockResolvedValue(null),
  };
  return {
    evaluation,
    reads: createPrivateLocalWorkbookReads({
      authenticate: input?.authenticate ?? vi.fn().mockResolvedValue('statly-dev-tester'),
      authenticateRuntime: input?.authenticateRuntime ?? vi.fn().mockResolvedValue(undefined),
      environment: input?.environment ?? (() => admittedEnvironment),
      evaluation,
    }),
  };
}

describe('private local workbook reads', () => {
  it.each([null, 'another-authenticated-user'])(
    'conceals the workbook from a non-operator identity (%s)',
    async (userId) => {
      const { reads, evaluation } = dependencies({
        authenticate: vi.fn().mockResolvedValue(userId),
      });

      await expect(reads.loadArchive({ year: 2025 })).resolves.toBeNull();

      expect(evaluation.loadArchive).not.toHaveBeenCalled();
    }
  );

  it('passes one validated environment snapshot to the admitted workbook operation', async () => {
    const sourceEnvironment = { ...admittedEnvironment };
    const authenticateRuntime = vi.fn().mockResolvedValue(undefined);
    const { reads, evaluation } = dependencies({
      authenticateRuntime,
      environment: () => sourceEnvironment,
    });

    await expect(reads.loadArchive({ year: 2025 })).resolves.toBe(archive);

    expect(evaluation.loadArchive).toHaveBeenCalledWith(
      { year: 2025 },
      expect.objectContaining(admittedEnvironment)
    );
    expect(vi.mocked(evaluation.loadArchive).mock.calls[0]?.[1]).not.toBe(sourceEnvironment);
    expect(authenticateRuntime).toHaveBeenCalledWith(
      vi.mocked(evaluation.loadArchive).mock.calls[0]?.[1]
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
