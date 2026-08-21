import { describe, expect, it } from 'vitest';

import { createAflTradeCurrentValuationRefresh } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const operationId = `current-valuation-refresh-operation:${'a'.repeat(64)}`;

describe('current valuation refresh', () => {
  it('returns the exact retained no-change result through one backend operation', async () => {
    const refresh = createAflTradeCurrentValuationRefresh({
      retainNoChange: async () => ({
        schemaVersion: 'afl-current-valuation-refresh-result-v1',
        operationId,
        scopeKey: 'afl-men:2026-trades',
        trigger: 'ad_hoc',
        stableOperationKey: 'weekly-data-check-2026-08-24',
        state: 'no_change',
        capturedAuthority: {
          factualReleaseScopeKey: 'afl-men:2026',
          factualReleaseId: `outcome-release:${'b'.repeat(64)}`,
          factualReleaseRevision: 9,
          modelQualificationId: `model-qualification:${'c'.repeat(64)}`,
          modelQualificationWorkId: `model-qualification-work:${'d'.repeat(64)}`,
          modelPairRevision: 4,
          preparedInputSetId: `prepared-valuation-input-set:${'e'.repeat(64)}`,
          preparedInputSetRevision: 7,
          privateBatchId: `private-evaluation-batch:${'f'.repeat(64)}`,
          privateBatchRevision: 3,
          privateBatchTransitionId: `private-evaluation-batch-transition:${'1'.repeat(64)}`,
        },
        capturedAt: '2026-08-21T08:00:00.000Z',
        completedAt: '2026-08-21T08:00:00.000Z',
        environment: 'non_production',
        publicationEligible: false,
        limitation:
          'No factual, model, prepared-input, private-evaluation, or publication authority is granted.',
      }),
    });

    await expect(
      refresh.refreshCurrent({
        scopeKey: 'afl-men:2026-trades',
        trigger: 'ad_hoc',
        stableOperationKey: 'weekly-data-check-2026-08-24',
      })
    ).resolves.toEqual({
      schemaVersion: 'afl-current-valuation-refresh-result-v1',
      operationId,
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc',
      stableOperationKey: 'weekly-data-check-2026-08-24',
      state: 'no_change',
      capturedAuthority: {
        factualReleaseScopeKey: 'afl-men:2026',
        factualReleaseId: `outcome-release:${'b'.repeat(64)}`,
        factualReleaseRevision: 9,
        modelQualificationId: `model-qualification:${'c'.repeat(64)}`,
        modelQualificationWorkId: `model-qualification-work:${'d'.repeat(64)}`,
        modelPairRevision: 4,
        preparedInputSetId: `prepared-valuation-input-set:${'e'.repeat(64)}`,
        preparedInputSetRevision: 7,
        privateBatchId: `private-evaluation-batch:${'f'.repeat(64)}`,
        privateBatchRevision: 3,
        privateBatchTransitionId: `private-evaluation-batch-transition:${'1'.repeat(64)}`,
      },
      capturedAt: '2026-08-21T08:00:00.000Z',
      completedAt: '2026-08-21T08:00:00.000Z',
      environment: 'non_production',
      publicationEligible: false,
      limitation:
        'No factual, model, prepared-input, private-evaluation, or publication authority is granted.',
    });
  });
});
