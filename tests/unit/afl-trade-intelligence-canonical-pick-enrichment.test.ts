import { describe, expect, it } from 'vitest';

import { planPickEnrichment } from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';

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
});
