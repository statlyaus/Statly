import { describe, expect, it, vi } from 'vitest';

import { runRecordLocalAflTradePrivateReviewedEvaluationCommand } from '../../Scripts/dev/record-local-afl-trade-private-reviewed-evaluation';
import {
  createAflTradePrivateReviewedEvidenceBundle,
  createAflTradePrivateReviewedEvidenceEvaluationDecision,
} from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';

const digest = (character: string) => character.repeat(64);
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

const bundle = createAflTradePrivateReviewedEvidenceBundle({
  evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
  reviewSets: [
    {
      reviewSetId: digest('1'),
      reviewSetDecisionId: 'review-set-decision:historical',
      reviewerId: 'local-reviewer:historical',
      candidateCount: 48_769,
      decisionCount: 146_307,
      reviewSetArtifact: artifact('2'),
    },
    {
      reviewSetId: digest('3'),
      reviewSetDecisionId: 'review-set-decision:official',
      reviewerId: 'local-reviewer:official',
      candidateCount: 12,
      decisionCount: 36,
      reviewSetArtifact: artifact('4'),
    },
  ],
  sourceCaptures: [
    {
      captureId: 'capture:2021',
      provider: 'afl-tables',
      capabilityId: 'player-match-statistics',
      seasonYear: 2021,
      sourceArtifact: artifact('5'),
    },
  ],
  sourceRightsEvidenceRefs: [artifact('6'), artifact('7')],
  createdAt: '2026-08-16T02:00:00.000Z',
});

function retainedDecision(input: {
  status: 'authorized' | 'withdrawn';
  expectedCurrentDecisionId: string | null;
}) {
  return createAflTradePrivateReviewedEvidenceEvaluationDecision({
    status: input.status,
    valuationScopeKey: 'afl-men:2025-trades',
    evidenceBundle: bundle,
    evidenceBundleArtifact: artifact('8'),
    revision: input.expectedCurrentDecisionId === null ? 1 : 2,
    supersedesDecisionId: input.expectedCurrentDecisionId,
    reviewerId: 'local-reviewer:robert',
    rationale: 'Explicit private evaluation decision.',
    decidedAt: '2026-08-16T03:00:00.000Z',
  });
}

describe('record local private reviewed-evidence evaluation command', () => {
  it('records the narrow authority and reports exact evidence counts', async () => {
    const recordDecision = vi.fn(async (input) => retainedDecision(input));
    const loadBundleSummary = vi.fn(async () => ({
      candidateCount: 48_781,
      decisionCount: 146_343,
      sourceCaptureCount: 6,
      sourceRightsCount: 2,
    }));
    const close = vi.fn(async () => undefined);
    const writeOutput = vi.fn();

    await runRecordLocalAflTradePrivateReviewedEvaluationCommand(
      {
        argv: [
          '--scope',
          'afl-men:2025-trades',
          '--expected-current',
          'none',
          '--decision',
          'authorized',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Authorize exact retained evidence for private local calculations only.',
        ],
        env: environment,
      },
      {
        connect: async () => ({ recordDecision, loadBundleSummary, close }),
        writeOutput,
      }
    );

    expect(recordDecision).toHaveBeenCalledWith({
      status: 'authorized',
      valuationScopeKey: 'afl-men:2025-trades',
      expectedCurrentDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Authorize exact retained evidence for private local calculations only.',
    });
    expect(loadBundleSummary).toHaveBeenCalledWith(bundle.evidenceBundleId);
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(writeOutput.mock.calls[0]![0])).toMatchObject({
      mode: 'private_local_retained_reviewed_evidence_calculation_authority',
      evidenceKind: 'retained_private_review',
      candidateCount: 48_781,
      decisionCount: 146_343,
      sourceCaptureCount: 6,
      sourceRightsCount: 2,
      derivedCalculationAuthority: 'private_nonproduction_only',
      modelTrainingAuthority: 'none',
      publicDisplayAuthority: 'none',
      redistributionAuthority: 'none',
      productionAuthority: 'none',
      liveCaptureAuthority: 'none',
      factualReleaseAuthority: 'none',
      publicationAuthority: 'none',
    });
  });

  it('records withdrawal only against the exact expected current decision', async () => {
    const currentDecisionId = `private-reviewed-evidence-evaluation-decision:${digest('a')}`;
    const recordDecision = vi.fn(async (input) => retainedDecision(input));

    await runRecordLocalAflTradePrivateReviewedEvaluationCommand(
      {
        argv: [
          '--scope',
          'afl-men:2025-trades',
          '--expected-current',
          currentDecisionId,
          '--decision',
          'withdrawn',
          '--reviewer',
          'local-reviewer:robert',
          '--rationale',
          'Withdraw private calculation authority.',
        ],
        env: environment,
      },
      {
        connect: async () => ({
          recordDecision,
          loadBundleSummary: async () => ({
            candidateCount: 48_781,
            decisionCount: 146_343,
            sourceCaptureCount: 6,
            sourceRightsCount: 2,
          }),
          close: async () => undefined,
        }),
        writeOutput: vi.fn(),
      }
    );

    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'withdrawn',
        expectedCurrentDecisionId: currentDecisionId,
      })
    );
  });

  it('rejects a non-loopback or non-disposable database before connecting', async () => {
    const connect = vi.fn();
    await expect(
      runRecordLocalAflTradePrivateReviewedEvaluationCommand(
        {
          argv: [
            '--scope',
            'afl-men:2025-trades',
            '--expected-current',
            'none',
            '--decision',
            'authorized',
            '--reviewer',
            'local-reviewer:robert',
            '--rationale',
            'Attempt unsafe database.',
          ],
          env: {
            ...environment,
            AFL_OUTCOMES_DATABASE_URL: 'postgresql://example.com/statly_outcomes',
          },
        },
        { connect, writeOutput: vi.fn() }
      )
    ).rejects.toThrow(/loopback statly_outcomes_test/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
