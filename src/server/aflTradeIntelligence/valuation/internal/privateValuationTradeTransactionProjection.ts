import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { aflTradePromotionBackedPublicArchiveRecordSchema } from '../../outcomes/promotionBackedPublicArchiveContracts';

type ArchiveRecord = z.infer<typeof aflTradePromotionBackedPublicArchiveRecordSchema>['record'];

/**
 * The trace vocabulary carries three asset kinds; a promoted trade may also contain cash, list
 * rights or other consideration. Those cannot be expressed in an input trace, so the projection
 * refuses rather than dropping them, which would silently value a different trade than the one the
 * release sealed.
 */
export class PrivateValuationTradeTransactionUnsupportedError extends TypeError {
  readonly code = 'PRIVATE_VALUATION_TRADE_TRANSACTION_UNSUPPORTED';
}

export type PrivateValuationTradeClubs = readonly Readonly<{
  aflClubId: string;
  clubName: string;
}>[];

export type PrivateValuationTradeTransfers = readonly Readonly<{
  transferId: string;
  assetId: string;
  assetKind: 'player' | 'current_pick_entitlement' | 'future_pick_entitlement';
  fromClubId: string;
  toClubId: string;
  displayLabel: string;
  evidenceRef: AflTradeArtifactRef;
}>[];

const TRACE_ASSET_KIND: Readonly<
  Record<string, PrivateValuationTradeTransfers[number]['assetKind']>
> = {
  player: 'player',
  current_pick: 'current_pick_entitlement',
  future_pick: 'future_pick_entitlement',
};

/**
 * Projects one promoted trade's archive records into the club and transfer vocabulary an input trace
 * uses.
 *
 * The trace schema is stricter than it looks and this projection satisfies it rather than trusting
 * the caller to: `transaction.clubs` must equal the exact set of clubs participating in the directed
 * transfers in ascending club order, and the transfer list must ascend by both `transferId` and
 * `assetId`. A trade whose records cannot satisfy that is refused instead of silently reordered.
 *
 * Every mapped transfer must also name the retained artifact that proves its archive record: the
 * caller owns custody, so it supplies the reference and this projection never invents one.
 */
export function projectPrivateValuationTradeTransaction(input: {
  readonly records: readonly ArchiveRecord[];
  readonly evidenceRefByRecordId: Readonly<Record<string, AflTradeArtifactRef>>;
}): Readonly<{
  clubs: PrivateValuationTradeClubs;
  transfers: PrivateValuationTradeTransfers;
}> {
  const transactions = input.records.filter(({ recordKind }) => recordKind === 'transaction');
  if (transactions.length !== 1 || transactions[0]?.recordKind !== 'transaction') {
    throw new TypeError('A promoted trade requires exactly one transaction record.');
  }
  const transaction = transactions[0];
  const transfers: PrivateValuationTradeTransfers[number][] = [];
  for (const record of input.records) {
    if (record.recordKind !== 'transfer') continue;
    const assetKind = TRACE_ASSET_KIND[record.assetKind];
    if (assetKind === undefined) {
      throw new PrivateValuationTradeTransactionUnsupportedError(
        `Asset kind ${record.assetKind} cannot be expressed in an input trace.`
      );
    }
    const assetId = record.player?.playerId ?? record.pick?.pickId;
    if (assetId === undefined) {
      throw new TypeError('A promoted transfer must name the player or pick asset it moved.');
    }
    const evidenceRef = input.evidenceRefByRecordId[record.recordId];
    if (evidenceRef === undefined) {
      throw new TypeError(
        `Promoted transfer ${record.recordId} was not supplied with its retained evidence reference.`
      );
    }
    transfers.push({
      transferId: record.recordId,
      assetId,
      assetKind,
      fromClubId: record.fromClub.clubId,
      toClubId: record.toClub.clubId,
      displayLabel: record.rawDescription,
      evidenceRef: aflTradeArtifactRefSchema.parse(evidenceRef),
    });
  }
  if (transfers.length < 2) {
    throw new TypeError('A promoted trade must move at least two assets between its clubs.');
  }
  // The trace requires the transfer array to ascend by both `transferId` and `assetId`. Either key
  // may impose the order, so try both and refuse only when neither can satisfy it.
  const ascends = (values: readonly string[]): boolean =>
    values.every((value, index) => index === 0 || values[index - 1]! < value);
  const byAsset = [...transfers].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const byTransfer = [...transfers].sort((left, right) =>
    left.transferId.localeCompare(right.transferId)
  );
  const ordered = [byAsset, byTransfer].find(
    (candidate) =>
      ascends(candidate.map(({ transferId }) => transferId)) &&
      ascends(candidate.map(({ assetId }) => assetId))
  );
  if (ordered === undefined) {
    throw new TypeError(
      'Promoted trade transfers cannot ascend by asset and transfer identity at once.'
    );
  }
  const clubById = new Map<string, string>();
  for (const transfer of ordered) {
    for (const clubId of [transfer.fromClubId, transfer.toClubId]) {
      const party = transaction.parties.find(({ club }) => club.clubId === clubId);
      if (party === undefined) {
        throw new TypeError(
          `Promoted transfer ${transfer.transferId} moves through a club the transaction does not name.`
        );
      }
      clubById.set(clubId, party.club.name);
    }
  }
  for (const party of transaction.parties) {
    if (!clubById.has(party.club.clubId)) {
      throw new TypeError(
        `Transaction party ${party.club.clubId} moves no asset, so the trace cannot name it.`
      );
    }
  }
  const clubs: PrivateValuationTradeClubs = [...clubById.entries()]
    .map(([aflClubId, clubName]) => ({ aflClubId, clubName }))
    .sort((left, right) => left.aflClubId.localeCompare(right.aflClubId));
  if (clubs.length > 4) {
    throw new TypeError('A promoted trade cannot involve more than four distinct clubs.');
  }
  return { clubs, transfers: ordered };
}
