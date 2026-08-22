import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION,
  createAflTradePrivateValuationCaptureBinding,
  parseAflTradePrivateValuationCaptureBinding,
} from '@/server/aflTradeIntelligence/valuation/privateValuationCaptureBinding';

const sha = (character: string) => character.repeat(64);

function createFixture() {
  return createAflTradePrivateValuationCaptureBinding({
    request: {
      requestId: `private-valuation-dispatch:${sha('1')}`,
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly',
      scheduledFor: '2026-08-24T09:00:00.000Z',
      authorityKey: 'weekly:2026-08-24T09:00:00.000Z',
    },
    dispatchClaimId: `private-valuation-dispatch-claim:${sha('2')}`,
    attemptSequence: 1,
    attemptNumber: 1,
    sourcePlan: {
      provider: 'fitzRoy',
      dataset: 'AFL Tables player statistics',
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      seasonYear: 2026,
      fieldMapId: 'afl-tables-player-stats-2026-v1',
      gate0AReceiptId: `gate0a-evaluation:${sha('8')}`,
    },
    sourceCaptureAttemptId: `source-capture-attempt:${sha('3')}`,
    captureReceiptId: `fitzroy-capture:${sha('4')}`,
    snapshotId: `source-snapshot:${sha('5')}`,
    sourceCaptureId: `source-capture:${sha('6')}`,
    normalizationRunId: `provider-normalization-run:${sha('7')}`,
    acceptedAt: '2026-08-24T09:01:00.000Z',
  });
}

describe('private valuation capture binding', () => {
  it('content-addresses one exact accepted source result for its dispatch', () => {
    const binding = createFixture();

    expect(binding.bindingId).toMatch(/^private-valuation-capture-binding:[a-f0-9]{64}$/);
    expect(parseAflTradePrivateValuationCaptureBinding(binding)).toEqual(binding);
    expect(createFixture()).toEqual(binding);
    expect(binding.content).toMatchObject({
      sourcePlan: {
        capabilityId: 'afl-tables-player-stats',
        competition: 'AFLM',
        seasonYear: 2026,
        fieldMapId: 'afl-tables-player-stats-2026-v1',
      },
      environment: 'non_production',
      publicationEligible: false,
      limitation: AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION,
    });
  });

  it('rejects a recomputed binding that claims another identifier', () => {
    const binding = createFixture();

    expect(() =>
      parseAflTradePrivateValuationCaptureBinding({
        ...binding,
        bindingId: `private-valuation-capture-binding:${sha('8')}`,
      })
    ).toThrow('content address');
  });

  it('rejects an attempt budget number beyond its dispatch claim sequence', () => {
    expect(() =>
      createAflTradePrivateValuationCaptureBinding({
        ...createFixture().content,
        attemptSequence: 1,
        attemptNumber: 2,
      })
    ).toThrow('attempt number cannot exceed');
  });
});
