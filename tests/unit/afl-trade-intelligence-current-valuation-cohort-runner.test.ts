import { describe, expect, it, vi } from 'vitest';

import {
  createAflTradePrivateEvaluationCohortRunner,
  createAflTradePrivateEvaluationCohortRunOperationId,
} from '@/server/aflTradeIntelligence/valuation/currentValuationCohortRunner';
import { createAutomatedGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createGovernedPrivateEvaluationBatch } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';
import { createGovernedPrivateEvaluationMultiClubNarrativeFixture } from '../testUtils/governedPrivateEvaluationMultiClubFixture';

const digest = (character: string) => character.repeat(64);
const scopeKey = 'afl-men:2026-trades';

function capture(tradeIds: string[]) {
  return {
    scopeKey,
    preparedInputSetId: `prepared-valuation-input-set:${digest('1')}`,
    preparedInputSetRevision: 4,
    factualReleaseId: `outcome-release:${digest('2')}`,
    factualReleaseRevision: 3,
    modelQualificationId: `model-qualification:${digest('3')}`,
    modelQualificationWorkId: `model-qualification-work:${digest('4')}`,
    modelPairRevision: 5,
    expectedBatchRevision: 2,
    entries: tradeIds.map((tradeId) => ({ tradeId, state: 'ready' as const })),
    capturedAt: '2026-08-21T09:00:00.000Z',
  };
}

function requestFor(authority: ReturnType<typeof capture>) {
  return {
    scopeKey,
    operationId: createAflTradePrivateEvaluationCohortRunOperationId({
      scopeKey,
      preparedInputSetId: authority.preparedInputSetId,
      preparedInputSetRevision: authority.preparedInputSetRevision,
      modelQualificationWorkId: authority.modelQualificationWorkId,
      factualReleaseRevision: authority.factualReleaseRevision,
      modelPairRevision: authority.modelPairRevision,
      expectedBatchRevision: authority.expectedBatchRevision,
    }),
  };
}

