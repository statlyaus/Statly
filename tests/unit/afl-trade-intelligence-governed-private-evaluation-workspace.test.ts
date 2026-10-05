import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createPrivateEvaluationAuthoritySnapshot,
  createPrivateEvaluationInspectionReceipt,
  type GovernedPrivateEvaluationSelector,
  type PrivateEvaluationExecutionStore,
  type PrivateEvaluationInspectionStore,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluationContracts';
import { createGovernedPrivateTradeEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/governedPrivateTradeEvaluation';

const selector: GovernedPrivateEvaluationSelector = {
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-sam-flanders',
};

const unreachableExecutionStore: PrivateEvaluationExecutionStore = {
  execute: vi.fn(async () => {
    throw new Error('Execution was not expected in this inspection test.');
  }),
};

function createWorkspace(inspectionStore: PrivateEvaluationInspectionStore) {
  return createGovernedPrivateTradeEvaluationWorkspace({
    inspectionStore,
    executionStore: unreachableExecutionStore,
  });
}

describe('governed private trade evaluation workspace', () => {
  it('returns every retained inspection blocker without accepting caller authority', async () => {
      const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
        selector,
        promotedWorkbookSha256: null,
        authoritySnapshotId: null,
        inspectedAt: '2026-08-18T01:00:00.000Z',
        validThrough: null,
        expectedHead: { generationId: null, revision: 0, status: 'absent' },
        observedDependencies: [],
        blockers: [
          {
            code: 'pick_model_run_not_authorized',
            authorityClass: 'model_run',
            classification: 'external_authority',
            assetId: 'asset-future-first-round-pick',
            message: 'No governed pick model run is currently authorized.',
            evidenceRefs: [],
          },
          {
            code: 'player_hpn_horizon_missing',
            authorityClass: 'player_horizon',
            classification: 'internal_evidence',
            assetId: 'asset-sam-flanders',
            message: 'A required completed player season is absent.',
            evidenceRefs: [],
          },
        ],
      });
    const capture = vi.fn(async () => inspectionReceipt.receiptId);
    const load = vi.fn(async (receiptId: string) =>
      receiptId === inspectionReceipt.receiptId ? inspectionReceipt : null
    );
    const workspace = createWorkspace({
        capture,
        load,
        loadAuthoritySnapshot: vi.fn(async () => null),
    });

    const result = await workspace.inspect(selector);

    expect(capture).toHaveBeenCalledWith(selector);
    expect(load).toHaveBeenCalledWith(inspectionReceipt.receiptId);
    expect(result).toMatchObject({
      state: 'unavailable',
      selector,
      blockers: [
        {
          code: 'pick_model_run_not_authorized',
          classification: 'external_authority',
          assetId: 'asset-future-first-round-pick',
        },
        {
          code: 'player_hpn_horizon_missing',
          classification: 'internal_evidence',
          assetId: 'asset-sam-flanders',
        },
      ],
    });
    expect(result.inspectionReceipt.receiptId).toMatch(
      /^private-evaluation-inspection:[a-f0-9]{64}$/u
    );
    expect('authority' in result).toBe(false);
    expect('reviewGuard' in result).toBe(false);
  });

  it('fails closed when a retained blocker is relabelled as external authority', async () => {
    const capture = vi.fn(async (requested: GovernedPrivateEvaluationSelector) =>
      createPrivateEvaluationInspectionReceipt({
        selector: requested,
        promotedWorkbookSha256: '8'.repeat(64),
        authoritySnapshotId: null,
        inspectedAt: '2026-08-18T01:00:00.000Z',
        validThrough: null,
        expectedHead: { generationId: null, revision: 0, status: 'absent' },
        observedDependencies: [],
        blockers: [
          {
            code: 'player_hpn_horizon_missing',
            authorityClass: 'player_horizon',
            classification: 'external_authority',
            assetId: 'asset-sam-flanders',
            message: 'A required completed player season is absent.',
            evidenceRefs: [],
          },
        ],
      })
    );
    const workspace = createWorkspace({
        capture,
        load: vi.fn(async () => null),
        loadAuthoritySnapshot: vi.fn(async () => null),
    });

    await expect(workspace.inspect(selector)).rejects.toThrow(
      'Inspection blocker classification does not match its registered code.'
    );
  });

  it('rejects caller-supplied workbook identity at the public selector boundary', async () => {
    const workspace = createWorkspace({
        capture: vi.fn(),
        load: vi.fn(),
        loadAuthoritySnapshot: vi.fn(),
    });

    await expect(
      workspace.inspect({
        ...selector,
        workbookSha256: '8'.repeat(64),
      } as GovernedPrivateEvaluationSelector)
    ).rejects.toThrow();
  });

  it('fails closed when the captured inspection was not exactly retained', async () => {
    const workspace = createWorkspace({
        capture: vi.fn(async () => `private-evaluation-inspection:${'a'.repeat(64)}`),
        load: vi.fn(async () => null),
        loadAuthoritySnapshot: vi.fn(async () => null),
    });

    await expect(workspace.inspect(selector)).rejects.toThrow(
      'Private evaluation inspection was not exactly retained.'
    );
  });

  it('does not return a ready guard without the exact retained authority snapshot', async () => {
    const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
      selector,
      promotedWorkbookSha256: '8'.repeat(64),
      authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
      inspectedAt: '2026-08-18T01:00:00.000Z',
      validThrough: '2026-08-18T01:05:00.000Z',
      expectedHead: { generationId: null, revision: 0, status: 'absent' },
      observedDependencies: [],
      blockers: [],
    });
    const workspace = createWorkspace({
        capture: vi.fn(async () => inspectionReceipt.receiptId),
        load: vi.fn(async () => inspectionReceipt),
        loadAuthoritySnapshot: vi.fn(async () => null),
    });

    await expect(workspace.inspect(selector)).rejects.toThrow(
      'Private evaluation authority snapshot was not exactly retained.'
    );
  });

  it('returns a ready guard only from a retained matching authority snapshot', async () => {
    const capturedAt = '2026-08-18T01:00:00.000Z';
    const validThrough = '2026-08-18T01:05:00.000Z';
    const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };
    const authoritySnapshot = createPrivateEvaluationAuthoritySnapshot({
      selector,
      promotedWorkbookSha256: '8'.repeat(64),
      capturedAt,
      validThrough,
      expectedHead,
      dependencies: [
        {
          role: 'confirmed_result',
          artifact: createAflTradeCanonicalJsonArtifactRef(
            { evidence: 'governed-confirmed-result' },
            capturedAt
          ),
        },
      ],
    });
    const inspectionReceipt = createPrivateEvaluationInspectionReceipt({
      selector,
      promotedWorkbookSha256: '8'.repeat(64),
      authoritySnapshotId: authoritySnapshot.snapshotId,
      inspectedAt: capturedAt,
      validThrough,
      expectedHead,
      observedDependencies: authoritySnapshot.content.dependencies,
      blockers: [],
    });
    const workspace = createWorkspace({
        capture: vi.fn(async () => inspectionReceipt.receiptId),
        load: vi.fn(async () => inspectionReceipt),
        loadAuthoritySnapshot: vi.fn(async () => authoritySnapshot),
    });

    await expect(workspace.inspect(selector)).resolves.toMatchObject({
      state: 'ready',
      reviewGuard: {
        authoritySnapshotId: authoritySnapshot.snapshotId,
        inspectionReceiptId: inspectionReceipt.receiptId,
        expectedHead,
        validThrough,
      },
    });
  });

  it('executes only a strict retained-review command and returns its authenticated outcome', async () => {
    const expectedHead = { generationId: null, revision: 0, status: 'absent' as const };
    const reviewGuard = {
      authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
      inspectionReceiptId: `private-evaluation-inspection:${'c'.repeat(64)}`,
      expectedHead,
      validThrough: '2026-08-18T01:05:00.000Z',
    };
    const generationId = `local-private-trade-evaluation-generation:${'d'.repeat(64)}`;
    const executionStore: PrivateEvaluationExecutionStore = {
      execute: vi.fn(async () => ({
        state: 'activated' as const,
        selector,
        generationId,
        head: { generationId, revision: 1, status: 'active' as const },
      })),
    };
    const workspace = createGovernedPrivateTradeEvaluationWorkspace({
      inspectionStore: {
        capture: vi.fn(),
        load: vi.fn(),
        loadAuthoritySnapshot: vi.fn(),
      },
      executionStore,
    });

    await expect(
      workspace.execute({
        kind: 'construct_and_activate',
        selector,
        expected: reviewGuard,
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Construct the reviewed private evaluation.',
        },
      })
    ).resolves.toEqual({
      state: 'activated',
      selector,
      generationId,
      head: { generationId, revision: 1, status: 'active' },
    });
    expect(executionStore.execute).toHaveBeenCalledWith({
      kind: 'construct_and_activate',
      selector,
      expected: reviewGuard,
      operator: {
        principalId: 'local-operator:robert',
        rationale: 'Construct the reviewed private evaluation.',
      },
    });
  });

  it.each(['authority', 'evidence', 'trustedNow', 'scores', 'generation'])(
    'rejects caller-supplied %s before execution',
    async forbiddenField => {
      const execute = vi.fn();
      const workspace = createGovernedPrivateTradeEvaluationWorkspace({
        inspectionStore: {
          capture: vi.fn(),
          load: vi.fn(),
          loadAuthoritySnapshot: vi.fn(),
        },
        executionStore: { execute },
      });

      await expect(
        workspace.execute({
          kind: 'construct_and_activate',
          selector,
          expected: {
            authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
            inspectionReceiptId: `private-evaluation-inspection:${'c'.repeat(64)}`,
            expectedHead: { generationId: null, revision: 0, status: 'absent' },
            validThrough: '2026-08-18T01:05:00.000Z',
          },
          operator: {
            principalId: 'local-operator:robert',
            rationale: 'Construct the reviewed private evaluation.',
          },
          [forbiddenField]: { callerControlled: true },
        } as never)
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it('fails closed when an execution result escapes the command selector', async () => {
    const workspace = createGovernedPrivateTradeEvaluationWorkspace({
      inspectionStore: {
        capture: vi.fn(),
        load: vi.fn(),
        loadAuthoritySnapshot: vi.fn(),
      },
      executionStore: {
        execute: vi.fn(async () => ({
          state: 'unavailable' as const,
          selector: { ...selector, tradeId: 'another-trade' },
          blockers: [
            {
              code: 'pick_forecast_unavailable',
              authorityClass: 'pick_forecast' as const,
              classification: 'internal_evidence' as const,
              assetId: 'asset-future-first-round-pick',
              message: 'The exact governed pick forecast is unavailable.',
              evidenceRefs: [],
            },
          ],
        })),
      },
    });

    await expect(
      workspace.execute({
        kind: 'construct_and_activate',
        selector,
        expected: {
          authoritySnapshotId: `private-evaluation-authority-snapshot:${'b'.repeat(64)}`,
          inspectionReceiptId: `private-evaluation-inspection:${'c'.repeat(64)}`,
          expectedHead: { generationId: null, revision: 0, status: 'absent' },
          validThrough: '2026-08-18T01:05:00.000Z',
        },
        operator: {
          principalId: 'local-operator:robert',
          rationale: 'Construct the reviewed private evaluation.',
        },
      })
    ).rejects.toThrow('The private evaluation execution escaped its selector.');
  });
});
