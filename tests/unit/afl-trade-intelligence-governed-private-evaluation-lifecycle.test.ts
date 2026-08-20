import {
  createGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionReceipt,
  governedPrivateEvaluationTransitionIntentSchema,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';

const selector = {
  valuationScopeKey: 'afl-trade-history:current',
  tradeId: 'trade:three-club:1',
};
const inspectionId = `private-evaluation-inspection:${'a'.repeat(64)}`;
const generationOne = `local-private-trade-evaluation-generation:${'b'.repeat(64)}`;
const generationTwo = `local-private-trade-evaluation-generation:${'c'.repeat(64)}`;
const authoritySnapshotId = `private-evaluation-authority-snapshot:${'d'.repeat(64)}`;
const operationId = (character: string) => `private-evaluation-operation:${character.repeat(64)}`;
const review = {
  principalId: 'firebase:operator-1',
  rationale: 'Apply the reviewed private test-fixture lifecycle transition.',
};

function intent(input: {
  action:
    | { kind: 'construct_and_activate' }
    | { kind: 'withdraw'; reason: string }
    | { kind: 'rollback'; targetGenerationId: string }
    | { kind: 'recover' };
  expectedHead: {
    status: 'absent' | 'active' | 'withdrawn';
    revision: number;
    generationId: string | null;
  };
  operationCharacter: string;
}) {
  return createGovernedPrivateEvaluationTransitionIntent({
    selector,
    inspectionId,
    authoritySnapshotId:
      input.action.kind === 'withdraw' ? null : authoritySnapshotId,
    operationId: operationId(input.operationCharacter),
    action: input.action,
    expectedHead: input.expectedHead,
    review,
    requestedAt: '2026-08-19T10:00:00.000Z',
    expiresAt: '2026-08-19T10:05:00.000Z',
  });
}

describe('governed private evaluation lifecycle', () => {
  it('constructs, withdraws, and recovers one exact generation', () => {
    const activationIntent = intent({
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      operationCharacter: '1',
    });
    const activation = createGovernedPrivateEvaluationTransitionReceipt({
      intent: activationIntent,
      previousTransitionId: null,
      toGenerationId: generationOne,
      transitionedAt: '2026-08-19T10:01:00.000Z',
    });
    expect(activation.content.toHead).toEqual({
      status: 'active',
      revision: 1,
      generationId: generationOne,
    });

    const withdrawalIntent = intent({
      action: { kind: 'withdraw', reason: 'Operator safety withdrawal.' },
      expectedHead: activation.content.toHead,
      operationCharacter: '2',
    });
    const withdrawal = createGovernedPrivateEvaluationTransitionReceipt({
      intent: withdrawalIntent,
      previousTransitionId: activation.transitionId,
      toGenerationId: null,
      transitionedAt: '2026-08-19T10:02:00.000Z',
    });
    expect(withdrawal.content.toHead).toEqual({
      status: 'withdrawn',
      revision: 2,
      generationId: null,
    });

    const recoveryIntent = intent({
      action: { kind: 'recover' },
      expectedHead: withdrawal.content.toHead,
      operationCharacter: '3',
    });
    const recovery = createGovernedPrivateEvaluationTransitionReceipt({
      intent: recoveryIntent,
      previousTransitionId: withdrawal.transitionId,
      toGenerationId: generationOne,
      transitionedAt: '2026-08-19T10:03:00.000Z',
    });
    expect(recovery.content.toHead).toEqual({
      status: 'active',
      revision: 3,
      generationId: generationOne,
    });
  });

  it('rolls an active head back to one exact previously active generation', () => {
    const rollbackIntent = intent({
      action: { kind: 'rollback', targetGenerationId: generationOne },
      expectedHead: { status: 'active', revision: 2, generationId: generationTwo },
      operationCharacter: '4',
    });
    const rollback = createGovernedPrivateEvaluationTransitionReceipt({
      intent: rollbackIntent,
      previousTransitionId: `private-evaluation-transition:${'e'.repeat(64)}`,
      toGenerationId: generationOne,
      transitionedAt: '2026-08-19T10:01:00.000Z',
    });

    expect(rollback.content.toHead).toEqual({
      status: 'active',
      revision: 3,
      generationId: generationOne,
    });
  });

  it('rejects illegal state changes, expiry, and content-address tampering', () => {
    expect(() =>
      intent({
        action: { kind: 'recover' },
        expectedHead: { status: 'active', revision: 1, generationId: generationOne },
        operationCharacter: '5',
      })
    ).toThrow();

    const withdrawalIntent = intent({
      action: { kind: 'withdraw', reason: 'Operator safety withdrawal.' },
      expectedHead: { status: 'active', revision: 1, generationId: generationOne },
      operationCharacter: '6',
    });
    expect(() =>
      createGovernedPrivateEvaluationTransitionReceipt({
        intent: withdrawalIntent,
        previousTransitionId: `private-evaluation-transition:${'f'.repeat(64)}`,
        toGenerationId: null,
        transitionedAt: '2026-08-19T10:06:00.000Z',
      })
    ).toThrow();

    expect(() =>
      governedPrivateEvaluationTransitionIntentSchema.parse({
        ...withdrawalIntent,
        content: {
          ...withdrawalIntent.content,
          selector: { ...selector, tradeId: 'trade:escaped' },
        },
      })
    ).toThrow();
  });
});
