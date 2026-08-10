import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalCanonicalPromotionReviewCommand } from '../../Scripts/record-external-canonical-promotion-review';

const candidateId = `external-reconciliation:${'c'.repeat(64)}`;
const authorityEvidenceId = `reviewer-authority-evidence:${'a'.repeat(64)}`;

function dependencies() {
  const repository = {
    loadCandidate: vi.fn(async () => ({ candidateId })),
    loadCurrentDecision: vi.fn(async () => null),
    persistDecision: vi.fn(),
  };
  return {
    repository,
    connect: vi.fn(async () => ({ repository, close: vi.fn(async () => undefined) })),
    readJson: vi.fn(async () => []),
    writeOutput: vi.fn(),
  };
}

const argv = [
  '--candidate',
  candidateId,
  '--draft-events',
  '/reviewed/draft-events.json',
  '--transaction-dates',
  '/reviewed/transaction-dates.json',
  '--decision',
  'approved',
  '--rationale',
  'Exact candidate reviewed.',
  '--authority-evidence',
  authorityEvidenceId,
  '--reviewer',
  'operator:canonical-promoter',
  '--decided-at',
  '2026-08-10T00:00:00.000Z',
];

describe('record external canonical promotion review command', () => {
  it('loads reviewed metadata and delegates through the repository boundary', async () => {
    const target = dependencies();
    target.repository.loadCandidate.mockRejectedValueOnce(new Error('sentinel'));

    await expect(
      runAflTradeExternalCanonicalPromotionReviewCommand(
        { argv, env: { AFL_OUTCOMES_DATABASE_URL: 'postgres://outcomes' } },
        target
      )
    ).rejects.toThrow('sentinel');
    expect(target.readJson).toHaveBeenCalledWith('/reviewed/draft-events.json');
    expect(target.readJson).toHaveBeenCalledWith('/reviewed/transaction-dates.json');
    expect(target.connect).toHaveBeenCalledWith('postgres://outcomes');
  });

  it('rejects incomplete arguments before connecting', async () => {
    const target = dependencies();

    await expect(
      runAflTradeExternalCanonicalPromotionReviewCommand(
        { argv: argv.slice(0, -2), env: { AFL_OUTCOMES_DATABASE_URL: 'postgres://outcomes' } },
        target
      )
    ).rejects.toThrow(/requires --candidate/i);
    expect(target.connect).not.toHaveBeenCalled();
  });

  it('requires the isolated outcomes database URL', async () => {
    const target = dependencies();

    await expect(
      runAflTradeExternalCanonicalPromotionReviewCommand({ argv, env: {} }, target)
    ).rejects.toThrow(/AFL_OUTCOMES_DATABASE_URL/i);
  });
});
