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
type PickRealization = Extract<
  AflTradePromotionBackedPublicArchiveRecordInput,
  { recordKind: 'pick_realization' }
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

function latestCustody(observations: readonly Custody[]): Custody | undefined {
  if (observations.length === 0) return undefined;
  const byId = new Map(observations.map((row) => [row.custodyObservationId, row]));
  if (byId.size !== observations.length)
    throw new Error('Released pick custody repeats an identity.');
  const hasPredecessors = observations.some((row) => row.predecessorCustodyId != null);
  if (!hasPredecessors && observations.every((row) => typeof row.observedAt === 'string')) {
    return [...observations].sort((left, right) =>
      String(right.observedAt).localeCompare(String(left.observedAt))
    )[0];
  }
  const predecessors = new Set(
    observations.flatMap((row) => (row.predecessorCustodyId ? [row.predecessorCustodyId] : []))
  );
  const terminals = observations.filter((row) => !predecessors.has(row.custodyObservationId));
  if (terminals.length !== 1)
    throw new Error('Released pick custody has no unique terminal observation.');
  const terminal = terminals[0]!;
  const visited = new Set<string>();
  let current: Custody | undefined = terminal;
  while (current) {
    if (visited.has(current.custodyObservationId))
      throw new Error('Released pick custody contains a cycle.');
    visited.add(current.custodyObservationId);
    if (!current.predecessorCustodyId) break;
    current = byId.get(current.predecessorCustodyId);
    if (!current) throw new Error('Released pick custody is missing a predecessor.');
  }
  if (visited.size !== observations.length)
    throw new Error('Released pick custody contains disconnected observations.');
  return terminal;
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
  const realizationsBySelection = new Map<string, PickRealization[]>();
  for (const realization of recordsByKind(records, 'pick_realization')) {
    if (realization.draftSelectionId === null) continue;
    const values = realizationsBySelection.get(realization.draftSelectionId) ?? [];
    values.push(realization);
    realizationsBySelection.set(realization.draftSelectionId, values);
  }

  return recordsByKind(records, 'draft_selection').map((selection) => {
    const event = events.get(selection.eventVersionId);
    if (!event)
      throw new Error(`Released draft selection ${selection.selectionId} has no draft event.`);
    const lineage = (realizationsBySelection.get(selection.selectionId) ?? [])
      .map((realization) => {
        const transfer = transfers.get(realization.transferAssetVersionId);
        const transaction = transfer ? transactions.get(transfer.eventVersionId) : undefined;
        if (!transfer || !transaction || transfer.pick?.pickId !== selection.pickId) {
          throw new Error(
            `Released draft selection ${selection.selectionId} has incomplete trade lineage.`
          );
        }
        return { realization, transfer, transaction };
      })
      .sort(
        (left, right) =>
          left.transaction.seasonYear - right.transaction.seasonYear ||
          Number(left.transaction.occurredOn === null) -
            Number(right.transaction.occurredOn === null) ||
          (left.transaction.occurredOn ?? '').localeCompare(right.transaction.occurredOn ?? '') ||
          left.transaction.eventId.localeCompare(right.transaction.eventId) ||
          left.realization.realizationId.localeCompare(right.realization.realizationId)
      );
    const tradeIds = lineage.map(({ transaction }) => transaction.eventId);
    if (new Set(tradeIds).size !== tradeIds.length) {
      throw new Error(`Released draft selection ${selection.selectionId} repeats a trade lineage.`);
    }
    const transfer = lineage[0]?.transfer;
    const observations = selection.pickId ? (custodyByPick.get(selection.pickId) ?? []) : [];
    const custody = latestCustody(observations);
    const originalClub = transfer?.pick?.originalClub ?? custody?.originalClub ?? null;
    return {
      selectionId: selection.selectionId,
      eventId: event.eventId,
      eventVersionId: event.eventVersionId,
      year: event.seasonYear,
      draftKind: draftKind(event.draftKind),
      draftName: event.officialName,
      draftDate: event.occurredOn,
      ...(event.datePrecision ? { draftDatePrecision: event.datePrecision } : {}),
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
        status:
          lineage.length > 0
            ? 'linked_to_trade'
            : selection.pickId
              ? 'selection_only'
              : 'unresolved',
        edgeCount: lineage.length,
        tradeRefs: lineage.map(({ transaction }) => ({
          tradeId: transaction.eventId,
          year: transaction.seasonYear,
          title: transaction.officialName,
        })),
      },
    };
  });
}

export function createPostgresAflDraftHistoryRepository(dependencies: {
  archiveRepository: AflTradePromotionBackedPublicArchiveReadRepository;
}): AflDraftHistoryRepository {
  return {
    async listYears(selection): Promise<readonly AflDraftHistoryYearSummary[]> {
      const records = await dependencies.archiveRepository.listAllRecords(selection, {
        recordKinds: ['draft_event', 'draft_selection'],
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
      const draftRecords = await dependencies.archiveRepository.listAllRecords(selection, {
        recordKinds: ['draft_event', 'draft_selection', 'pick_custody'],
        seasonYear: year,
      });
      const pickIds = recordsByKind(draftRecords, 'draft_selection')
        .flatMap((record) => (record.pickId ? [record.pickId] : []))
        .sort();
      const pickRecords =
        pickIds.length > 0
          ? await dependencies.archiveRepository.listAllRecords(selection, {
              recordKinds: ['transfer', 'pick_realization'],
              pickIds,
            })
          : [];
      const eventVersionIds = recordsByKind(pickRecords, 'transfer')
        .map(({ eventVersionId }) => eventVersionId)
        .sort();
      const transactions =
        eventVersionIds.length > 0
          ? await dependencies.archiveRepository.listAllRecords(selection, {
              recordKinds: ['transaction'],
              eventVersionIds,
            })
          : [];
      return selectionRows([...draftRecords, ...pickRecords, ...transactions]);
    },
  };
}
