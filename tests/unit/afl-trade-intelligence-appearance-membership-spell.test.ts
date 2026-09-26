import { describe, expect, it } from 'vitest';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  aflTradeAcquisitionSpellRegistrationRuleSchema,
  aflTradeAcquisitionSpellRegistrationSchema,
  createAflTradeAppearanceMembershipSpell,
  createAflTradeAppearanceMembershipSpellRule,
  deriveAflTradeAcquisitionMembershipBounds,
  isAflTradeAppearanceMembershipSpell,
} from '@/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import {
  deriveAflTradeAppearanceMembershipSpells,
  type AflTradeAppearanceFactForMembership,
} from '@/server/aflTradeIntelligence/outcomes/appearanceMembershipSpellDerivation';

const evidence = createAflTradeCanonicalJsonArtifactRef(
  { syntheticRuleRationale: 'Season PAV attribution from reviewed appearances only' },
  '2026-09-10T00:00:00.000Z'
);
const rule = createAflTradeAppearanceMembershipSpellRule({
  environment: 'non_production',
  competition: 'AFLM',
  ruleVersion: 'synthetic-appearance-membership-v1',
  evidence: [evidence],
  createdAt: '2026-09-10T00:00:01.000Z',
});

function spellInput() {
  return {
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    playerId: 'player:one',
    clubId: 'club:one',
    seasonYear: 2021,
    firstAppearance: { appearanceFactId: 'fact:first', matchId: 'match:r1', date: '2021-03-20' },
    lastAppearance: { appearanceFactId: 'fact:last', matchId: 'match:r23', date: '2021-08-21' },
    ruleId: rule.ruleId,
    version: 1,
    supersedesSpellVersionId: null,
    createdAt: '2026-09-10T00:00:02.000Z',
  };
}

function fact(
  overrides: Partial<AflTradeAppearanceFactForMembership> & { appearanceFactId: string }
): AflTradeAppearanceFactForMembership {
  return {
    playerId: 'player:one',
    clubId: 'club:one',
    matchId: 'match:' + overrides.appearanceFactId,
    competition: 'AFLM',
    seasonYear: 2021,
    effectiveAt: '2021-05-01T09:30:00.000Z',
    availability: 'measured',
    appeared: true,
    ...overrides,
  };
}

describe('appearance-membership acquisition contracts', () => {
  it('fixes the purpose limit and retirement rule into the content-addressed rule', () => {
    expect(rule.content).toMatchObject({
      schemaVersion: 'afl-trade-acquisition-registration-rule/v3',
      purpose: 'hpn_season_pav_attribution_only',
      retirement: 'superseded_by_reviewed_entry_spell_for_same_player_club',
      missingEvidence: 'reject_rows_outside_reviewed_appearance_window',
    });
    expect(aflTradeAcquisitionSpellRegistrationRuleSchema.parse(rule)).toEqual(rule);
    expect(() =>
      aflTradeAcquisitionSpellRegistrationRuleSchema.parse({
        ...rule,
        content: { ...rule.content, purpose: 'trade_attribution' },
      })
    ).toThrow();
  });

  it('binds one season window to its first and last appearance and observes through the last', () => {
    const spell = createAflTradeAppearanceMembershipSpell(spellInput());
    expect(spell.content.observedThrough).toBe('2021-08-21');
    expect(isAflTradeAppearanceMembershipSpell(spell)).toBe(true);
    expect(aflTradeAcquisitionSpellRegistrationSchema.parse(spell)).toEqual(spell);
    expect(deriveAflTradeAcquisitionMembershipBounds(spell)).toEqual({
      exactStartDate: '2021-03-20',
      exactEndDate: '2021-08-21',
      observedThrough: '2021-08-21',
      possible: { startDate: '2021-03-20', endDate: '2021-08-21' },
      certain: { startDate: '2021-03-20', endDate: '2021-08-21' },
    });
  });

  it('rejects windows that are reversed, cross a season, or postdate their record', () => {
    expect(() =>
      createAflTradeAppearanceMembershipSpell({
        ...spellInput(),
        firstAppearance: { ...spellInput().firstAppearance, date: '2021-09-01' },
      })
    ).toThrow('chronology');
    expect(() =>
      createAflTradeAppearanceMembershipSpell({
        ...spellInput(),
        lastAppearance: { ...spellInput().lastAppearance, date: '2022-03-19' },
      })
    ).toThrow('chronology');
    expect(() =>
      createAflTradeAppearanceMembershipSpell({
        ...spellInput(),
        createdAt: '2021-08-20T00:00:00.000Z',
      })
    ).toThrow('chronology');
    const spell = createAflTradeAppearanceMembershipSpell(spellInput());
    expect(() =>
      aflTradeAcquisitionSpellRegistrationSchema.parse({
        ...spell,
        content: { ...spell.content, observedThrough: '2021-09-30' },
      })
    ).toThrow();
  });
});

