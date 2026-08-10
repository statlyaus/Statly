import { describe, expect, it, vi } from 'vitest';

import { createPostgresDraftTradeReadRepository } from '@/lib/draftTrades/postgres';
import type {
  AflTradePromotionBackedArchiveSelection,
  AflTradePromotionBackedArchiveSelector,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import type { AflTradePromotionBackedPublicArchiveRecordInput } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import type { AflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';

const hash = (value: string) => value.repeat(64);
const selection = {
  schemaVersion: 'afl-trade-promotion-backed-archive-selection/v1',
  registryRevision: 4,
  scopeKey: 'public-afl-draft-trade-outcomes',
  environment: 'production',
  competition: 'AFLM',
  validFromSeason: 2025,
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
  effectiveThrough: '2025-12-31T00:00:00.000Z',
  publishedAt: '2026-01-01T00:00:00.000Z',
  capturedAt: '2026-01-01T00:01:00.000Z',
} satisfies AflTradePromotionBackedArchiveSelection;

const carlton = { clubId: 'club-carlton', name: 'Carlton', abbreviation: 'CARL' };
const fremantle = { clubId: 'club-fremantle', name: 'Fremantle', abbreviation: 'FRE' };
const transaction = {
  recordKind: 'transaction',
  recordId: 'event-version-1',
  eventId: 'trade-1',
  eventVersionId: 'event-version-1',
  seasonYear: 2025,
  occurredOn: '2025-10-09',
  officialName: '2025 Trade for Liam Reidy',
  transactionType: 'trade',
  parties: [
    { club: carlton, role: 'party', ordinal: 1 },
    { club: fremantle, role: 'party', ordinal: 2 },
  ],
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const playerAsset = {
  recordKind: 'transfer',
  recordId: 'asset-player',
  assetVersionId: 'asset-player',
  eventVersionId: transaction.eventVersionId,
  assetKey: '01-player-reidy',
  assetKind: 'player',
  rawDescription: 'Liam Reidy',
  player: { playerId: 'player-reidy', displayName: 'Liam Reidy' },
  pick: null,
  fromClub: fremantle,
  toClub: carlton,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const pickAsset = {
  recordKind: 'transfer',
  recordId: 'asset-pick',
  assetVersionId: 'asset-pick',
  eventVersionId: transaction.eventVersionId,
  assetKey: '02-pick-50',
  assetKind: 'current_pick',
  rawDescription: 'Pick 50',
  player: null,
  pick: {
    pickId: 'pick-2025-50',
    draftSeasonYear: 2025,
    draftKind: 'national_draft',
    nominalRound: 3,
    nominalPick: 50,
    originalClub: carlton,
  },
  fromClub: carlton,
  toClub: fremantle,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const selected = {
  recordKind: 'draft_selection',
  recordId: 'selection-43',
  selectionId: 'selection-43',
  eventVersionId: 'draft-event-version-2025',
  selectionNumber: 43,
  pickId: pickAsset.pick.pickId,
  player: { playerId: 'player-cooper-simpson', displayName: 'Cooper Simpson' },
  club: fremantle,
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const realization = {
  recordKind: 'pick_realization',
  recordId: 'realization-pick-50',
  realizationId: 'realization-pick-50',
  pickId: pickAsset.pick.pickId,
  transferAssetVersionId: pickAsset.assetVersionId,
  draftSelectionId: selected.selectionId,
  relationKind: 'exercised_as',
} satisfies AflTradePromotionBackedPublicArchiveRecordInput;
const records = [transaction, playerAsset, pickAsset, selected, realization];

function activeSelector(active = true) {
  const capture = vi.fn(async () => ({
    registryRevision: 4,
    selection: active ? selection : null,
    unavailabilityReason: active ? null : ('source_blocked' as const),
  }));
  return { capture } as AflTradePromotionBackedArchiveSelector & { capture: typeof capture };
}

function archiveReader() {
  const listRecords = vi.fn(async () => records);
  return { listRecords } as unknown as AflTradePromotionBackedPublicArchiveReadRepository & {
    listRecords: typeof listRecords;
  };
}

describe('PostgreSQL AFL draft and trade archive reads', () => {
  it('fails closed to an empty archive when no governed archive is active', async () => {
    const archiveSelector = activeSelector(false);
    const archiveRepository = archiveReader();
    const repository = createPostgresDraftTradeReadRepository({
      archiveSelector,
      archiveRepository,
    });

    await expect(repository.listYears()).resolves.toEqual([]);
    await expect(repository.getById('trade-1')).resolves.toBeNull();
    expect(archiveRepository.listRecords).not.toHaveBeenCalled();
  });

  it('maps sealed facts into trade/detail/club views and resolves the selected player', async () => {
    const archiveRepository = archiveReader();
    const repository = createPostgresDraftTradeReadRepository({
      archiveSelector: activeSelector(),
      archiveRepository,
    });

    await expect(repository.listTradesByYear(2025)).resolves.toEqual([
      expect.objectContaining({
        tradeId: 'trade-1',
        clubSlugs: ['carlton', 'fremantle'],
        partyCount: 2,
        assetCount: 2,
        hasPlayers: true,
        hasPicks: true,
      }),
    ]);
    const detail = await repository.getById('trade-1');
    expect(detail?.assets).toEqual([
      expect.objectContaining({ assetType: 'player', playerName: 'Liam Reidy' }),
      expect.objectContaining({
        assetType: 'pick',
        pick: expect.objectContaining({
          numberGiven: 50,
          numberActual: 43,
        }),
        draftedPlayer: 'Cooper Simpson',
      }),
    ]);
    await expect(repository.listRefsByClub('carlton')).resolves.toHaveLength(1);
    await expect(repository.listClubs()).resolves.toEqual([
      expect.objectContaining({ clubSlug: 'carlton', assetCount: 1 }),
      expect.objectContaining({ clubSlug: 'fremantle', assetCount: 1 }),
    ]);
    expect(archiveRepository.listRecords).toHaveBeenCalledTimes(1);
  });

  it('applies existing public filters to one cached immutable archive', async () => {
    const archiveRepository = archiveReader();
    const repository = createPostgresDraftTradeReadRepository({
      archiveSelector: activeSelector(),
      archiveRepository,
    });
    await expect(repository.listTradesByYear(2025, { clubSlug: 'carlton' })).resolves.toHaveLength(
      1
    );
    await expect(repository.listTradesByYear(2025, { type: 'pick' })).resolves.toHaveLength(1);
    await expect(repository.listTradesByYear(2025, { q: 'reidy' })).resolves.toHaveLength(1);
    await expect(repository.listTradesByYear(2024)).resolves.toEqual([]);
    expect(archiveRepository.listRecords).toHaveBeenCalledTimes(1);
  });
});
