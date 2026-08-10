import { describe, expect, it } from 'vitest';

import { createLocalAflTradePromotionBackedEvidence } from '@/server/aflTradeIntelligence/development/localPromotionBackedEvidenceFixture';

describe('local promotion-backed AFL evidence fixture', () => {
  it('reconciles a complete trade, two realised picks, and one open future pick', () => {
    const result = createLocalAflTradePromotionBackedEvidence();

    expect(result.sourceBatches.map(({ content }) => content.provider)).toEqual([
      'draftguru',
      'official_afl',
    ]);
    expect(result.candidate.content).toMatchObject({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      publicationEligible: false,
    });
    expect(result.candidate.content.transactions).toEqual([
      expect.objectContaining({
        seasonYear: 2025,
        parties: ['club-gws', 'club-western-bulldogs'],
        status: 'single_source',
      }),
    ]);
    expect(result.candidate.content.transfers).toHaveLength(3);
    expect(result.candidate.content.draftSelections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selectionNumber: 14, playerId: 'player-harry-kyle' }),
        expect.objectContaining({ selectionNumber: 19, playerId: 'player-josh-lindsay' }),
      ])
    );
    expect(result.candidate.content.pickCustody).toHaveLength(3);
    expect(result.candidate.content.pickLineage).toHaveLength(2);
    expect(
      result.candidate.content.transfers.find(
        ({ asset }) => asset.kind === 'pick_entitlement' && asset.draftYear === 2026
      )
    ).toMatchObject({
      status: 'single_source',
      asset: { nominalRound: 2, nominalPick: null },
    });
    expect(result.candidate.content.issues).toEqual([]);
  });

  it('is byte-stable and keeps all source rows accounted for', () => {
    const first = createLocalAflTradePromotionBackedEvidence();
    const second = createLocalAflTradePromotionBackedEvidence();
    const sourceEvidenceIds = first.sourceBatches
      .flatMap(({ content }) => content.evidence.map(({ evidenceId }) => evidenceId))
      .sort();
    const candidateEvidenceIds = [
      ...first.candidate.content.transactions,
      ...first.candidate.content.transfers,
      ...first.candidate.content.draftSelections,
      ...first.candidate.content.pickCustody,
      ...first.candidate.content.pickLineage,
      ...first.candidate.content.issues,
    ]
      .flatMap(({ evidenceIds }) => evidenceIds)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();

    expect(second).toEqual(first);
    expect(candidateEvidenceIds).toEqual(sourceEvidenceIds);
  });
});
