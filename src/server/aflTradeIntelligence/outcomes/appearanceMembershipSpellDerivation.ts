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
  /**
   * Current registered appearance-membership spells for this season. An unchanged window is skipped;
   * a changed window becomes the next version superseding the current one, so a window can grow as
   * new appearance facts arrive during the season. Omit or pass none for a first registration.
   */
  readonly currentSpells?: readonly AflTradeAcquisitionSpellRegistration[];
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Proposes one appearance-membership (v3) spell per player and represented club for one season,
 * or the next version of a supplied current spell whose window changed,
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
  const current = new Map<string, AflTradeAcquisitionSpellRegistration>();
  for (const spell of input.currentSpells ?? []) {
    const c = spell.content;
    if (
      c.schemaVersion !== 'afl-trade-acquisition-registration/v3' ||
      c.environment !== input.environment ||
      c.competition !== input.competition ||
      c.seasonYear !== input.seasonYear
    ) {
      throw new TypeError(
        `Spell ${spell.spellVersionId} is not appearance membership for ${input.competition} ${input.seasonYear}.`
      );
    }
    const scope = `${c.playerId}\u0000${c.clubId}`;
    if (current.has(scope)) {
      throw new TypeError(
        `More than one current spell is supplied for ${c.playerId} at ${c.clubId}.`
      );
    }
    current.set(scope, spell);
  }
  return [...windows.entries()]
    .sort(([left], [right]) => compare(left, right))
    .flatMap(([scope, window]) => {
      const existing = current.get(scope);
      const existingContent =
        existing?.content.schemaVersion === 'afl-trade-acquisition-registration/v3'
          ? existing.content
          : undefined;
      if (
        existingContent &&
        existingContent.firstAppearance.appearanceFactId === window.first.appearanceFactId &&
        existingContent.lastAppearance.appearanceFactId === window.last.appearanceFactId
      ) {
        return [];
      }
      return [
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
          version: existingContent ? existingContent.version + 1 : 1,
          supersedesSpellVersionId: existing ? existing.spellVersionId : null,
          createdAt: input.createdAt,
        }),
      ];
    });
}
