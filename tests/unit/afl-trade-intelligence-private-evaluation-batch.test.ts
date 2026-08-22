import { describe, expect, it } from 'vitest';

import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchRollback,
  createGovernedPrivateEvaluationBatchWithdrawal,
} from '../../src/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';

const id = (kind: string, character: string) => `${kind}:${character.repeat(64)}`;

function batch() {
  return createGovernedPrivateEvaluationBatch({
    scopeKey: 'afl-men:2026:trades',
    preparedInputSetId: id('prepared-valuation-input-set', 'a'),
    preparedInputSetRevision: 4,
    factualReleaseId: id('outcome-release', 'b'),
    modelQualificationId: id('model-qualification', 'c'),
    modelQualificationWorkId: id('model-qualification-work', 'd'),
    entries: [
      {
        tradeId: 'trade-1',
        state: 'ready',
        generationId: id('local-private-trade-evaluation-generation', 'e'),
      },
      {
        tradeId: 'trade-2',
        state: 'unavailable',
        blockers: [{ code: 'insufficient_data', message: 'No complete observation set.' }],
      },
    ],
    createdAt: '2026-08-21T09:00:00.000Z',
  });
}

describe('governed private evaluation batch', () => {
  it('creates one exhaustive publication-prohibited batch', () => {
    const retained = batch();

    expect(retained.content.tradeCount).toBe(2);
    expect(retained.content.readyCount).toBe(1);
    expect(retained.content.unavailableCount).toBe(1);
    expect(retained.content.publicationEligible).toBe(false);
  });

  it('rejects duplicate, unsorted, or miscounted membership', () => {
    const retained = batch();

    expect(() =>
      createGovernedPrivateEvaluationBatch({
        ...retained.content,
        entries: [retained.content.entries[1]!, retained.content.entries[0]!],
      })
    ).toThrow(/canonically ordered/);
  });

  it('binds an emergency withdrawal to the exact batch, trade, and generation', () => {
    const retained = batch();
    const withdrawal = createGovernedPrivateEvaluationBatchWithdrawal({
      scopeKey: retained.content.scopeKey,
      batchId: retained.batchId,
      tradeId: 'trade-1',
      generationId: id('local-private-trade-evaluation-generation', 'e'),
      principalId: 'operator:fixture',
      reason: 'Emergency integrity withdrawal.',
      withdrawnAt: '2026-08-21T09:05:00.000Z',
    });

    expect(withdrawal.content.publicationEligible).toBe(false);
    expect(withdrawal.content.batchId).toBe(retained.batchId);
  });

  it('binds emergency rollback to governed operator evidence and an exact 15-minute window', () => {
    const from = batch();
    const to = createGovernedPrivateEvaluationBatch({
      ...from.content,
      createdAt: '2026-08-21T09:01:00.000Z',
    });
    const rollback = createGovernedPrivateEvaluationBatchRollback({
      scopeKey: from.content.scopeKey,
      fromBatchId: from.batchId,
      toBatchId: to.batchId,
      expectedRevision: 2,
      principalId: 'operator:fixture',
      authorityEvidenceId: id('reviewer-authority-evidence', 'f'),
      reason: 'Restore the last authenticated complete batch after an integrity incident.',
      authorizedAt: '2026-08-21T09:05:00.000Z',
      expiresAt: '2026-08-21T09:20:00.000Z',
    });

    expect(rollback.operationId).toMatch(/^private-evaluation-batch-operation:/u);
    expect(rollback.content).toMatchObject({
      environment: 'non_production',
      fromBatchId: from.batchId,
      toBatchId: to.batchId,
      authorityEvidenceId: id('reviewer-authority-evidence', 'f'),
      publicationEligible: false,
    });
    expect(() =>
      createGovernedPrivateEvaluationBatchRollback({
        ...rollback.content,
        expiresAt: '2026-08-21T09:20:00.001Z',
      })
    ).toThrow(/15-minute/i);
  });
});
