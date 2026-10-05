import { describe, expect, it } from 'vitest';

import {
  createPrivateEvaluationTransitionIntent,
  createPrivateEvaluationTransitionReceipt,
  privateEvaluationTransitionIntentSchema,
  privateEvaluationTransitionReceiptSchema,
} from '@/server/aflTradeIntelligence/valuation/privateEvaluationTransitionContracts';

const selector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
};
const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };
const authoritySnapshotId = `private-evaluation-authority-snapshot:${'a'.repeat(64)}`;
const inspectionReceiptId = `private-evaluation-inspection:${'b'.repeat(64)}`;
const generationId = `local-private-trade-evaluation-generation:${'c'.repeat(64)}`;

describe('private evaluation transition contracts', () => {
  it('precomputes an activation intent without a generation reference, then binds both in a receipt', () => {
    const intent = createPrivateEvaluationTransitionIntent({
      action: 'construct_and_activate',
      selector,
      expectedHead,
      targetGenerationId: null,
      authoritySnapshotId,
      inspectionReceiptId,
      reason: null,
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Construct the reviewed private evaluation.',
      },
      requestedAt: '2026-08-18T01:00:00.000Z',
    });

    expect(intent.intentId).toMatch(/^private-evaluation-transition-intent:[a-f0-9]{64}$/u);
    expect(intent.content).not.toHaveProperty('generationId');
    expect(intent.content).toMatchObject({
      action: 'construct_and_activate',
      authoritySnapshotId,
      inspectionReceiptId,
      targetGenerationId: null,
      expectedHead,
    });

    const receipt = createPrivateEvaluationTransitionReceipt({
      intent,
      previousReceiptId: null,
      generationId,
      authoritySnapshotId,
      fromHead: expectedHead,
      toHead: { generationId, revision: 1, status: 'active' },
      changedAt: '2026-08-18T01:03:00.000Z',
    });

    expect(receipt.receiptId).toMatch(/^private-evaluation-transition-receipt:[a-f0-9]{64}$/u);
    expect(receipt.content).toMatchObject({
      intentId: intent.intentId,
      action: 'construct_and_activate',
      generationId,
      authoritySnapshotId,
      fromHead: expectedHead,
      toHead: { generationId, revision: 1, status: 'active' },
    });
  });

  it('rejects caller-shaped extra fields and incomplete authority binding', () => {
    expect(() =>
      privateEvaluationTransitionIntentSchema.parse({
        intentId: `private-evaluation-transition-intent:${'d'.repeat(64)}`,
        content: {
          callerAuthority: true,
        },
      })
    ).toThrow();

    expect(() =>
      createPrivateEvaluationTransitionIntent({
        action: 'construct_and_activate',
        selector,
        expectedHead,
        targetGenerationId: null,
        authoritySnapshotId: null,
        inspectionReceiptId,
        reason: null,
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Construct the reviewed private evaluation.',
        },
        requestedAt: '2026-08-18T01:00:00.000Z',
      })
    ).toThrow(/authority snapshot/i);
  });

  it('rejects a receipt whose head, generation, revision, or chronology does not reconcile', () => {
    const intent = createPrivateEvaluationTransitionIntent({
      action: 'construct_and_activate',
      selector,
      expectedHead,
      targetGenerationId: null,
      authoritySnapshotId,
      inspectionReceiptId,
      reason: null,
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Construct the reviewed private evaluation.',
      },
      requestedAt: '2026-08-18T01:00:00.000Z',
    });

    expect(() =>
      createPrivateEvaluationTransitionReceipt({
        intent,
        previousReceiptId: null,
        generationId,
        authoritySnapshotId,
        fromHead: expectedHead,
        toHead: { generationId, revision: 2, status: 'active' },
        changedAt: '2026-08-18T00:59:59.000Z',
      })
    ).toThrow();
  });

  it('requires withdrawal to remove the head and retain an operator reason', () => {
    const activeHead = { generationId, revision: 4, status: 'active' as const };
    const intent = createPrivateEvaluationTransitionIntent({
      action: 'withdraw',
      selector,
      expectedHead: activeHead,
      targetGenerationId: null,
      authoritySnapshotId: null,
      inspectionReceiptId: null,
      reason: 'Withdraw after evidence authority was superseded.',
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Remove the generation from current private reads.',
      },
      requestedAt: '2026-08-18T01:00:00.000Z',
    });
    const receipt = createPrivateEvaluationTransitionReceipt({
      intent,
      previousReceiptId: `private-evaluation-transition-receipt:${'e'.repeat(64)}`,
      generationId: null,
      authoritySnapshotId: null,
      fromHead: activeHead,
      toHead: { generationId: null, revision: 5, status: 'withdrawn' },
      changedAt: '2026-08-18T01:01:00.000Z',
    });

    expect(privateEvaluationTransitionReceiptSchema.parse(receipt)).toEqual(receipt);
  });
});
