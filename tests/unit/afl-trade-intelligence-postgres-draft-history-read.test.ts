import { describe, expect, it, vi } from 'vitest';

import type { AflTradePromotionBackedArchiveSelection } from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import type { AflTradePromotionBackedPublicArchiveRecordInput } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import { createPostgresAflDraftHistoryRepository } from '@/server/aflTradeIntelligence/outcomes/postgresDraftHistoryReadRepository';
import type { AflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';

const hash = (value: string) => value.repeat(64);
const selection = {
  schemaVersion: 'afl-trade-promotion-backed-archive-selection/v1',
  registryRevision: 7,
  scopeKey: 'public-afl-draft-trade-outcomes',
  environment: 'test_fixture',
  competition: 'AFLM',
  validFromSeason: 2024,
  validThroughSeason: 2025,
  releaseId: `outcome-release:${hash('a')}`,
  projectionId: `outcome-projection:${hash('b')}`,
  publicArchiveId: `public-factual-archive:${hash('c')}`,
  factualCandidateId: `factual-release-candidate:${hash('d')}`,
  corpusId: `corpus:${hash('e')}`,
  lineageId: `corpus-factual-lineage:${hash('f')}`,
  gate2AdmissionId: `corpus-factual-lineage-admission:${hash('1')}`,
  gate2DecisionId: `gate-decision:${hash('2')}`,
  sourceMemberSetSha256: hash('3'),
  canonicalMemberSetSha256: hash('4'),
  publicRecordSetSha256: hash('5'),
  publicRecordCount: 7,
  effectiveThrough: '2025-11-30T00:00:00.000Z',
  publishedAt: '2025-12-01T00:00:00.000Z',
  capturedAt: '2025-12-01T00:01:00.000Z',
} satisfies AflTradePromotionBackedArchiveSelection;

const gws = { clubId: 'club:gws', name: 'GWS', abbreviation: 'GWS' };
const bulldogs = {
  clubId: 'club:western-bulldogs',
  name: 'Western Bulldogs',
  abbreviation: 'WB',
};
const draftEvent = {
  recordKind: 'draft_event',
  recordId: 'event-version:2025-national-draft-v1',
  eventId: 'event:2025-national-draft',
  eventVersionId: 'event-version:2025-national-draft-v1',
  seasonYear: 2025,
  occurredOn: '2025-11-19',
  officialName: '2025 AFL National Draft',
  draftKind: 'national_draft',
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const pick14 = {
  recordKind: 'draft_selection',
  recordId: 'selection:2025-national-14',
  selectionId: 'selection:2025-national-14',
  eventVersionId: draftEvent.eventVersionId,
  selectionNumber: 14,
  pickId: 'pick:2025-national-14',
  player: { playerId: 'player:harry-kyle', displayName: 'Harry Kyle' },
  club: bulldogs,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const pick19 = {
  ...pick14,
  recordId: 'selection:2025-national-19',
  selectionId: 'selection:2025-national-19',
  selectionNumber: 19,
  pickId: 'pick:2025-national-19',
  player: { playerId: 'player:josh-lindsay', displayName: 'Josh Lindsay' },
  club: gws,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const trade = {
  recordKind: 'transaction',
  recordId: 'event-version:2024-pick-trade-v1',
  eventId: 'event:2024-pick-trade',
  eventVersionId: 'event-version:2024-pick-trade-v1',
  seasonYear: 2024,
  occurredOn: '2024-10-15',
  officialName: '2024 Draft Pick Exchange: GWS and Western Bulldogs',
  transactionType: 'trade',
  parties: [
    { club: gws, role: 'party', ordinal: 1 },
    { club: bulldogs, role: 'party', ordinal: 2 },
  ],
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const transfer = {
  recordKind: 'transfer',
  recordId: 'asset:2024-future-pick-14',
  assetVersionId: 'asset:2024-future-pick-14',
  eventVersionId: trade.eventVersionId,
  assetKey: 'future-pick-14',
  assetKind: 'future_pick',
  rawDescription: '2025 first-round pick',
  player: null,
  pick: {
    pickId: pick14.pickId,
    draftSeasonYear: 2025,
    draftKind: 'national_draft',
    nominalRound: 1,
    nominalPick: 14,
    originalClub: gws,
  },
  fromClub: gws,
  toClub: bulldogs,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const realization = {
  recordKind: 'pick_realization',
  recordId: 'realization:pick-14',
  realizationId: 'realization:pick-14',
  pickId: pick14.pickId,
  transferAssetVersionId: transfer.assetVersionId,
  draftSelectionId: pick14.selectionId,
  relationKind: 'exercised_as',
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const onTrade = {
  ...trade,
  recordId: 'event-version:2025-pick-on-trade-v1',
  eventId: 'event:2025-pick-on-trade',
  eventVersionId: 'event-version:2025-pick-on-trade-v1',
  seasonYear: 2025,
  occurredOn: '2025-10-10',
  officialName: '2025 Draft Pick On-Trade: Western Bulldogs and GWS',
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const onTradedTransfer = {
  ...transfer,
  recordId: 'asset:2025-on-traded-pick-14',
  assetVersionId: 'asset:2025-on-traded-pick-14',
  eventVersionId: onTrade.eventVersionId,
  assetKey: 'on-traded-pick-14',
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const onTradeRealization = {
  ...realization,
  recordId: 'realization:on-traded-pick-14',
  realizationId: 'realization:on-traded-pick-14',
  transferAssetVersionId: onTradedTransfer.assetVersionId,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;

function archiveReader() {
  const readRecords = vi.fn(
    async (
      _selection: AflTradePromotionBackedArchiveSelection,
      query: { recordKinds: string[] }
    ) => {
      if (
        query.recordKinds.includes('draft_event') &&
        query.recordKinds.includes('draft_selection')
      ) {
        return [draftEvent, pick14, pick19];
      }
      if (query.recordKinds.includes('transfer'))
        return [transfer, realization, onTradedTransfer, onTradeRealization];
      if (query.recordKinds.length === 1 && query.recordKinds[0] === 'transaction')
        return [trade, onTrade];
      return [];
    }
  );
  return {
    listRecords: readRecords,
    listAllRecords: readRecords,
  } as unknown as AflTradePromotionBackedPublicArchiveReadRepository & {
    listRecords: typeof readRecords;
    listAllRecords: typeof readRecords;
  };
}

describe('PostgreSQL AFL draft-history reads', () => {
  it('maps selections and follows stable pick identity across years to its trade', async () => {
    const archiveRepository = archiveReader();
    const repository = createPostgresAflDraftHistoryRepository({ archiveRepository });

    await expect(repository.listYears(selection)).resolves.toEqual([
      {
        year: 2025,
        selectionCount: 2,
        draftEventCount: 1,
        draftKinds: ['national_draft'],
      },
    ]);
    const rows = await repository.readYear(selection, 2025);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      selectionNumber: 14,
      player: { aflPlayerId: 'player:harry-kyle', displayName: 'Harry Kyle' },
      originalClub: { name: 'GWS' },
      lineage: {
        status: 'linked_to_trade',
        edgeCount: 2,
        tradeRefs: [
          { tradeId: trade.eventId, year: 2024 },
          { tradeId: onTrade.eventId, year: 2025 },
        ],
      },
    });
    expect(rows[1]).toMatchObject({
      selectionNumber: 19,
      player: { aflPlayerId: 'player:josh-lindsay', displayName: 'Josh Lindsay' },
      lineage: { status: 'selection_only', edgeCount: 0, tradeRefs: [] },
    });
    expect(archiveRepository.listAllRecords).toHaveBeenCalledTimes(4);
  });
});
