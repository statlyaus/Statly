import { describe, expect, it, vi } from 'vitest';

import { runAflTradePrepareValuationPublicationCommand } from '../../Scripts/prepare-afl-trade-valuation-publication';

const databaseUrl = 'postgresql://outcomes.example/statly';
const inputPath = '/reviewed/valuation-publication.json';
const environment = {
  AFL_TRADE_VALUATION_ENVIRONMENT: 'production',
  AFL_OUTCOMES_DATABASE_URL: databaseUrl,
  AFL_TRADE_VALUATION_OBJECT_BUCKET: 'statly-valuation-production',
  AFL_TRADE_VALUATION_OBJECT_PREFIX: 'afl-trade/valuation',
  AFL_TRADE_VALUATION_OBJECT_KMS_KEY_ID: 'kms-key-production',
  AFL_TRADE_VALUATION_OBJECT_REPOSITORY_ID: 'valuation-production',
  AFL_TRADE_VALUATION_OBJECT_POLICY_EVIDENCE_ID: `storage-policy:${'1'.repeat(64)}`,
  AWS_REGION: 'ap-southeast-2',
};

const command = {
  inventoryIndexVerification: { inventoryIndex: 'reviewed' },
  inventoryCustodyInputs: [
    {
      verification: { inventory: 'reviewed' },
      assessmentVerification: { assessment: 'reviewed' },
    },
  ],
  actor: 'valuation-publication-operator',
  preparationKey: 'production-2026-08-11-v1',
  universalLayer: 'list_spot_adjusted' as const,
  maximumConcurrentInventories: 4,
  publicationCandidate: { publication: 'reviewed' },
};

const summary = {
  status: 'candidate_registered' as const,
  publicationEligible: false as const,
  environment: 'production' as const,
  preparationKey: command.preparationKey,
  publicationId: `publication:${'2'.repeat(64)}`,
  custodyIndexId: `valuation-output-custody-index:${'3'.repeat(64)}`,
  registryRevision: 7,
  idempotentReplay: false,
};

describe('prepare AFL trade valuation publication command', () => {
  it('forwards one reviewed input and prints only the immutable registration summary', async () => {
    const prepare = vi.fn().mockResolvedValue(summary);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ prepare, close });
    const writeOutput = vi.fn();

    const result = await runAflTradePrepareValuationPublicationCommand(
      { argv: ['--input', inputPath], env: environment },
      {
        readInput: vi.fn().mockResolvedValue(command),
        connect,
        writeOutput,
      }
    );

    expect(connect).toHaveBeenCalledWith({
      environment: 'production',
      databaseUrl,
      objectStorage: {
        bucket: 'statly-valuation-production',
        keyPrefix: 'afl-trade/valuation',
        kmsKeyId: 'kms-key-production',
        repositoryId: 'valuation-production',
        policyEvidenceId: `storage-policy:${'1'.repeat(64)}`,
        region: 'ap-southeast-2',
      },
    });
    expect(prepare).toHaveBeenCalledWith(command);
    expect(writeOutput).toHaveBeenCalledWith(JSON.stringify(summary));
    expect(close).toHaveBeenCalledOnce();
    expect(result).toEqual(summary);
  });

  it('rejects malformed reviewed input before opening PostgreSQL or object storage', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradePrepareValuationPublicationCommand(
        { argv: ['--input', inputPath], env: environment },
        {
          readInput: vi.fn().mockResolvedValue({ ...command, inventoryCustodyInputs: [] }),
          connect,
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow();

    expect(connect).not.toHaveBeenCalled();
  });

  it('requires explicit durable infrastructure configuration before reading private evidence', async () => {
    const readInput = vi.fn();

    await expect(
      runAflTradePrepareValuationPublicationCommand(
        { argv: ['--input', inputPath], env: {} },
        { readInput, connect: vi.fn(), writeOutput: vi.fn() }
      )
    ).rejects.toThrow('Invalid AFL trade valuation publication configuration');

    expect(readInput).not.toHaveBeenCalled();
  });

  it('closes PostgreSQL and object storage when preparation fails', async () => {
    const prepare = vi.fn().mockRejectedValue(new Error('custody readback failed'));
    const close = vi.fn().mockResolvedValue(undefined);
    const writeOutput = vi.fn();

    await expect(
      runAflTradePrepareValuationPublicationCommand(
        { argv: ['--input', inputPath], env: environment },
        {
          readInput: vi.fn().mockResolvedValue(command),
          connect: vi.fn().mockResolvedValue({ prepare, close }),
          writeOutput,
        }
      )
    ).rejects.toThrow('custody readback failed');

    expect(close).toHaveBeenCalledOnce();
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
