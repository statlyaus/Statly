import { describe, expect, it, vi } from 'vitest';

import { createAflTradePrivateValuationCaptureBinding } from '@/server/aflTradeIntelligence/valuation/privateValuationCaptureBinding';
import { createAflTradePrivateValuationRawDataCoordinator } from '@/server/aflTradeIntelligence/valuation/privateValuationRawDataCoordinator';

const sha = (character: string) => character.repeat(64);
const request = {
  requestId: `private-valuation-dispatch:${sha('1')}`,
  scopeKey: 'afl-men:2026-trades',
  trigger: 'weekly' as const,
  scheduledFor: '2026-08-24T09:00:00.000Z',
  authorityKey: 'weekly:2026-08-24T09:00:00.000Z',
};
const claim = {
  claimId: `private-valuation-dispatch-claim:${sha('2')}`,
  leaseToken: sha('3'),
};

function bindingFor(boundRequest: typeof request, normalizationCharacter = '8') {
  return createAflTradePrivateValuationCaptureBinding({
    request: boundRequest,
    dispatchClaimId: claim.claimId,
    attemptSequence: 1,
    attemptNumber: 1,
    sourcePlan: {
      provider: 'fitzRoy',
      dataset: 'AFL Tables player statistics',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      seasonYear: 2026,
      fieldMapId: 'afl-tables-player-stats-2026-v1',
      gate0AReceiptId: `gate0a-evaluation:${sha('a')}`,
    },
    sourceCaptureAttemptId: `source-capture-attempt:${sha('4')}`,
    captureReceiptId: `fitzroy-capture:${sha('5')}`,
    snapshotId: `source-snapshot:${sha('6')}`,
    sourceCaptureId: `source-capture:${sha('7')}`,
    normalizationRunId: `provider-normalization-run:${sha(normalizationCharacter)}`,
    acceptedAt: '2026-08-24T09:01:00.000Z',
  });
}

describe('private valuation raw-data coordinator', () => {
  it('loads the exact accepted capture before attempting provider work', async () => {
    const retained = bindingFor(request);
    const load = vi.fn(async () => retained);
    const capture = vi.fn();
    const accept = vi.fn();
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: { load, accept },
      capture,
    });

    await expect(coordinator.run({ request, claim })).resolves.toEqual({
      state: 'capture_accepted',
      requestId: request.requestId,
      binding: retained,
      idempotentReplay: true,
    });
    expect(load).toHaveBeenCalledWith(request, 'factual_input');
    expect(capture).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it('accepts one newly captured result through the live claim fence', async () => {
    const candidate = bindingFor(request);
    const load = vi.fn(async () => null);
    const capture = vi.fn(async () => ({
      normalizationRunId: candidate.content.normalizationRunId,
    }));
    const accept = vi.fn(async () => candidate);
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: { load, accept },
      capture,
    });

    await expect(coordinator.run({ request, claim })).resolves.toMatchObject({
      state: 'capture_accepted',
      requestId: request.requestId,
      binding: candidate,
      idempotentReplay: false,
    });
    expect(capture).toHaveBeenCalledWith({ request, claim, sourceRole: 'factual_input' });
    expect(accept).toHaveBeenCalledWith({
      request,
      claim,
      sourceRole: 'factual_input',
      normalizationRunId: candidate.content.normalizationRunId,
    });
  });

  it('rejects retained custody belonging to another dispatch before provider work', async () => {
    const conflictingRequest = {
      ...request,
      requestId: `private-valuation-dispatch:${sha('a')}`,
      authorityKey: 'another-operation',
    };
    const capture = vi.fn();
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: {
        load: vi.fn(async () => bindingFor(conflictingRequest)),
        accept: vi.fn(),
      },
      capture,
    });

    await expect(coordinator.run({ request, claim })).rejects.toThrow(
      'conflicts with the requested dispatch'
    );
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects accepted custody that does not descend from the captured normalization', async () => {
    const captured = bindingFor(request, '8');
    const conflicting = bindingFor(request, '9');
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: {
        load: vi.fn(async () => null),
        accept: vi.fn(async () => conflicting),
      },
      capture: vi.fn(async () => ({
        normalizationRunId: captured.content.normalizationRunId,
      })),
    });

    await expect(coordinator.run({ request, claim })).rejects.toThrow(
      'disagrees with the captured normalization'
    );
  });
});