describe('automatic private evaluation cohort runner', () => {
  it('leaves the batch unchanged while durable transient work is waiting for retry', async () => {
    const authority = capture(['trade-a', 'trade-b']);
    const registerBatch = vi.fn();
    const advanceBatch = vi.fn();
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async ({ selector }) =>
        selector.tradeId === 'trade-a'
          ? { state: 'retry_pending', availableAt: '2026-08-21T09:00:05.000Z' }
          : {
              state: 'activated',
              generationId: `local-private-trade-evaluation-generation:${digest('b')}`,
              generatedAt: '2026-08-21T09:01:00.000Z',
            },
      retainUnexpectedDiagnostics: vi.fn(),
      registerBatch,
      advanceBatch,
    });

    await expect(runner.run(requestFor(authority))).resolves.toEqual({
      state: 'retry_pending',
      pendingTradeIds: ['trade-a'],
    });
    expect(registerBatch).not.toHaveBeenCalled();
    expect(advanceBatch).not.toHaveBeenCalled();
  });

  it('enforces the versioned maximum concurrency', async () => {
    const authority = capture(
      Array.from({ length: 783 }, (_, index) =>
        `trade-${index.toString().padStart(3, '0')}`
      )
    );
    let active = 0;
    let observedMaximum = 0;
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async ({ selector }) => {
        active += 1;
        observedMaximum = Math.max(observedMaximum, active);
        await Promise.resolve();
        active -= 1;
        return {
          state: 'activated',
          generationId: `local-private-trade-evaluation-generation:${Number(
            selector.tradeId.slice('trade-'.length)
          )
            .toString(16)
            .padStart(64, '0')}`,
          generatedAt: '2026-08-21T09:01:00.000Z',
        };
      },
      retainUnexpectedDiagnostics: vi.fn(),
      registerBatch: async (batch) => batch,
      advanceBatch: async ({ batchId, expectedRevision }) => ({
        scopeKey,
        batchId,
        revision: expectedRevision + 1,
        transitionId: `private-evaluation-batch-transition:${digest('f')}`,
        activatedAt: '2026-08-21T09:01:00.000Z',
      }),
    });

    await expect(runner.run(requestFor(authority))).resolves.toMatchObject({
      state: 'activated',
    });
    expect(observedMaximum).toBe(8);
  });

  it('attempts every trade, retains unexpected diagnostics, and does not activate', async () => {
    const authority = capture(['trade-a', 'trade-b', 'trade-c', 'trade-d']);
    const attempted: string[] = [];
    const retainUnexpectedDiagnostics = vi.fn();
    const registerBatch = vi.fn();
    const advanceBatch = vi.fn();
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async ({ selector }) => {
        attempted.push(selector.tradeId);
        if (selector.tradeId === 'trade-b') throw new TypeError('retained ancestry mismatch');
        if (selector.tradeId === 'trade-c') {
          return {
            state: 'unavailable',
            blockers: [{ code: 'insufficient_data', message: 'No observations.' }],
          };
        }
        return {
          state: 'activated',
          generationId: `local-private-trade-evaluation-generation:${selector.tradeId === 'trade-a' ? digest('a') : digest('d')}`,
          generatedAt: '2026-08-21T09:01:00.000Z',
        };
      },
      retainUnexpectedDiagnostics,
      registerBatch,
      advanceBatch,
    });

    const result = await runner.run(requestFor(authority));

    expect(attempted.sort()).toEqual(['trade-a', 'trade-b', 'trade-c', 'trade-d']);
    expect(result).toMatchObject({
      state: 'unexpected_failure',
      diagnostics: [
        { tradeId: 'trade-b', name: 'TypeError', message: 'retained ancestry mismatch' },
      ],
    });
    expect(retainUnexpectedDiagnostics).toHaveBeenCalledOnce();
    expect(registerBatch).not.toHaveBeenCalled();
    expect(advanceBatch).not.toHaveBeenCalled();
  });

  it('retains unexpected diagnostics in locale-independent code-unit order', async () => {
    const authority = capture(['trade-Z', 'trade-a']);
    const retainUnexpectedDiagnostics = vi.fn(async ({ diagnostics }) => diagnostics);
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async ({ selector }) => {
        throw new Error(`Failure for ${selector.tradeId}.`);
      },
      retainUnexpectedDiagnostics,
      registerBatch: vi.fn(),
      advanceBatch: vi.fn(),
    });

    await expect(runner.run(requestFor(authority))).resolves.toMatchObject({
      state: 'unexpected_failure',
      diagnostics: [{ tradeId: 'trade-Z' }, { tradeId: 'trade-a' }],
    });
    expect(retainUnexpectedDiagnostics).toHaveBeenCalledOnce();
    expect(retainUnexpectedDiagnostics.mock.calls[0]?.[0]).toMatchObject({
      diagnostics: [{ tradeId: 'trade-Z' }, { tradeId: 'trade-a' }],
    });
  });

  it.each([2, 3, 4])(
    'constructs and atomically activates a deterministic %i-club example',
    async (clubCount) => {
      const narrative =
        clubCount === 2
          ? createGovernedPrivateEvaluationNarrativeFixture()
          : createGovernedPrivateEvaluationMultiClubNarrativeFixture(clubCount as 3 | 4);
      const authority = capture([narrative.content.tradeId]);
      const runner = createAflTradePrivateEvaluationCohortRunner({
        captureCurrent: async () => ({ capture: authority, currentBatch: null }),
        stageTrade: async ({ selector, operationId }) => {
          const materialization = createAutomatedGovernedPrivateEvaluationGeneration({
            selector,
            transitionIntentId: `private-evaluation-transition-intent:${operationId.slice(-64)}`,
            generatedAt: '2026-08-21T09:01:00.000Z',
            constructionAuthority: {
              kind: 'automated_private_calculation_agent',
              principalId: 'system:weekly-valuation-coordinator',
            },
            narrative,
          });
          return {
            state: 'activated',
            generationId: materialization.generation.generationId,
            generatedAt: materialization.generation.content.generatedAt,
          };
        },
        retainUnexpectedDiagnostics: async () => undefined,
        registerBatch: async (batch) => batch,
        advanceBatch: async ({ batchId, expectedRevision }) => ({
          scopeKey,
          batchId,
          revision: expectedRevision + 1,
          transitionId: `private-evaluation-batch-transition:${digest('f')}`,
          activatedAt: '2026-08-21T09:01:00.000Z',
        }),
      });

      const result = await runner.run(requestFor(authority));

      expect(result.state).toBe('activated');
      if (result.state !== 'activated') throw new Error('Expected activated batch.');
      expect(result.batch.content.tradeCount).toBe(1);
      expect(result.batch.content.createdAt).toBe('2026-08-21T09:01:00.000Z');
      expect(narrative.content.views[0]?.clubs).toHaveLength(clubCount);
      expect(result.transition.revision).toBe(3);
    }
  );

  it('returns already-current without staging or lifecycle work', async () => {
    const authority = capture(['trade-a']);
    const current = createGovernedPrivateEvaluationBatch({
      scopeKey: authority.scopeKey,
      preparedInputSetId: authority.preparedInputSetId,
      preparedInputSetRevision: authority.preparedInputSetRevision,
      factualReleaseId: authority.factualReleaseId,
      modelQualificationId: authority.modelQualificationId,
      modelQualificationWorkId: authority.modelQualificationWorkId,
      entries: [
        {
          tradeId: 'trade-a',
          state: 'ready',
          generationId: `local-private-trade-evaluation-generation:${digest('a')}`,
        },
      ],
      createdAt: authority.capturedAt,
    });
    const stageTrade = vi.fn();
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({
        capture: authority,
        currentBatch: {
          batch: current,
          head: {
            scopeKey,
            batchId: current.batchId,
            revision: authority.expectedBatchRevision,
            transitionId: `private-evaluation-batch-transition:${digest('b')}`,
            activatedAt: authority.capturedAt,
          },
          authority: {
            factualReleaseRevision: authority.factualReleaseRevision,
            modelPairRevision: authority.modelPairRevision,
          },
        },
      }),
      stageTrade,
      retainUnexpectedDiagnostics: async () => undefined,
      registerBatch: async (batch) => batch,
      advanceBatch: vi.fn(),
    });

    await expect(runner.run(requestFor(authority))).resolves.toMatchObject({
      state: 'already_current',
      batch: { batchId: current.batchId },
    });
    expect(stageTrade).not.toHaveBeenCalled();
  });

  it('does not relabel an unexpected current-connection repository defect as stale', async () => {
    const authority = capture(['trade-a']);
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async () => ({
        state: 'activated',
        generationId: `local-private-trade-evaluation-generation:${digest('a')}`,
        generatedAt: '2026-08-21T09:01:00.000Z',
      }),
      retainUnexpectedDiagnostics: async () => undefined,
      registerBatch: async () => {
        throw new Error('current connection was interrupted');
      },
      advanceBatch: vi.fn(),
    });

    await expect(runner.run(requestFor(authority))).rejects.toThrow(
      'current connection was interrupted'
    );
  });

  it('normalizes malformed thrown values into retainable diagnostics', async () => {
    const authority = capture(['trade-a']);
    const retainUnexpectedDiagnostics = vi.fn();
    const runner = createAflTradePrivateEvaluationCohortRunner({
      captureCurrent: async () => ({ capture: authority, currentBatch: null }),
      stageTrade: async () => {
        const malformed = new Error(`  ${'x'.repeat(5_000)}  `);
        malformed.name = '   ';
        throw malformed;
      },
      retainUnexpectedDiagnostics,
      registerBatch: vi.fn(),
      advanceBatch: vi.fn(),
    });

    await expect(runner.run(requestFor(authority))).resolves.toMatchObject({
      state: 'unexpected_failure',
      diagnostics: [{ name: 'Error', message: 'x'.repeat(4_000) }],
    });
    expect(retainUnexpectedDiagnostics).toHaveBeenCalledOnce();
  });
});
