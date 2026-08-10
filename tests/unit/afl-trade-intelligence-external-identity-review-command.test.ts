import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExportExternalIdentityReviewQueueCommand } from '../../Scripts/export-external-identity-review-queue';
import { runAflTradeRecordExternalIdentityResolutionCommand } from '../../Scripts/record-external-identity-resolution';

const sha = (character: string) => character.repeat(64);
const completionId = `external-historical-capture-completion:${sha('1')}`;
const subjectId = `external-identity-subject:${sha('2')}`;
const authorityEvidenceId = `reviewer-authority-evidence:${sha('3')}`;

describe('external identity review operator commands', () => {
  it('exports the deterministic review queue for one historical completion', async () => {
    const close = vi.fn(async () => undefined);
    const loadQueue = vi.fn(async () => ({
      completionId,
      reviewPackageId: `external-identity-review-package:${sha('4')}`,
      items: [],
      unresolvedCount: 0,
      promotionEligible: false as const,
      publicationEligible: false as const,
      reviewPackage: null as never,
    }));
    const output: string[] = [];

    const result = await runAflTradeExportExternalIdentityReviewQueueCommand(
      {
        argv: ['--completion', completionId],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
      },
      {
        connect: async () => ({ loadQueue, close }),
        writeOutput: (line) => output.push(line),
      }
    );

    expect(loadQueue).toHaveBeenCalledWith({ completionId });
    expect(result.unresolvedCount).toBe(0);
    expect(JSON.parse(output[0]!)).toEqual(result);
    expect(close).toHaveBeenCalledOnce();
  });

  it('records only operator intent and derives the decision timestamp from the command clock', async () => {
    const close = vi.fn(async () => undefined);
    const recordDecision = vi.fn(async () => ({
      subjectId,
      decisionId: `review-decision:${sha('5')}`,
      revision: 2,
      status: 'approved' as const,
      idempotentReplay: false,
    }));
    const output: string[] = [];

    const result = await runAflTradeRecordExternalIdentityResolutionCommand(
      {
        argv: [
          '--completion',
          completionId,
          '--subject',
          subjectId,
          '--decision',
          'approved',
          '--canonical-id',
          'player:harry-kyle',
          '--reviewer',
          'reviewer:fixture',
          '--authority-evidence',
          authorityEvidenceId,
          '--rationale',
          'Matched to the approved official player record.',
        ],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
      },
      {
        connect: async () => ({ recordDecision, close }),
        now: () => new Date('2026-08-10T00:00:00.000Z'),
        writeOutput: (line) => output.push(line),
      }
    );

    expect(recordDecision).toHaveBeenCalledWith({
      completionId,
      subjectId,
      decision: 'approved',
      canonicalId: 'player:harry-kyle',
      rationale: 'Matched to the approved official player record.',
      authorityEvidenceId,
      decidedBy: 'reviewer:fixture',
      decidedAt: '2026-08-10T00:00:00.000Z',
    });
    expect(result.revision).toBe(2);
    expect(JSON.parse(output[0]!)).toEqual(result);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an approval without a canonical target before opening PostgreSQL', async () => {
    const connect = vi.fn();

    await expect(
      runAflTradeRecordExternalIdentityResolutionCommand(
        {
          argv: [
            '--completion',
            completionId,
            '--subject',
            subjectId,
            '--decision',
            'approved',
            '--reviewer',
            'reviewer:fixture',
            '--authority-evidence',
            authorityEvidenceId,
            '--rationale',
            'Missing target must fail.',
          ],
          env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture' },
        },
        {
          connect,
          now: () => new Date('2026-08-10T00:00:00.000Z'),
          writeOutput: () => undefined,
        }
      )
    ).rejects.toThrow('canonical-id');
    expect(connect).not.toHaveBeenCalled();
  });
});
