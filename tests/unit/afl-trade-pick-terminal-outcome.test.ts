import { describe, expect, it } from 'vitest';

import { nonPlayerPickOutcomeSchema } from '@/server/aflTradeIntelligence/source/nonPlayerPickOutcome';
import { pickTerminalOutcomeSchema } from '@/server/aflTradeIntelligence/source/pickTerminalOutcome';
import { aflTradePromotionBackedPublicArchiveRecordInputSchema } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';

const elevation = {
  kind: 'rookie_elevation',
  playerId: `player:${'a'.repeat(64)}`,
  recordedPlayerName: 'Kyal Horsley',
  exercisingClubId: `club:${'b'.repeat(64)}`,
  draftYear: 2012,
  draftType: 'national',
  livePick: 55,
};

describe('pick terminal outcomes', () => {
  it('retains elevation in the archive with no selection and rejects inconsistent realization kinds', () => {
    const record = {
      recordKind: 'pick_realization',
      recordId: 'realization-fixture',
      realizationId: 'realization-fixture',
      pickId: 'pick-fixture',
      transferAssetVersionId: 'asset-fixture',
      draftSelectionId: null,
      relationKind: 'rookie_elevation',
      terminalOutcome: elevation,
    };
    expect(aflTradePromotionBackedPublicArchiveRecordInputSchema.parse(record)).toEqual(record);
    for (const change of [{ draftSelectionId: 'invented' }, { relationKind: 'exercised_as' }, { relationKind: 'passed' }]) {
      expect(aflTradePromotionBackedPublicArchiveRecordInputSchema.safeParse({ ...record, ...change }).success).toBe(false);
    }
  });
  it('preserves player-bearing elevation without treating it as a non-player outcome', () => {
    expect(pickTerminalOutcomeSchema.parse(elevation)).toEqual(elevation);
    expect(nonPlayerPickOutcomeSchema.safeParse(elevation).success).toBe(false);
  });

  it('requires resolved identity and endpoint fields before accepting an elevation', () => {
    for (const field of Object.keys(elevation)) {
      const missing = { ...elevation } as Record<string, unknown>;
      delete missing[field];
      expect(pickTerminalOutcomeSchema.safeParse(missing).success, field).toBe(false);
      expect(
        pickTerminalOutcomeSchema.safeParse({ ...elevation, [field]: null }).success,
        field
      ).toBe(false);
    }
    for (const field of ['playerId', 'recordedPlayerName', 'exercisingClubId', 'draftType']) {
      expect(pickTerminalOutcomeSchema.safeParse({ ...elevation, [field]: ' ' }).success).toBe(false);
    }
    for (const livePick of [0, -1, 1.5]) {
      expect(pickTerminalOutcomeSchema.safeParse({ ...elevation, livePick }).success).toBe(false);
    }
  });

  it('rejects fabricated selection fields and misplaced trade-time numbering', () => {
    for (const extra of [{ selectionId: 'invented' }, { draftSelectionId: 'invented' }, { acceptedTradeTimePick: 57 }]) {
      expect(pickTerminalOutcomeSchema.safeParse({ ...elevation, ...extra }).success).toBe(false);
    }
  });

  it('preserves existing non-player terminal variants', () => {
    const outcomes = [
      { kind: 'passed', draftYear: 2012, draftType: 'national', livePick: 55 },
      { kind: 'not_exercised', draftYear: 2012, draftType: 'national', recordedPick: 57 },
      { kind: 'incorporated_into_later_package', onwardTransactionIds: [], packageDescription: 'Retained reviewed package' },
    ];
    for (const outcome of outcomes) {
      expect(pickTerminalOutcomeSchema.parse(outcome)).toEqual(nonPlayerPickOutcomeSchema.parse(outcome));
    }
  });
});
