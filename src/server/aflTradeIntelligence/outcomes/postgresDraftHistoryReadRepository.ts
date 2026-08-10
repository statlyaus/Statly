import 'server-only';

import type { AflTradePromotionBackedPublicArchiveRecordInput } from './promotionBackedPublicArchiveContracts';
import type { AflTradePromotionBackedPublicArchiveReadRepository } from './postgresPromotionBackedPublicArchiveReadRepository';
import {
  AFL_DRAFT_HISTORY_DRAFT_KINDS,
  type AflDraftHistoryRepository,
  type AflDraftHistorySelection,
  type AflDraftHistoryYearSummary,
} from './draftHistoryReadService';

type DraftKind = (typeof AFL_DRAFT_HISTORY_DRAFT_KINDS)[number];
type DraftSelection = Extract<
  AflTradePromotionBackedPublicArchiveRecordInput,
  { recordKind: 'draft_selection' }
>;
type Custody = Extract<
  AflTradePromotionBackedPublicArchiveRecordInput,
  { recordKind: 'pick_custody' }
>;

const supportedKinds = new Set<string>(AFL_DRAFT_HISTORY_DRAFT_KINDS);

function draftKind(value: string): DraftKind {
  if (!supportedKinds.has(value)) throw new Error(`Unsupported released AFL draft kind: ${value}.`);
  return value as DraftKind;
}

function club(value: DraftSelection['club']) {
  return {
    aflClubId: value.clubId,
    name: value.name,
    abbreviation: value.abbreviation ?? value.name,
  };
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

function selectionRows(
  records: readonly AflTradePromotionBackedPublicArchiveRecordInput[]
): AflDraftHistorySelection[] {
  const events = new Map(
    recordsByKind(records, 'draft_event').map((event) => [event.eventVersionId, event])
  );
  const transactions = new Map(
    recordsByKind(records, 'transaction').map((event) => [event.eventVersionId, event])
  );
  const transfers = new Map(
    recordsByKind(records, 'transfer').map((asset) => [asset.assetVersionId, asset])
  );
  const custodyByPick = new Map<string, Custody[]>();
  for (const custody of recordsByKind(records, 'pick_custody')) {
    const values = custodyByPick.get(custody.pickId) ?? [];
    values.push(custody);
    custodyByPick.set(custody.pickId, values);
  }
  const realizationBySelection = new Map(
    recordsByKind(records, 'pick_realization').map((value) => [value.draftSelectionId, value])
  );

  return recordsByKind(records, 'draft_selection').map((selection) => {
    const event = events.get(selection.eventVersionId);
    if (!event)
      throw new Error(`Released draft selection ${selection.selectionId} has no draft event.`);
    const realization = realizationBySelection.get(selection.selectionId);
    const transfer = realization ? transfers.get(realization.transferAssetVersionId) : undefined;
    const transaction = transfer ? transactions.get(transfer.eventVersionId) : undefined;
    if (realization && (!transfer || !transaction || transfer.pick?.pickId !== selection.pickId)) {
      throw new Error(
        `Released draft selection ${selection.selectionId} has incomplete trade lineage.`
      );
    }
    const custody = selection.pickId
      ? (custodyByPick.get(selection.pickId) ?? []).sort((left, right) =>
          right.observedAt.localeCompare(left.observedAt)
        )[0]
      : undefined;
    const originalClub = transfer?.pick?.originalClub ?? custody?.originalClub ?? null;
    return {
      selectionId: selection.selectionId,
      eventId: event.eventId,
      eventVersionId: event.eventVersionId,
      year: event.seasonYear,
      draftKind: draftKind(event.draftKind),
      draftName: event.officialName,
      draftDate: event.occurredOn,
      selectionNumber: selection.selectionNumber,
      round: transfer?.pick?.nominalRound ?? custody?.recordedRound ?? null,
      pickId: selection.pickId,
      club: club(selection.club),
      originalClub: originalClub ? club(originalClub) : null,
      player: {
        aflPlayerId: selection.player.playerId,
        displayName: selection.player.displayName,
        identityStatus: 'resolved',
      },
      lineage: {
        status: transaction
          ? 'linked_to_trade'
          : selection.pickId
            ? 'selection_only'
            : 'unresolved',
        edgeCount: realization ? 1 : 0,
        tradeRefs: transaction
          ? [
              {
                tradeId: transaction.eventId,
                year: transaction.seasonYear,
                title: transaction.officialName,
              },
            ]
          : [],
      },
    };
  });
}

export function createPostgresAflDraftHistoryRepository(dependencies: {
  archiveRepository: AflTradePromotionBackedPublicArchiveReadRepository;
}): AflDraftHistoryRepository {
  return {
    async listYears(selection): Promise<readonly AflDraftHistoryYearSummary[]> {
      const records = await dependencies.archiveRepository.listRecords(selection, {
        recordKinds: ['draft_event', 'draft_selection'],
        limit: 10_000,
      });
      const events = recordsByKind(records, 'draft_event');
      const selections = recordsByKind(records, 'draft_selection');
      const eventByVersion = new Map(events.map((event) => [event.eventVersionId, event]));
      const summaries = new Map<
        number,
        { eventIds: Set<string>; kinds: Set<DraftKind>; count: number }
      >();
      for (const selection of selections) {
        const event = eventByVersion.get(selection.eventVersionId);
        if (!event)
          throw new Error(`Released draft selection ${selection.selectionId} has no event.`);
        const summary = summaries.get(event.seasonYear) ?? {
          eventIds: new Set<string>(),
          kinds: new Set<DraftKind>(),
          count: 0,
        };
        summary.eventIds.add(event.eventId);
        summary.kinds.add(draftKind(event.draftKind));
        summary.count += 1;
        summaries.set(event.seasonYear, summary);
      }
      return [...summaries.entries()].map(([year, summary]) => ({
        year,
        selectionCount: summary.count,
        draftEventCount: summary.eventIds.size,
        draftKinds: [...summary.kinds].sort(),
      }));
    },

    async readYear(selection, year): Promise<readonly AflDraftHistorySelection[]> {
      const draftRecords = await dependencies.archiveRepository.listRecords(selection, {
        recordKinds: ['draft_event', 'draft_selection', 'pick_custody'],
        seasonYear: year,
        limit: 10_000,
      });
      const pickIds = recordsByKind(draftRecords, 'draft_selection')
        .flatMap((record) => (record.pickId ? [record.pickId] : []))
        .sort();
      const pickRecords =
        pickIds.length > 0
          ? await dependencies.archiveRepository.listRecords(selection, {
              recordKinds: ['transfer', 'pick_realization'],
              pickIds,
              limit: 10_000,
            })
          : [];
      const eventVersionIds = recordsByKind(pickRecords, 'transfer')
        .map(({ eventVersionId }) => eventVersionId)
        .sort();
      const transactions =
        eventVersionIds.length > 0
          ? await dependencies.archiveRepository.listRecords(selection, {
              recordKinds: ['transaction'],
              eventVersionIds,
              limit: 10_000,
            })
          : [];
      return selectionRows([...draftRecords, ...pickRecords, ...transactions]);
    },
  };
}
