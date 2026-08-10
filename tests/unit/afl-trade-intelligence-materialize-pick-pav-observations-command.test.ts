import { describe, expect, it, vi } from 'vitest';

import { runAflTradeMaterializePickPavObservationsCommand } from '../../Scripts/materialize-pick-pav-observations';

const RELEASE_ID = `outcome-release:${'1'.repeat(64)}`;
const POLICY_ID = `pick-pav-policy:${'2'.repeat(64)}`;
const OBSERVATION_SET_ID = `pick-pav-observation-set:${'3'.repeat(64)}`;
const KNOWLEDGE_CUTOFF_AT = '2026-08-10T10:15:00.000Z';

const summary = {
  environment: 'production' as const,
  competition: 'AFLM' as const,
  releaseId: RELEASE_ID,
  policyId: POLICY_ID,
  knowledgeCutoffAt: KNOWLEDGE_CUTOFF_AT,
  observationSetId: OBSERVATION_SET_ID,
  observationCount: 1_274,
  draftClassCount: 18,
  calculationCount: 22,
  idempotentReplay: false,
};

describe('materialize pick-PAV observations command', () => {
  it('materializes one exact production release and prints only its immutable summary', async () => {
    const materialize = vi.fn().mockResolvedValue(summary);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ materialize, close });
    const writeOutput = vi.fn();

    const result = await runAflTradeMaterializePickPavObservationsCommand(
      {
        argv: [
          '--environment',
          'production',
          '--release-id',
          RELEASE_ID,
          '--policy-id',
          POLICY_ID,
          '--knowledge-cutoff-at',
          KNOWLEDGE_CUTOFF_AT,
        ],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
      },
      { connect, writeOutput }
    );

    expect(connect).toHaveBeenCalledWith('postgresql://outcomes.example/statly');
    expect(materialize).toHaveBeenCalledWith({
      environment: 'production',
      competition: 'AFLM',
      releaseId: RELEASE_ID,
      policyId: POLICY_ID,
      knowledgeCutoffAt: KNOWLEDGE_CUTOFF_AT,
    });
    expect(writeOutput).toHaveBeenCalledWith(JSON.stringify(summary));
    expect(close).toHaveBeenCalledOnce();
    expect(result).toEqual(summary);
  });

  it('reports an exact idempotent replay without creating another observation set', async () => {
    const replay = { ...summary, idempotentReplay: true };
    const materialize = vi.fn().mockResolvedValue(replay);
    const close = vi.fn().mockResolvedValue(undefined);

    const result = await runAflTradeMaterializePickPavObservationsCommand(
      {
        argv: [
          '--environment',
          'production',
          '--release-id',
          RELEASE_ID,
          '--policy-id',
          POLICY_ID,
          '--knowledge-cutoff-at',
          KNOWLEDGE_CUTOFF_AT,
        ],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
      },
      { connect: vi.fn().mockResolvedValue({ materialize, close }), writeOutput: vi.fn() }
    );

    expect(result.idempotentReplay).toBe(true);
    expect(materialize).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects malformed scope before opening PostgreSQL', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeMaterializePickPavObservationsCommand(
        {
          argv: [
            '--environment',
            'production',
            '--release-id',
            'outcome-release:not-a-digest',
            '--policy-id',
            POLICY_ID,
            '--knowledge-cutoff-at',
            KNOWLEDGE_CUTOFF_AT,
          ],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow();

    expect(connect).not.toHaveBeenCalled();
  });

  it('closes PostgreSQL when materialization fails', async () => {
    const materialize = vi.fn().mockRejectedValue(new Error('authority withdrawn'));
    const close = vi.fn().mockResolvedValue(undefined);

    await expect(
      runAflTradeMaterializePickPavObservationsCommand(
        {
          argv: [
            '--environment',
            'non_production',
            '--release-id',
            RELEASE_ID,
            '--policy-id',
            POLICY_ID,
            '--knowledge-cutoff-at',
            KNOWLEDGE_CUTOFF_AT,
          ],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
        },
        {
          connect: vi.fn().mockResolvedValue({ materialize, close }),
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow('authority withdrawn');

    expect(close).toHaveBeenCalledOnce();
  });
});
