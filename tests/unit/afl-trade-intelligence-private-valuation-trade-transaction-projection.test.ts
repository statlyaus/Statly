import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradePromotionBackedPublicArchiveRecordInput } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';
import {
  PrivateValuationTradeTransactionUnsupportedError,
  projectPrivateValuationTradeTransaction,
} from '@/server/aflTradeIntelligence/valuation/internal/privateValuationTradeTransactionProjection';

const at = '2026-09-23T00:00:00.000Z';

const clubA = { clubId: 'club-a', name: 'Club A', abbreviation: 'CA' };
const clubB = { clubId: 'club-b', name: 'Club B', abbreviation: 'CB' };

const reference = (label: string) => createAflTradeCanonicalJsonArtifactRef({ label }, at);

function transfer(input: {
  recordId: string;
  assetKind: 'player' | 'current_pick' | 'cash';
  fromClub: typeof clubA;
  toClub: typeof clubA;
}): AflTradePromotionBackedPublicArchiveRecordInput {
  const base = {
    recordKind: 'transfer' as const,
    recordId: input.recordId,
    assetVersionId: input.recordId,
    eventVersionId: 'event-version-1',
    assetKey: `${input.recordId}-key`,
    rawDescription: `Moved by ${input.recordId}`,
    fromClub: input.fromClub,
    toClub: input.toClub,
  };
  if (input.assetKind === 'player') {
    return {
      ...base,
      assetKind: 'player' as const,
      player: { playerId: `${input.recordId}-player`, displayName: 'Some Player' },
      pick: null,
    };
  }
  if (input.assetKind === 'cash') {
    return { ...base, assetKind: 'cash' as const, player: null, pick: null };
  }
  return {
    ...base,
    assetKind: 'current_pick' as const,
    player: null,
    pick: {
      pickId: `${input.recordId}-pick`,
      draftSeasonYear: 2026,
      draftKind: 'national_draft',
      nominalRound: 2,
      nominalPick: 25,
      originalClub: null,
    },
  };
}

const transaction: AflTradePromotionBackedPublicArchiveRecordInput = {
  recordKind: 'transaction',
  recordId: 'trade-1',
  eventId: 'trade-1-event',
  eventVersionId: 'trade-1',
  seasonYear: 2025,
  occurredOn: '2025-10-09',
  officialName: 'Club A and Club B trade',
  transactionType: 'trade',
  parties: [
    { club: clubA, role: 'receiving', ordinal: 1 },
    { club: clubB, role: 'giving', ordinal: 2 },
  ],
};

const evidenceRefByRecordId = {
  'transfer-0001': reference('transfer-0001'),
  'transfer-0002': reference('transfer-0002'),
};

const records = [
  transaction,
  transfer({ recordId: 'transfer-0001', assetKind: 'player', fromClub: clubA, toClub: clubB }),
  transfer({
    recordId: 'transfer-0002',
    assetKind: 'current_pick',
    fromClub: clubB,
    toClub: clubA,
  }),
];

describe('private valuation trade transaction projection', () => {
  it('projects the exact participating clubs in ascending order and the directed transfers', () => {
    const projected = projectPrivateValuationTradeTransaction({ records, evidenceRefByRecordId });

    expect(projected.clubs).toEqual([
      { aflClubId: 'club-a', clubName: 'Club A' },
      { aflClubId: 'club-b', clubName: 'Club B' },
    ]);
    expect(projected.transfers).toEqual([
      {
        transferId: 'transfer-0001',
        assetId: 'transfer-0001-player',
        assetKind: 'player',
        fromClubId: 'club-a',
        toClubId: 'club-b',
        displayLabel: 'Moved by transfer-0001',
        evidenceRef: reference('transfer-0001'),
      },
      {
        transferId: 'transfer-0002',
        assetId: 'transfer-0002-pick',
        assetKind: 'current_pick_entitlement',
        fromClubId: 'club-b',
        toClubId: 'club-a',
        displayLabel: 'Moved by transfer-0002',
        evidenceRef: reference('transfer-0002'),
      },
    ]);
  });

  it('orders by whichever identity key lets both trace keys ascend', () => {
    const projected = projectPrivateValuationTradeTransaction({
      records: [transaction, records[2]!, records[1]!],
      evidenceRefByRecordId,
    });

    expect(projected.transfers.map(({ transferId }) => transferId)).toEqual([
      'transfer-0001',
      'transfer-0002',
    ]);
  });

  it('refuses an asset kind the trace cannot express instead of dropping it', () => {
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records: [
          transaction,
          records[1]!,
          transfer({
            recordId: 'transfer-0002',
            assetKind: 'cash',
            fromClub: clubB,
            toClub: clubA,
          }),
        ],
        evidenceRefByRecordId,
      })
    ).toThrow(PrivateValuationTradeTransactionUnsupportedError);
  });

  it('refuses a transfer whose retained evidence reference was not supplied', () => {
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records,
        evidenceRefByRecordId: { 'transfer-0001': reference('transfer-0001') },
      })
    ).toThrow(TypeError);
  });

  it('refuses a transaction party that moves no asset', () => {
    const withIdleParty: AflTradePromotionBackedPublicArchiveRecordInput = {
      ...transaction,
      parties: [
        ...transaction.parties,
        {
          club: { clubId: 'club-c', name: 'Club C', abbreviation: null },
          role: 'observer',
          ordinal: 3,
        },
      ],
    };
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records: [withIdleParty, records[1]!, records[2]!],
        evidenceRefByRecordId,
      })
    ).toThrow(TypeError);
  });

  it('refuses a transfer moving through a club the transaction does not name', () => {
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records: [
          transaction,
          records[1]!,
          transfer({
            recordId: 'transfer-0002',
            assetKind: 'current_pick',
            fromClub: { clubId: 'club-z', name: 'Club Z', abbreviation: null },
            toClub: clubA,
          }),
        ],
        evidenceRefByRecordId,
      })
    ).toThrow(TypeError);
  });

  it('refuses a trade without exactly one transaction record', () => {
    expect(() =>
      projectPrivateValuationTradeTransaction({ records: records.slice(1), evidenceRefByRecordId })
    ).toThrow(TypeError);
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records: [transaction, transaction, records[1]!, records[2]!],
        evidenceRefByRecordId,
      })
    ).toThrow(TypeError);
  });

  it('refuses a trade that moves fewer than two assets', () => {
    expect(() =>
      projectPrivateValuationTradeTransaction({
        records: [transaction, records[1]!],
        evidenceRefByRecordId,
      })
    ).toThrow(TypeError);
  });
});
