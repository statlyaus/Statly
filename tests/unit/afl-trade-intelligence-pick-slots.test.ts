import { describe, expect, it } from 'vitest';

import type { AflTradeGradingInputs } from '@/server/aflTradeIntelligence/valuation/gradingInputs';
import {
  aflTradeBoardPreDraftSlotOf,
  aflTradePickOrderSlotOf,
  type AflTradePickAsset,
  type AflTradePickCustody,
} from '@/server/aflTradeIntelligence/valuation/pickSlots';

/**
 * A pick's slot from the Official AFL order (rule v6) and from a reviewed Footyinfo board's stated
 * pre-draft number (rule v19), the two lookups the value lines and the asset ledger share
 * (statlyaus/Statly#789).
 */
type Board = NonNullable<AflTradeGradingInputs['candidate']['draftBoardPicks']>[number];

const asset = (overrides: Partial<AflTradePickAsset> = {}): AflTradePickAsset => ({
  kind: 'pick_entitlement',
  pickId: 'pick-2026-r1-carlton',
  draftYear: 2026,
  draftType: 'national',
  nominalRound: 1,
  nominalPick: null,
  originalClubId: 'carlton',
  recordedLabel: null,
  ...overrides,
});
const custody = (
  custodyId: string,
  overrides: Partial<Record<keyof AflTradePickCustody, unknown>> = {}
): AflTradePickCustody =>
  ({
    custodyId,
    pickId: 'pick-2026-r1-carlton',
    observedAt: '2026-09-01T00:00:00.000Z',
    draftYear: 2026,
    draftType: 'national',
    roundNumber: 1,
    recordedPickNumber: 7,
    originalClubId: 'carlton',
    currentClubId: 'carlton',
    status: 'single_source',
    evidenceIds: [],
    ...overrides,
  }) as unknown as AflTradePickCustody;
const board = (boardPickId: string, overrides: Partial<Record<keyof Board, unknown>> = {}) =>
  ({
    boardPickId,
    draftYear: 2026,
    draftType: 'national',
    roundNumber: 1,
    originalClubId: 'carlton',
    originalNumber: 9,
    status: 'passed',
    evidenceIds: [],
    ...overrides,
  }) as unknown as Board;

describe('a pick’s slot in the Official AFL order (rule v6)', () => {
  it('reads the latest usable capture of its own draft, by pick id or by entitlement', () => {
    const rows = [
      custody('cu-old', { observedAt: '2026-08-01T00:00:00.000Z', recordedPickNumber: 9 }),
      custody('cu-new', { pickId: 're-keyed', recordedPickNumber: 7 }),
    ];
    expect(aflTradePickOrderSlotOf(rows, asset())).toEqual({
      custody: rows[1],
      selectionNumber: 7,
      proxy: false,
    });
  });

  it('never lets an older usable capture override a newer disputed or unnumbered one', () => {
    const older = custody('cu-old', { observedAt: '2026-08-01T00:00:00.000Z' });
    expect(
      aflTradePickOrderSlotOf([older, custody('cu-new', { status: 'disputed' })], asset())
    ).toBeUndefined();
    expect(
      aflTradePickOrderSlotOf([older, custody('cu-new', { recordedPickNumber: null })], asset())
    ).toBeUndefined();
  });

  it('takes the previous draft’s order as a proxy only when its own draft has none', () => {
    const previous = custody('cu-2025', { pickId: 'pick-2025-r1-carlton', draftYear: 2025 });
    expect(aflTradePickOrderSlotOf([previous], asset())).toMatchObject({
      selectionNumber: 7,
      proxy: true,
    });
    // Its own draft has an order that does not name it: no proxy.
    const otherClub = custody('cu-own', { pickId: 'other', originalClubId: 'essendon' });
    expect(aflTradePickOrderSlotOf([previous, otherClub], asset())).toBeUndefined();
    // A pick with no original club matches only by pick id, so it never proxies.
    expect(aflTradePickOrderSlotOf([previous], asset({ originalClubId: null }))).toBeUndefined();
  });

  it('gives no slot outside HPN’s 1 to 90 or outside the national draft', () => {
    expect(
      aflTradePickOrderSlotOf([custody('cu-1', { recordedPickNumber: 91 })], asset())
    ).toBeUndefined();
    expect(
      aflTradePickOrderSlotOf([custody('cu-1')], asset({ draftType: 'rookie' }))
    ).toBeUndefined();
  });
});

describe('a pick’s pre-draft number on a reviewed Footyinfo board (rule v19)', () => {
  it('reads the one passed or removed board pick of its entitlement', () => {
    expect(aflTradeBoardPreDraftSlotOf([board('b-1')], asset())).toEqual({
      boardPickId: 'b-1',
      selectionNumber: 9,
    });
    expect(
      aflTradeBoardPreDraftSlotOf([board('b-1', { status: 'removed' })], asset())
    ).toMatchObject({ selectionNumber: 9 });
  });

  it('gives none for a selected, missing, duplicated or out-of-domain board pick', () => {
    expect(
      aflTradeBoardPreDraftSlotOf([board('b-1', { status: 'selected' })], asset())
    ).toBeUndefined();
    expect(aflTradeBoardPreDraftSlotOf([board('b-1'), board('b-2')], asset())).toBeUndefined();
    expect(
      aflTradeBoardPreDraftSlotOf([board('b-1', { originalNumber: null })], asset())
    ).toBeUndefined();
    expect(
      aflTradeBoardPreDraftSlotOf([board('b-1', { originalNumber: 91 })], asset())
    ).toBeUndefined();
    expect(
      aflTradeBoardPreDraftSlotOf([board('b-1')], asset({ originalClubId: null }))
    ).toBeUndefined();
  });
});
