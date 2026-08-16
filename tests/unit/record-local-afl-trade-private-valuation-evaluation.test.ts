import { describe, expect, it, vi } from 'vitest';

import { runRecordLocalAflTradePrivateValuationEvaluationCommand } from '../../Scripts/dev/record-local-afl-trade-private-valuation-evaluation';
import { createAflTradePrivateValuationEvaluationDecision } from '@/server/aflTradeIntelligence/valuation/privateValuationEvaluationDecision';

const digest = (character: string) => character.repeat(64);
const factualReleaseId = `outcome-release:${digest('1')}`;
const environment = {
  AFL_OUTCOMES_DATABASE_URL:
    'postgresql://statly_test:statly_test@127.0.0.1:5432/statly_outcomes_test',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: digest('9'),
};

function artifact(character: string) {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt: '2026-08-16T01:00:00.000Z',
  };
}

function retainedDecision(input: {
  status: 'authorized' | 'withdrawn';
  expectedCurrentDecisionId: string | null;
}) {
  return createAflTradePrivateValuationEvaluationDecision({
    status: input.status,
    valuationScopeKey: 'afl-men:2025-trades',
    factualReleaseScopeKey: 'public-afl-draft-trade-outcomes',
    factualReleaseId,
    factualReleaseArtifact: artifact('2'),
    releaseMembershipArtifact: artifact('3'),
    sourceRightsEvidenceRefs: [artifact('4'), artifact('5')],
    revision: input.expectedCurrentDecisionId === null ? 1 : 2,
    supersedesDecisionId: input.expectedCurrentDecisionId,
    reviewerId: 'local-reviewer:robert',
    rationale: 'Explicit private evaluation decision.',
    decidedAt: '2026-08-16T02:00:00.000Z',
  });
}

describe('record local private valuation evaluation command', () => {
  it('records narrow authority for the runtime-authenticated active release', async () => {
    const resolveActiveRelease = vi.fn(async () => factualReleaseId);
    const recordDecision = vi.fn(async (input) => retainedDecision(input));
    const close = vi.fn(async () => undefined);
    const writeOutput = vi.fn();

    await runRecordLocalAflTradePrivateValuationEvaluationCommand(
      {
        argv: [
          '--scope',
          'afl-men:2025-trades',
          '--release-scope',
          'public-afl-draft-trade-outcomes',
          '--expected-current',
          'none',
          '--decision',
          'authorized',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Authorize private local calculations only.',
        ],
        env: environment,
      },
      {
        connect: async () => ({ resolveActiveRelease, recordDecision, close }),
        writeOutput,
      }
    );

    expect(resolveActiveRelease).toHaveBeenCalledWith('public-afl-draft-trade-outcomes');
    expect(recordDecision).toHaveBeenCalledWith({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      factualReleaseId,
      expectedCurrentDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Authorize private local calculations only.',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toMatchObject({
      mode: 'private_local_nonproduction_derived_calculation_authority',
      decision: 'authorized',
      sourceArtifactCount: 2,
      modelTrainingAuthority: 'none',
      publicDisplayAuthority: 'none',
      redistributionAuthority: 'none',
      productionAuthority: 'none',
      liveCaptureAuthority: 'none',
      publicationAuthority: 'none',
    });
  });

  it('records an explicit withdrawal against the expected current decision', async () => {
    const currentDecisionId = `private-valuation-evaluation-decision:${digest('6')}`;
    const recordDecision = vi.fn(async (input) => retainedDecision(input));

    await runRecordLocalAflTradePrivateValuationEvaluationCommand(
      {
        argv: [
          '--scope',
          'afl-men:2025-trades',
          '--release',
          factualReleaseId,
          '--expected-current',
          currentDecisionId,
          '--decision',
          'withdrawn',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Withdraw private local calculation authority.',
        ],
        env: environment,
      },
      {
        connect: async () => ({
          resolveActiveRelease: vi.fn(),
          recordDecision,
          close: async () => undefined,
        }),
        writeOutput: vi.fn(),
      }
    );

    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'withdrawn',
        factualReleaseId,
        expectedCurrentDecisionId: currentDecisionId,
      })
    );
  });

  it('rejects ambiguous release selection before connecting', async () => {
    const connect = vi.fn();

    await expect(
      runRecordLocalAflTradePrivateValuationEvaluationCommand(
        {
          argv: [
            '--scope',
            'afl-men:2025-trades',
            '--release',
            factualReleaseId,
            '--release-scope',
            'public-afl-draft-trade-outcomes',
            '--expected-current',
            'none',
            '--decision',
            'authorized',
            '--reviewer',
            'local-reviewer:robert',
            '--rationale',
            'Ambiguous release selection.',
          ],
          env: environment,
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/exactly one/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
