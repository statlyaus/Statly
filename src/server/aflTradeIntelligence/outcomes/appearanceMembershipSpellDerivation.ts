import {
  createAflTradeAppearanceMembershipSpell,
  type AflTradeAcquisitionSpellRegistration,
} from './acquisitionSpellRegistrationContracts';

/** One reviewed appearance fact, as read from `outcome_provider_player_appearance_fact`. */
export interface AflTradeAppearanceFactForMembership {
  readonly appearanceFactId: string;
  readonly playerId: string;
  readonly clubId: string;
  readonly matchId: string;
  readonly competition: 'AFLM' | 'AFLW';
  readonly seasonYear: number;
  /** ISO instant; the membership date is its UTC calendar day, matching the database guard. */
  readonly effectiveAt: string;
  readonly availability: 'measured' | 'missing' | 'not_applicable' | 'quarantined';
  readonly appeared: boolean | null;
}

export interface DeriveAflTradeAppearanceMembershipSpellsInput {
  readonly environment: 'test_fixture' | 'non_production';
  readonly competition: 'AFLM' | 'AFLW';
  readonly seasonYear: number;
  readonly ruleId: string;
  readonly createdAt: string;
  readonly facts: readonly AflTradeAppearanceFactForMembership[];
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Proposes one appearance-membership (v3) spell per player and represented club for one season,
 * spanning the first and last reviewed measured appearance. Only facts with `availability`
 * `measured` and `appeared === true` count; everything else is ignored rather than inferred.
 *
 * The proposals are deterministic and content-addressed. They are proposals only: each still needs
 * the rule-bound review decision and registration, and the database re-verifies the window against
 * the stored appearance facts.
 */
export function deriveAflTradeAppearanceMembershipSpells(
  input: DeriveAflTradeAppearanceMembershipSpellsInput
): AflTradeAcquisitionSpellRegistration[] {
  const windows = new Map<
    string,
    {
      playerId: string;
      clubId: string;
      first: { key: string; appearanceFactId: string; matchId: string; date: string };
      last: { key: string; appearanceFactId: string; matchId: string; date: string };
    }
  >();
  const seenFacts = new Set<string>();
  for (const fact of input.facts) {
    if (seenFacts.has(fact.appearanceFactId)) {
      throw new TypeError(`Appearance fact ${fact.appearanceFactId} is supplied more than once.`);
    }
    seenFacts.add(fact.appearanceFactId);
    if (fact.competition !== input.competition || fact.seasonYear !== input.seasonYear) {
      throw new TypeError(
        `Appearance fact ${fact.appearanceFactId} lies outside ${input.competition} ${input.seasonYear}.`
      );
    }
    if (fact.availability !== 'measured' || fact.appeared !== true) continue;
    const instant = new Date(fact.effectiveAt);
    if (Number.isNaN(instant.getTime())) {
      throw new TypeError(`Appearance fact ${fact.appearanceFactId} has no valid effective time.`);
    }
    const date = instant.toISOString().slice(0, 10);
    if (date.slice(0, 4) !== String(input.seasonYear)) {
      throw new TypeError(
        `Appearance fact ${fact.appearanceFactId} is dated ${date}, outside season ${input.seasonYear}.`
      );
    }
    // Ties on one day order by match and fact identifiers so the choice is stable.
    const point = {
      key: `${date}\u0000${fact.matchId}\u0000${fact.appearanceFactId}`,
      appearanceFactId: fact.appearanceFactId,
      matchId: fact.matchId,
      date,
    };
    const scope = `${fact.playerId}\u0000${fact.clubId}`;
    const current = windows.get(scope);
    if (!current) {
      windows.set(scope, {
        playerId: fact.playerId,
        clubId: fact.clubId,
        first: point,
        last: point,
      });
      continue;
    }
    if (compare(point.key, current.first.key) < 0) current.first = point;
    if (compare(point.key, current.last.key) > 0) current.last = point;
  }
  return [...windows.entries()]
    .sort(([left], [right]) => compare(left, right))
    .map(([, window]) =>
      createAflTradeAppearanceMembershipSpell({
        environment: input.environment,
        competition: input.competition,
        playerId: window.playerId,
        clubId: window.clubId,
        seasonYear: input.seasonYear,
        firstAppearance: {
          appearanceFactId: window.first.appearanceFactId,
          matchId: window.first.matchId,
          date: window.first.date,
        },
        lastAppearance: {
          appearanceFactId: window.last.appearanceFactId,
          matchId: window.last.matchId,
          date: window.last.date,
        },
        ruleId: input.ruleId,
        version: 1,
        supersedesSpellVersionId: null,
        createdAt: input.createdAt,
      })
    );
}
