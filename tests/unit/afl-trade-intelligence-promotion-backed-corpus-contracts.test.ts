import { describe, expect, it } from 'vitest';

import {
  createAflTradePromotionBackedCorpus,
  parseAflTradePromotionBackedCorpus,
} from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';

const sha = (value: string) => value.repeat(64);
const firstPromotion = `external-canonical-promotion:${sha('a')}`;
const secondPromotion = `external-canonical-promotion:${sha('b')}`;

const promotions = [
  {
    promotionId: firstPromotion,
    promotionSha256: sha('a'),
    anchorSeasonYear: 2024,
    finalizedAt: '2026-08-10T00:00:01.000Z',
    promotionRecordCount: 1,
  },
  {
    promotionId: secondPromotion,
    promotionSha256: sha('b'),
    anchorSeasonYear: 2025,
    finalizedAt: '2026-08-10T00:00:02.000Z',
    promotionRecordCount: 2,
  },
] as const;

const members = [
  {
    promotionId: secondPromotion,
    recordKind: 'draft_selection' as const,
    sourceRecordId: 'selection:2025:national:14',
    canonicalRecordId: `draft-selection:${sha('1')}`,
    recordSha256: sha('1'),
  },
  {
    promotionId: firstPromotion,
    recordKind: 'transaction' as const,
    sourceRecordId: 'trade:2024:101',
    canonicalRecordId: `event-version:${sha('2')}`,
    recordSha256: sha('2'),
  },
  {
    promotionId: secondPromotion,
    recordKind: 'pick_realization' as const,
    sourceRecordId: 'pick:2025:national:14',
    canonicalRecordId: `pick-realization:${sha('3')}`,
    recordSha256: sha('3'),
  },
] as const;

function create(overrides: Record<string, unknown> = {}) {
  return createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:04.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:03.000Z',
    promotions,
    members,
    ...overrides,
  });
}

describe('promotion-backed corpus contracts', () => {
  it('canonicalizes promotion records into one reconstructable private corpus', () => {
    const corpus = create();

    expect(parseAflTradePromotionBackedCorpus(corpus)).toEqual(corpus);
    expect(corpus.corpusId).toMatch(/^corpus:[a-f0-9]{64}$/);
    expect(corpus.content.publicationEligible).toBe(false);
    expect(corpus.content.anchorSeasonRange).toEqual({ from: 2024, through: 2025 });
    expect(corpus.content.memberCount).toBe(3);
    expect(corpus.content.recordCounts).toEqual({
      transaction: 1,
      transfer: 0,
      draft_event: 0,
      draft_selection: 1,
      draft_player_asset: 0,
      pick_custody: 0,
      pick_realization: 1,
    });
    expect(corpus.content.members.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3]);
  });

  it('is invariant to input promotion and member order', () => {
    expect(
      createAflTradePromotionBackedCorpus({
        environment: 'test_fixture',
        competition: 'AFLM',
        createdAt: '2026-08-10T00:00:04.000Z',
        knowledgeCutoffAt: '2026-08-10T00:00:03.000Z',
        promotions: [...promotions].reverse(),
        members: [...members].reverse(),
      })
    ).toEqual(create());
  });

  it('rejects missing promotion records and foreign memberships', () => {
    expect(() => create({ members: members.slice(1) })).toThrow(/record count/i);
    expect(() =>
      create({
        members: [
          ...members,
          { ...members[0], promotionId: `external-canonical-promotion:${sha('c')}` },
        ],
      })
    ).toThrow(/listed promotion/i);
  });

  it('rejects substituted promotion identity and impossible chronology', () => {
    expect(() =>
      create({ promotions: [{ ...promotions[0], promotionSha256: sha('f') }, promotions[1]] })
    ).toThrow(/content address/i);
    expect(() => create({ knowledgeCutoffAt: '2026-08-09T23:59:59.000Z' })).toThrow(
      /finalization/i
    );
  });
});
