import { describe, expect, it, vi } from 'vitest';

import { runAflTradePrepareFactualPublicationCommand } from '../../Scripts/prepare-afl-trade-factual-publication';

const AS_OF = '2026-08-10T10:15:00.000Z';

const prepared = {
  environment: 'production' as const,
  competition: 'AFLM',
  asOf: AS_OF,
  corpus: {
    corpusId: `corpus:${'1'.repeat(64)}`,
    status: 'finalized' as const,
    idempotentReplay: false,
    promotionCount: 2,
    memberCount: 15,
    memberSetSha256: '2'.repeat(64),
  },
  preparation: {
    status: 'awaiting_gate_2_review' as const,
    publicationEligible: false as const,
    corpusId: `corpus:${'1'.repeat(64)}`,
    releaseId: `outcome-release:${'3'.repeat(64)}`,
    factualCandidateId: `factual-release-candidate:${'4'.repeat(64)}`,
    lineageId: `corpus-factual-lineage:${'5'.repeat(64)}`,
    publicArchiveId: `afl-trade-public-archive:${'6'.repeat(64)}`,
    projectionId: `afl-trade-factual-projection:${'7'.repeat(64)}`,
    gate2DecisionKey: `gate2:corpus-factual-lineage:${'5'.repeat(64)}`,
    gate2AffectedArtifacts: [],
    canonicalMemberCount: 15,
    publicRecordCount: 15,
    idempotentReplay: false,
  },
};

describe('prepare AFL trade factual publication command', () => {
  it('prepares a production corpus and factual release without approving or activating it', async () => {
    const prepare = vi.fn().mockResolvedValue(prepared);
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue({ prepare, close });
    const writeOutput = vi.fn();

    const result = await runAflTradePrepareFactualPublicationCommand(
      {
        argv: ['--competition', 'AFLM', '--as-of', AS_OF],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
      },
      { connect, writeOutput }
    );

    expect(connect).toHaveBeenCalledWith('postgresql://outcomes.example/statly');
    expect(prepare).toHaveBeenCalledWith({ competition: 'AFLM', asOf: AS_OF });
    expect(writeOutput).toHaveBeenCalledWith(JSON.stringify(prepared));
    expect(close).toHaveBeenCalledOnce();
    expect(result.preparation).toMatchObject({
      status: 'awaiting_gate_2_review',
      publicationEligible: false,
    });
  });

  it('rejects malformed input before opening PostgreSQL', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradePrepareFactualPublicationCommand(
        {
          argv: ['--competition', 'AFLM', '--as-of', '2026-08-10'],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://outcomes.example/statly' },
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow();

    expect(connect).not.toHaveBeenCalled();
  });
});
