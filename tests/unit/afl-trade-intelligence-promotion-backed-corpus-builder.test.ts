import { describe, expect, it } from 'vitest';

import { buildAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusBuilder';

const sha = (value: string) => value.repeat(64);

function promotion(overrides: Record<string, unknown> = {}) {
  return {
    promotionId: `external-canonical-promotion:${sha('a')}`,
    receiptSha256: sha('a'),
    environment: 'test_fixture' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    status: 'finalized' as const,
    finalizedAt: '2026-08-10T00:00:01.000Z',
    promotionRecordCount: 2,
    records: [
      {
        recordKind: 'transaction' as const,
        sourceRecordId: 'trade:2025:100',
        canonicalRecordId: `event-version:${sha('1')}`,
        recordSha256: sha('1'),
      },
      {
        recordKind: 'draft_selection' as const,
        sourceRecordId: 'selection:2025:national:14',
        canonicalRecordId: `draft-selection:${sha('2')}`,
        recordSha256: sha('2'),
      },
    ],
    ...overrides,
  };
}

describe('promotion-backed corpus builder', () => {
  it('builds one corpus entirely from authenticated finalized promotion snapshots', () => {
    const corpus = buildAflTradePromotionBackedCorpus({
      environment: 'test_fixture',
      competition: 'AFLM',
      knowledgeCutoffAt: '2026-08-10T00:00:02.000Z',
      createdAt: '2026-08-10T00:00:03.000Z',
      promotions: [promotion()],
    });

    expect(corpus.content.promotionCount).toBe(1);
    expect(corpus.content.memberCount).toBe(2);
    expect(
      corpus.content.members.every(({ promotionId }) => promotionId === promotion().promotionId)
    ).toBe(true);
  });

  it('rejects open, mixed-scope, or incompletely loaded promotions', () => {
    expect(() =>
      buildAflTradePromotionBackedCorpus({
        environment: 'test_fixture',
        competition: 'AFLM',
        knowledgeCutoffAt: '2026-08-10T00:00:02.000Z',
        createdAt: '2026-08-10T00:00:03.000Z',
        promotions: [promotion({ status: 'open', finalizedAt: null })],
      })
    ).toThrow(/finalized/i);
    expect(() =>
      buildAflTradePromotionBackedCorpus({
        environment: 'test_fixture',
        competition: 'AFLM',
        knowledgeCutoffAt: '2026-08-10T00:00:02.000Z',
        createdAt: '2026-08-10T00:00:03.000Z',
        promotions: [promotion({ environment: 'production' })],
      })
    ).toThrow(/scope/i);
    expect(() =>
      buildAflTradePromotionBackedCorpus({
        environment: 'test_fixture',
        competition: 'AFLM',
        knowledgeCutoffAt: '2026-08-10T00:00:02.000Z',
        createdAt: '2026-08-10T00:00:03.000Z',
        promotions: [promotion({ promotionRecordCount: 3 })],
      })
    ).toThrow(/record count/i);
  });
});
