import { describe, expect, it, vi } from 'vitest';

import { runAflTradeManageValuationPublicationCommand } from '../../Scripts/manage-afl-trade-valuation-publication';

const INPUT_PATH = '/reviewed/valuation-publication-transition.json';
const PUBLICATION_ID = `publication:${'1'.repeat(64)}`;
const GATE_DECISION_ID = `gate-decision:${'2'.repeat(64)}`;
const EVIDENCE_ID = `incident:${'3'.repeat(64)}`;
const baseEnvironment = {
  AFL_TRADE_VALUATION_ENVIRONMENT: 'production',
  AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly',
};
const projectionEnvironment = {
  ...baseEnvironment,
  AFL_TRADE_OBJECT_BUCKET: 'statly-public-projections',
  AFL_TRADE_OBJECT_PREFIX: 'afl-trade/projections',
  AFL_TRADE_OBJECT_KMS_KEY_ID: 'kms-key-production',
  AFL_TRADE_OBJECT_REPOSITORY_ID: 'public-projection-production',
  AFL_TRADE_OBJECT_POLICY_EVIDENCE_ID: `storage-policy:${'4'.repeat(64)}`,
  AWS_REGION: 'ap-southeast-2',
};

const summary = (action: 'validate' | 'approve' | 'publish' | 'reject' | 'withdraw') => ({
  action,
  publicationId: PUBLICATION_ID,
  projectionId: action === 'validate' ? `projection:${'5'.repeat(64)}` : null,
  state:
    action === 'validate'
      ? 'validated'
      : action === 'approve'
        ? 'approved'
        : action === 'publish'
          ? 'published'
          : action === 'reject'
            ? 'rejected'
            : 'withdrawn',
  registryRevision: 8,
  activePublicationId: action === 'publish' ? PUBLICATION_ID : null,
  idempotentReplay: false,
});
const output = (
  action: 'validate' | 'approve' | 'publish' | 'reject' | 'withdraw',
  cleanupStatus: 'closed' | 'failed'
) => JSON.stringify({ ...summary(action), cleanupStatus });

