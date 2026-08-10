import 'server-only';

import { AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE } from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import type {
  AflTradePromotionBackedArchiveSelection,
  AflTradePromotionBackedArchiveSelector,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedArchiveSelection';
import type { AflTradePromotionBackedPublicArchiveRecordInput } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import type { AflTradePromotionBackedPublicArchiveReadRepository } from '@/server/aflTradeIntelligence/outcomes/postgresPromotionBackedPublicArchiveReadRepository';

import type { DraftTradeReadRepository } from './read';
import type {
  DraftClubListItem,
  DraftClubTradeRefItem,
  DraftTradeAssetItem,
  DraftTradeDetail,
  DraftTradeListItem,
  DraftTradePartyItem,
} from './firestore';

type Transfer = Extract<
  AflTradePromotionBackedPublicArchiveRecordInput,
  { recordKind: 'transfer' }
>;
interface ArchiveBundle {
  trades: DraftTradeListItem[];
  details: Map<string, DraftTradeDetail>;
  refsByClub: Map<string, DraftClubTradeRefItem[]>;
  clubs: DraftClubListItem[];
}

function clubSlug(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function recordsByKind<T extends AflTradePromotionBackedPublicArchiveRecordInput['recordKind']>(
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[],
  kind: T
): Extract<AflTradePromotionBackedPublicArchiveRecordInput, { recordKind: T }>[] {
  return records.filter(
    (
      record
    ): record is Extract<AflTradePromotionBackedPublicArchiveRecordInput, { recordKind: T }> =>
      record.recordKind === kind
  );
}

function assetType(kind: Transfer['assetKind']): DraftTradeAssetItem['assetType'] {
  if (kind === 'player') return 'player';
  if (kind === 'current_pick') return 'pick';
  if (kind === 'future_pick') return 'future_pick';
  return 'unknown';
}

function pickCode(asset: Transfer): string | null {
  if (!asset.pick) return null;
  if (asset.assetKind === 'future_pick' && asset.pick.draftSeasonYear && asset.pick.nominalRound) {
    return `#${asset.pick.draftSeasonYear}R${asset.pick.nominalRound}`;
  }
  return asset.pick.nominalPick === null ? null : `#${asset.pick.nominalPick}`;
}

function buildBundle(
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[]
): ArchiveBundle {
  const transactions = recordsByKind(records, 'transaction').sort(
    (left, right) =>
      right.seasonYear - left.seasonYear ||
      left.occurredOn.localeCompare(right.occurredOn) ||
      left.eventId.localeCompare(right.eventId)
  );
  const transfersByEvent = new Map<string, Transfer[]>();
  for (const transfer of recordsByKind(records, 'transfer')) {
    const values = transfersByEvent.get(transfer.eventVersionId) ?? [];
    values.push(transfer);
    transfersByEvent.set(transfer.eventVersionId, values);
  }
  const selections = new Map(
    recordsByKind(records, 'draft_selection').map((selection) => [selection.selectionId, selection])
  );
  const realizationByTransfer = new Map(
    recordsByKind(records, 'pick_realization').map((realization) => [
      realization.transferAssetVersionId,
      realization,
    ])
  );
  const eventSequence = new Map<number, number>();
  const details = new Map<string, DraftTradeDetail>();
  const refsByClub = new Map<string, DraftClubTradeRefItem[]>();
  const clubStats = new Map<string, DraftClubListItem & { years: Set<number> }>();

  const trades = transactions.map((event) => {
    const seqInYear = (eventSequence.get(event.seasonYear) ?? 0) + 1;
    eventSequence.set(event.seasonYear, seqInYear);
    const transferRows = (transfersByEvent.get(event.eventVersionId) ?? []).sort(
      (left, right) =>
        left.assetKey.localeCompare(right.assetKey) ||
        left.assetVersionId.localeCompare(right.assetVersionId)
    );
    const parties: DraftTradePartyItem[] = event.parties.map((party) => {
      const received = transferRows.filter((asset) => asset.toClub.clubId === party.club.clubId);
      return {
        id: `${event.eventVersionId}:${party.club.clubId}`,
        tradeId: event.eventId,
        year: event.seasonYear,
        seqInYear,
        tradeTitle: event.officialName,
        clubSlug: clubSlug(party.club.name),
        clubName: party.club.name,
        rowOrder: party.ordinal,
        assetsRaw: received.map(({ rawDescription }) => rawDescription).join(' + '),
        expected: null,
        actual: null,
      };
    });
    const assets: DraftTradeAssetItem[] = transferRows.map((asset, index) => {
      const realization = realizationByTransfer.get(asset.assetVersionId);
      const selected = realization ? selections.get(realization.draftSelectionId) : undefined;
      if (realization && (!selected || selected.pickId !== asset.pick?.pickId)) {
        throw new Error(
          `Released trade asset ${asset.assetVersionId} has incomplete pick realization.`
        );
      }
      return {
        id: asset.assetVersionId,
        tradeId: event.eventId,
        year: event.seasonYear,
        clubSlug: clubSlug(asset.toClub.name),
        clubName: asset.toClub.name,
        assetIndex: index,
        assetType: assetType(asset.assetKind),
        assetText: asset.rawDescription,
        playerName: asset.player?.displayName ?? null,
        pick: {
          code: pickCode(asset),
          numberGiven: asset.pick?.nominalPick ?? null,
          year: asset.pick?.draftSeasonYear ?? null,
          round: asset.pick?.nominalRound ?? null,
          originalClub: asset.pick?.originalClub?.name ?? null,
          numberActual: selected?.selectionNumber ?? null,
        },
        draftedPlayer: selected?.player.displayName ?? null,
        games: null,
        note: null,
      };
    });
    const receivesByClub = parties.map((party) => {
      const received = assets.filter((asset) => asset.clubSlug === party.clubSlug);
      return {
        clubSlug: party.clubSlug,
        clubName: party.clubName,
        assetCount: received.length,
        playerCount: received.filter(({ assetType: type }) => type === 'player').length,
        pickCount: received.filter(({ assetType: type }) => type === 'pick').length,
        futurePickCount: received.filter(({ assetType: type }) => type === 'future_pick').length,
      };
    });
    const trade: DraftTradeListItem = {
      tradeId: event.eventId,
      year: event.seasonYear,
      seqInYear,
      title: event.officialName,
      clubSlugs: parties.map(({ clubSlug: slug }) => slug),
      clubNames: parties.map(({ clubName }) => clubName),
      partyCount: parties.length,
      assetCount: assets.length,
      hasPlayers: assets.some(({ assetType: type }) => type === 'player'),
      hasPicks: assets.some(({ assetType: type }) => type === 'pick'),
      hasFuturePicks: assets.some(({ assetType: type }) => type === 'future_pick'),
      receivesByClub,
    };
    details.set(event.eventId, { trade, parties, assets });
    for (const party of parties) {
      const refs = refsByClub.get(party.clubSlug) ?? [];
      refs.push({
        tradeId: event.eventId,
        year: event.seasonYear,
        seqInYear,
        title: event.officialName,
        clubSlug: party.clubSlug,
        clubName: party.clubName,
        assetsRaw: party.assetsRaw,
        expected: null,
        actual: null,
      });
      refsByClub.set(party.clubSlug, refs);
      const stats = clubStats.get(party.clubSlug) ?? {
        clubSlug: party.clubSlug,
        clubName: party.clubName,
        tradeCount: 0,
        partyCount: 0,
        assetCount: 0,
        firstYear: null,
        lastYear: null,
        years: new Set<number>(),
      };
      stats.tradeCount += 1;
      stats.partyCount += 1;
      stats.assetCount +=
        receivesByClub.find(({ clubSlug: slug }) => slug === party.clubSlug)?.assetCount ?? 0;
      stats.years.add(event.seasonYear);
      clubStats.set(party.clubSlug, stats);
    }
    return trade;
  });
  const clubs = [...clubStats.values()].map(({ years, ...stats }) => ({
    ...stats,
    firstYear: years.size > 0 ? Math.min(...years) : null,
    lastYear: years.size > 0 ? Math.max(...years) : null,
  }));
  return { trades, details, refsByClub, clubs };
}

async function loadArchive(
  selection: AflTradePromotionBackedArchiveSelection,
  repository: AflTradePromotionBackedPublicArchiveReadRepository
): Promise<ArchiveBundle> {
  const records = await repository.listAllRecords(selection, {
    recordKinds: ['transaction', 'transfer', 'draft_selection', 'pick_realization'],
  });
  return buildBundle(records);
}

export function createPostgresDraftTradeReadRepository(dependencies: {
  archiveSelector: AflTradePromotionBackedArchiveSelector;
  archiveRepository: AflTradePromotionBackedPublicArchiveReadRepository;
  scopeKey?: string;
}): DraftTradeReadRepository {
  let cached: { archiveId: string; bundle: Promise<ArchiveBundle> } | null = null;
  const archive = async () => {
    const snapshot = await dependencies.archiveSelector.capture(
      dependencies.scopeKey ?? AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE
    );
    if (!snapshot.selection) {
      cached = null;
      return buildBundle([]);
    }
    if (cached?.archiveId !== snapshot.selection.publicArchiveId) {
      cached = {
        archiveId: snapshot.selection.publicArchiveId,
        bundle: loadArchive(snapshot.selection, dependencies.archiveRepository),
      };
    }
    return cached.bundle;
  };
  return {
    async listTradesByYear(year, options) {
      const trades = (await archive()).trades.filter((trade) => trade.year === year);
      return trades.filter((trade) => {
        if (options?.clubSlug && !trade.clubSlugs.includes(options.clubSlug)) return false;
        if (options?.type === 'player' && !trade.hasPlayers) return false;
        if (options?.type === 'pick' && !trade.hasPicks) return false;
        if (options?.type === 'future_pick' && !trade.hasFuturePicks) return false;
        const query = options?.q?.trim().toLowerCase();
        return (
          !query || `${trade.title} ${trade.clubNames.join(' ')}`.toLowerCase().includes(query)
        );
      });
    },
    async listYears() {
      return [...new Set((await archive()).trades.map(({ year }) => year))].sort((a, b) => b - a);
    },
    async getById(tradeId) {
      return (await archive()).details.get(tradeId) ?? null;
    },
    async listRefsByClub(slug) {
      return (await archive()).refsByClub.get(slug) ?? [];
    },
    async listClubs() {
      return (await archive()).clubs.sort((left, right) =>
        left.clubName.localeCompare(right.clubName)
      );
    },
    async searchTrades(query, limit) {
      const normalizedQuery = query.trim().toLowerCase();
      const boundedLimit = Math.max(1, Math.min(limit, 200));
      return (await archive()).trades
        .map((trade) => ({
          trade,
          score:
            (trade.title.toLowerCase().includes(normalizedQuery) ? 3 : 0) +
            (trade.clubNames.some((name) => name.toLowerCase().includes(normalizedQuery)) ? 2 : 0) +
            (trade.tradeId.toLowerCase().includes(normalizedQuery) ? 1 : 0),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.trade.year - left.trade.year ||
            left.trade.seqInYear - right.trade.seqInYear ||
            left.trade.tradeId.localeCompare(right.trade.tradeId)
        )
        .slice(0, boundedLimit)
        .map(({ trade }) => trade);
    },
  };
}
