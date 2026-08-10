import { describe, expect, it } from 'vitest';

import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  createAflTradePromotionBackedFactualRelease,
  type AflTradePromotionBackedFactualCandidate,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import {
  createAflTradePromotionBackedPublicArchive,
  parseAflTradePromotionBackedPublicArchive,
  type AflTradePromotionBackedPublicArchiveRecordInput,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';

const sha = (value: string) => value.repeat(64);
const ids = {
  transaction: `event-version:${sha('1')}`,
  transfer: `asset-version:${sha('2')}`,
  draftEvent: `event-version:${sha('3')}`,
  selection: `draft-selection:${sha('4')}`,
  draftPlayerAsset: `asset-version:${sha('e')}`,
  custody: `pick-custody:${sha('5')}`,
  realization: `pick-realization:${sha('6')}`,
  event: `event:${sha('7')}`,
  draftEventId: `event:${sha('8')}`,
  pick: `draft-pick:${sha('9')}`,
  player: `player:${sha('a')}`,
  carlton: `club:${sha('b')}`,
  fremantle: `club:${sha('c')}`,
} as const;

const carlton = { clubId: ids.carlton, name: 'Carlton', abbreviation: 'CAR' } as const;
const fremantle = {
  clubId: ids.fremantle,
  name: 'Fremantle',
  abbreviation: 'FRE',
} as const;
const pick = {
  pickId: ids.pick,
  draftSeasonYear: 2025,
  draftKind: 'national_draft',
  nominalRound: 1,
  nominalPick: 14,
  originalClub: fremantle,
} as const;

function records(): AflTradePromotionBackedPublicArchiveRecordInput[] {
  return [
    {
      recordKind: 'transaction',
      recordId: ids.transaction,
      eventId: ids.event,
      eventVersionId: ids.transaction,
      seasonYear: 2024,
      occurredOn: '2024-10-16',
      officialName: '2024 Trade for future pick 14',
      transactionType: 'trade',
      parties: [
        { club: carlton, role: 'party', ordinal: 1 },
        { club: fremantle, role: 'party', ordinal: 2 },
      ],
    },
    {
      recordKind: 'transfer',
      recordId: ids.transfer,
      assetVersionId: ids.transfer,
      eventVersionId: ids.transaction,
      assetKey: 'future-pick-2025-r1-fremantle',
      assetKind: 'future_pick',
      rawDescription: 'Fremantle 2025 first-round pick',
      player: null,
      pick,
      fromClub: fremantle,
      toClub: carlton,
    },
    {
      recordKind: 'draft_event',
      recordId: ids.draftEvent,
      eventId: ids.draftEventId,
      eventVersionId: ids.draftEvent,
      seasonYear: 2025,
      occurredOn: '2025-11-19',
      officialName: '2025 AFL National Draft',
      draftKind: 'national_draft',
    },
    {
      recordKind: 'draft_selection',
      recordId: ids.selection,
      selectionId: ids.selection,
      eventVersionId: ids.draftEvent,
      selectionNumber: 14,
      pickId: ids.pick,
      player: { playerId: ids.player, displayName: 'Harry Kyle' },
      club: carlton,
    },
    {
      recordKind: 'draft_player_asset',
      recordId: ids.draftPlayerAsset,
      assetVersionId: ids.draftPlayerAsset,
      eventVersionId: ids.draftEvent,
      assetKey: 'selected-player-harry-kyle',
      assetKind: 'player',
      rawDescription: 'Selected with pick 14',
      player: { playerId: ids.player, displayName: 'Harry Kyle' },
      pick: null,
      club: carlton,
    },
    {
      recordKind: 'pick_custody',
      recordId: ids.custody,
      custodyObservationId: ids.custody,
      pickId: ids.pick,
      observedAt: '2025-11-19T00:00:00.000Z',
      draftSeasonYear: 2025,
      draftKind: 'national_draft',
      recordedRound: 1,
      recordedPick: 14,
      originalClub: fremantle,
      currentClub: carlton,
    },
    {
      recordKind: 'pick_realization',
      recordId: ids.realization,
      realizationId: ids.realization,
      pickId: ids.pick,
      transferAssetVersionId: ids.transfer,
      draftSelectionId: ids.selection,
      relationKind: 'exercised_as',
    },
  ];
}

function candidate(): AflTradePromotionBackedFactualCandidate {
  const promotionId = `external-canonical-promotion:${sha('d')}`;
  const sourceRecords = records();
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:02.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:01.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: sha('d'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:00.000Z',
        promotionRecordCount: sourceRecords.length,
      },
    ],
    members: sourceRecords.map((record, index) => ({
      promotionId,
      recordKind: record.recordKind,
      sourceRecordId: `source:${index + 1}`,
      canonicalRecordId: record.recordId,
      recordSha256: String(index + 1).repeat(64),
    })),
  });
  return createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes',
    createdAt: '2026-08-10T00:00:03.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:fixture',
        sourceSnapshotId: `source-snapshot:${sha('e')}`,
        rightsArtifactId: `source-rights:${sha('f')}`,
        gateDecisionId: `gate-decision:${sha('0')}`,
        recordSha256: sha('a'),
        recordedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:fixture'] }],
    canonicalMembers: sourceRecords.map((record, index) => ({
      recordKind: record.recordKind,
      canonicalRecordId: record.recordId,
      canonicalRecordSha256: String(index + 1).repeat(64),
    })),
  }).candidate;
}