describe('manage AFL trade valuation publication command', () => {
  it('validates an exact projection through configured public-projection custody', async () => {
    const command = {
      action: 'validate' as const,
      verification: { projectionMaterialization: 'reviewed' },
      actor: 'projection-review-operator',
    };
    const execute = vi.fn().mockResolvedValue(summary('validate'));
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ execute, close });
    const writeOutput = vi.fn();

    const result = await runAflTradeManageValuationPublicationCommand(
      { argv: ['--input', INPUT_PATH], env: projectionEnvironment },
      { readInput: vi.fn().mockResolvedValue(command), connect, writeOutput }
    );

    expect(connect).toHaveBeenCalledWith({
      environment: 'production',
      databaseUrl: 'postgresql://outcomes.example/statly',
      objectStorage: {
        bucket: 'statly-public-projections',
        keyPrefix: 'afl-trade/projections',
        kmsKeyId: 'kms-key-production',
        repositoryId: 'public-projection-production',
        policyEvidenceId: `storage-policy:${'4'.repeat(64)}`,
        region: 'ap-southeast-2',
      },
    });
    expect(execute).toHaveBeenCalledWith(command);
    expect(writeOutput).toHaveBeenCalledWith(output('validate', 'closed'));
    expect(close).toHaveBeenCalledOnce();
    expect(result).toEqual(summary('validate'));
  });

  it.each(['approve', 'publish'] as const)(
    '%s resolves the exact durable Gate decision instead of accepting a ledger',
    async (action) => {
      const command = {
        action,
        publicationId: PUBLICATION_ID,
        gateDecisionId: GATE_DECISION_ID,
        actor: 'publication-review-operator',
      };
      const execute = vi.fn().mockResolvedValue(summary(action));
      const close = vi.fn().mockResolvedValue(undefined);

      await runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue(command),
          connect: vi.fn().mockResolvedValue({ execute, close }),
          writeOutput: vi.fn(),
        }
      );

      expect(execute).toHaveBeenCalledWith(command);
      expect(close).toHaveBeenCalledOnce();
    }
  );

  it.each(['reject', 'withdraw'] as const)(
    '%s remains available with PostgreSQL alone during projection-storage failure',
    async (action) => {
      const command = {
        action,
        publicationId: PUBLICATION_ID,
        actor: 'production-incident-commander',
        evidenceId: EVIDENCE_ID,
        reason: 'Reviewed integrity incident requires a fail-closed numerical transition.',
      };
      const execute = vi.fn().mockResolvedValue(summary(action));
      const close = vi.fn().mockResolvedValue(undefined);
      const connect = vi.fn().mockResolvedValue({ execute, close });

      await runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue(command),
          connect,
          writeOutput: vi.fn(),
        }
      );

      expect(connect).toHaveBeenCalledWith({
        environment: 'production',
        databaseUrl: 'postgresql://outcomes.example/statly',
      });
      expect(execute).toHaveBeenCalledWith(command);
      expect(close).toHaveBeenCalledOnce();
    }
  );

  it('rejects malformed commands before opening any infrastructure', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: projectionEnvironment },
        {
          readInput: vi.fn().mockResolvedValue({
            action: 'publish',
            publicationId: PUBLICATION_ID,
            actor: 'operator-without-a-gate-decision',
          }),
          connect,
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow();

    expect(connect).not.toHaveBeenCalled();
  });

  it('requires object-storage configuration only for projection validation', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue({
            action: 'validate',
            verification: { projectionMaterialization: 'reviewed' },
            actor: 'projection-review-operator',
          }),
          connect,
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow('Invalid AFL trade valuation publication lifecycle configuration');

    expect(connect).not.toHaveBeenCalled();
  });

  it('always closes its infrastructure after a failed transition', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const writeOutput = vi.fn();

    await expect(
      runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue({
            action: 'withdraw',
            publicationId: PUBLICATION_ID,
            actor: 'production-incident-commander',
            evidenceId: EVIDENCE_ID,
            reason: 'Reviewed integrity incident requires withdrawal.',
          }),
          connect: vi.fn().mockResolvedValue({
            execute: vi.fn().mockRejectedValue(new Error('stale registry revision')),
            close,
          }),
          writeOutput,
        }
      )
    ).rejects.toThrow('stale registry revision');

    expect(close).toHaveBeenCalledOnce();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it('reports committed state with failed cleanup before returning a cleanup error', async () => {
    const close = vi.fn().mockRejectedValue(new Error('pool shutdown failed'));
    const writeOutput = vi.fn();

    await expect(
      runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue({
            action: 'reject',
            publicationId: PUBLICATION_ID,
            actor: 'production-incident-commander',
            evidenceId: EVIDENCE_ID,
            reason: 'Reviewed integrity incident requires rejection.',
          }),
          connect: vi.fn().mockResolvedValue({
            execute: vi.fn().mockResolvedValue(summary('reject')),
            close,
          }),
          writeOutput,
        }
      )
    ).rejects.toThrow('committed, but infrastructure cleanup failed');

    expect(writeOutput).toHaveBeenCalledWith(output('reject', 'failed'));
  });

  it('preserves the transition error when transition and cleanup both fail', async () => {
    const transitionError = new Error('publication state changed concurrently');
    const close = vi.fn().mockRejectedValue(new Error('pool shutdown failed'));
    const writeOutput = vi.fn();

    await expect(
      runAflTradeManageValuationPublicationCommand(
        { argv: ['--input', INPUT_PATH], env: baseEnvironment },
        {
          readInput: vi.fn().mockResolvedValue({
            action: 'withdraw',
            publicationId: PUBLICATION_ID,
            actor: 'production-incident-commander',
            evidenceId: EVIDENCE_ID,
            reason: 'Reviewed integrity incident requires withdrawal.',
          }),
          connect: vi.fn().mockResolvedValue({
            execute: vi.fn().mockRejectedValue(transitionError),
            close,
          }),
          writeOutput,
        }
      )
    ).rejects.toBe(transitionError);

    expect(close).toHaveBeenCalledOnce();
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