describe('deriving appearance-membership spells', () => {
  const base = {
    environment: 'non_production' as const,
    competition: 'AFLM' as const,
    seasonYear: 2021,
    ruleId: rule.ruleId,
    createdAt: '2026-09-10T00:00:02.000Z',
  };

  it('proposes one spell per player and club spanning the first and last measured appearance', () => {
    const spells = deriveAflTradeAppearanceMembershipSpells({
      ...base,
      facts: [
        fact({ appearanceFactId: 'b', effectiveAt: '2021-06-12T09:30:00.000Z' }),
        fact({ appearanceFactId: 'a', effectiveAt: '2021-03-20T08:40:00.000Z' }),
        fact({ appearanceFactId: 'c', effectiveAt: '2021-08-21T04:10:00.000Z' }),
        fact({ appearanceFactId: 'z', clubId: 'club:two', playerId: 'player:two' }),
      ],
    });
    expect(spells).toHaveLength(2);
    expect(spells[0]!.content).toMatchObject({
      playerId: 'player:one',
      clubId: 'club:one',
      firstAppearance: { appearanceFactId: 'a', date: '2021-03-20' },
      lastAppearance: { appearanceFactId: 'c', date: '2021-08-21' },
    });
    expect(spells[1]!.content).toMatchObject({ playerId: 'player:two', clubId: 'club:two' });
  });

  it('ignores non-appearances rather than inferring membership from them', () => {
    const spells = deriveAflTradeAppearanceMembershipSpells({
      ...base,
      facts: [
        fact({ appearanceFactId: 'a', effectiveAt: '2021-04-01T09:30:00.000Z' }),
        fact({ appearanceFactId: 'b', effectiveAt: '2021-03-20T09:30:00.000Z', appeared: false }),
        fact({
          appearanceFactId: 'c',
          effectiveAt: '2021-09-01T09:30:00.000Z',
          availability: 'missing',
        }),
        fact({ appearanceFactId: 'd', playerId: 'player:bench', appeared: false }),
      ],
    });
    expect(spells).toHaveLength(1);
    expect(spells[0]!.content).toMatchObject({
      firstAppearance: { appearanceFactId: 'a' },
      lastAppearance: { appearanceFactId: 'a' },
    });
  });

  it('is deterministic under input order and breaks same-day ties by match and fact', () => {
    const facts = [
      fact({ appearanceFactId: 'b', matchId: 'match:2', effectiveAt: '2021-04-01T09:30:00.000Z' }),
      fact({ appearanceFactId: 'a', matchId: 'match:1', effectiveAt: '2021-04-01T02:30:00.000Z' }),
    ];
    const forward = deriveAflTradeAppearanceMembershipSpells({ ...base, facts });
    const reversed = deriveAflTradeAppearanceMembershipSpells({
      ...base,
      facts: [...facts].reverse(),
    });
    expect(reversed).toEqual(forward);
    expect(forward[0]!.content).toMatchObject({
      firstAppearance: { appearanceFactId: 'a' },
      lastAppearance: { appearanceFactId: 'b' },
    });
  });

  it('rejects duplicate facts and facts outside the requested season or competition', () => {
    expect(() =>
      deriveAflTradeAppearanceMembershipSpells({
        ...base,
        facts: [fact({ appearanceFactId: 'a' }), fact({ appearanceFactId: 'a' })],
      })
    ).toThrow('more than once');
    expect(() =>
      deriveAflTradeAppearanceMembershipSpells({
        ...base,
        facts: [fact({ appearanceFactId: 'a', seasonYear: 2022 })],
      })
    ).toThrow('outside');
    expect(() =>
      deriveAflTradeAppearanceMembershipSpells({
        ...base,
        facts: [fact({ appearanceFactId: 'a', effectiveAt: '2022-01-02T00:00:00.000Z' })],
      })
    ).toThrow('outside season');
  });
});