function archive() {
  return createAflTradePromotionBackedPublicArchive({
    candidate: candidate(),
    createdAt: '2026-08-10T00:00:04.000Z',
    records: records(),
  });
}

describe('promotion-backed public factual archive', () => {
  it('seals a deterministic complete transaction-to-selection record set', () => {
    const result = archive();
    expect(parseAflTradePromotionBackedPublicArchive(result)).toEqual(result);
    expect(archive()).toEqual(result);
    expect(result.content.recordCount).toBe(7);
    expect(result.content.recordCounts).toMatchObject({
      transaction: 1,
      transfer: 1,
      draft_event: 1,
      draft_selection: 1,
      draft_player_asset: 1,
      pick_custody: 1,
      pick_realization: 1,
    });
    expect(result.content.canonicalMemberSetSha256).toBe(
      candidate().content.canonicalMemberSetSha256
    );
  });

  it('rejects omitted, substituted, or orphaned public facts', () => {
    const input = records();
    expect(() =>
      createAflTradePromotionBackedPublicArchive({
        candidate: candidate(),
        createdAt: '2026-08-10T00:00:04.000Z',
        records: input.slice(1),
      })
    ).toThrow(/exactly cover/i);

    const realization = input.find(({ recordKind }) => recordKind === 'pick_realization');
    if (!realization || realization.recordKind !== 'pick_realization') throw new Error('fixture');
    expect(() =>
      createAflTradePromotionBackedPublicArchive({
        candidate: candidate(),
        createdAt: '2026-08-10T00:00:04.000Z',
        records: input.map((record) =>
          record === realization ? { ...record, pickId: `draft-pick:${sha('f')}` } : record
        ),
      })
    ).toThrow(/endpoints/i);
  });

  it('rejects record, canonical digest, and root tampering', () => {
    const result = archive();
    for (const changed of [
      {
        ...result,
        content: {
          ...result.content,
          records: result.content.records.map((row, index) =>
            index === 0 ? { ...row, canonicalRecordSha256: sha('f') } : row
          ),
        },
      },
      { ...result, content: { ...result.content, recordSetSha256: sha('f') } },
    ]) {
      expect(() => parseAflTradePromotionBackedPublicArchive(changed)).toThrow();
    }
  });

  it('contains factual AFL records only, with no grade, valuation, user, or fantasy ownership', () => {
    const serialized = JSON.stringify(archive().content.records);
    expect(serialized).not.toMatch(/grade|valuation|userId|leagueId|fantasy|workbook/i);
  });
});
