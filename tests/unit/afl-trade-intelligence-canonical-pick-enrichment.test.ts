import { describe, expect, it } from 'vitest';

import {
  planPickEnrichment,
  resolveWrittenPickDefinitions,
} from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';

const stored = {
  pick_id: 'draft-pick:fixture',
  draft_season_year: 2021,
  draft_kind: 'national_draft',
  nominal_round: null,
  nominal_pick: null,
  original_club_id: null,
  status: 'approved',
  enrichment_id: null,
  enrichment_version: null,
};
const definition = {
  pickId: 'draft-pick:fixture',
  draftYear: 2021,
  draftType: 'national',
  draftKind: 'national_draft',
  nominalRound: 2,
  nominalPick: null,
  originalClubId: 'club-gws',
};

describe('canonical pick enrichment planning', () => {
  it('fills only empty stored facts and keeps every known value', () => {
    expect(planPickEnrichment(stored, definition)).toEqual({
      kind: 'enrich',
      facts: { nominalRound: 2, nominalPick: null, originalClubId: 'club-gws' },
    });
    expect(
      planPickEnrichment({ ...stored, nominal_round: 2, original_club_id: 'club-gws' }, definition)
    ).toEqual({ kind: 'exact' });
    expect(
      planPickEnrichment({ ...stored, nominal_pick: 27 }, { ...definition, nominalPick: 27 })
    ).toEqual({
      kind: 'enrich',
      facts: { nominalRound: 2, nominalPick: 27, originalClubId: 'club-gws' },
    });
  });

  it('keeps differing, omitted or out-of-scope facts immutable conflicts', () => {
    expect(planPickEnrichment({ ...stored, nominal_round: 3 }, definition)).toEqual({
      kind: 'conflict',
    });
    expect(planPickEnrichment({ ...stored, nominal_pick: 13 }, definition)).toEqual({
      kind: 'conflict',
    });
    expect(planPickEnrichment(stored, { ...definition, draftYear: 2020 })).toEqual({
      kind: 'conflict',
    });
    expect(planPickEnrichment(stored, { ...definition, draftKind: 'rookie_draft' })).toEqual({
      kind: 'conflict',
    });
    expect(planPickEnrichment({ ...stored, status: 'withdrawn' }, definition)).toEqual({
      kind: 'conflict',
    });
  });

  // A completed draft session states no round, number or original club (#853): a pick only
  // selections define references a stored pick as it stands, even one an earlier trade promotion
  // stored with facts, while a definition that asserts facts keeps every conflict.
  it('references a stored pick unchanged for a definition that asserts no facts', () => {
    const tradeStored = {
      ...stored,
      nominal_round: 1,
      nominal_pick: 7,
      original_club_id: 'club-gws',
    };
    const selectionOnly = { ...definition, nominalRound: null, originalClubId: null };
    expect(planPickEnrichment(tradeStored, selectionOnly, { assertsFacts: false })).toEqual({
      kind: 'exact',
    });
    expect(planPickEnrichment(stored, selectionOnly, { assertsFacts: false })).toEqual({
      kind: 'exact',
    });
    // The same empty definition asserting its facts still omits known ones: a conflict.
    expect(planPickEnrichment(tradeStored, selectionOnly)).toEqual({ kind: 'conflict' });
    expect(planPickEnrichment(tradeStored, selectionOnly, { assertsFacts: true })).toEqual({
      kind: 'conflict',
    });
    // A differing asserted fact is a conflict, and draft scope and status are checked regardless.
    expect(
      planPickEnrichment(tradeStored, { ...definition, nominalRound: 1, nominalPick: 8 })
    ).toEqual({ kind: 'conflict' });
    for (const [resolved, scoped] of [
      [tradeStored, { ...selectionOnly, draftYear: 2020 }],
      [tradeStored, { ...selectionOnly, draftKind: 'rookie_draft' }],
      [{ ...tradeStored, status: 'withdrawn' }, selectionOnly],
    ] as const) {
      expect(planPickEnrichment(resolved, scoped, { assertsFacts: false })).toEqual({
        kind: 'conflict',
      });
    }
    expect(() => planPickEnrichment(tradeStored, definition, { assertsFacts: false })).toThrow(
      /asserts no pick facts/
    );
  });

  it('lists a pick as selection-only only when no written transfer or custody row defines it', () => {
    const pick = (suffix: string) => `draft-pick:${suffix.repeat(64)}`;
    const selection = (pickId: string) => ({ pickId, draftYear: 2025, draftType: 'national' });
    const content = {
      transfers: [
        {
          asset: {
            kind: 'pick_entitlement',
            pickId: pick('1'),
            draftYear: 2025,
            draftType: 'national',
            nominalRound: 1,
            nominalPick: 7,
            originalClubId: 'club-gws',
          },
        },
      ],
      draftSelections: [selection(pick('1')), selection(pick('2')), selection(pick('3'))],
      pickCustody: [
        { pickId: pick('3'), draftYear: 2025, draftType: 'national', originalClubId: 'club-gws' },
      ],
    } as unknown as Parameters<typeof resolveWrittenPickDefinitions>[0];
    const resolved = resolveWrittenPickDefinitions(content, {
      deferred: false,
      definitionCustody: [],
    });
    expect(resolved.selectionOnlyPickIds).toEqual([pick('2')]);
    expect(resolved.definitions.get(pick('2'))).toEqual({
      pickId: pick('2'),
      draftYear: 2025,
      draftType: 'national',
      nominalRound: null,
      nominalPick: null,
      originalClubId: null,
    });
    expect(resolved.definitions.get(pick('1'))).toMatchObject({ nominalPick: 7 });
  });
});
