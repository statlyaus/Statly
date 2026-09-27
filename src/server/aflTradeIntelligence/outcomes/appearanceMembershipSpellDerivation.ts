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

interface AppearancePoint {
  key: string;
  appearanceFactId: string;
  matchId: string;
  date: string;
}

interface AppearanceWindow {
  playerId: string;
  clubId: string;
  first: AppearancePoint;
  last: AppearancePoint;
}

type AppearanceSpellContent = Extract<
  AflTradeAcquisitionSpellRegistration['content'],
  { schemaVersion: 'afl-trade-acquisition-registration/v3' }
>;

const scopeKey = (playerId: string, clubId: string) => `${playerId}\u0000${clubId}`;

/** Validates one fact and returns its window point, or null when it is not a measured appearance. */
function appearancePoint(
  fact: AflTradeAppearanceFactForMembership,
  input: DeriveAflTradeAppearanceMembershipSpellsInput
): AppearancePoint | null {
  if (fact.competition !== input.competition || fact.seasonYear !== input.seasonYear) {
    throw new TypeError(
      `Appearance fact ${fact.appearanceFactId} lies outside ${input.competition} ${input.seasonYear}.`
    );
  }
  if (fact.availability !== 'measured' || fact.appeared !== true) return null;
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
  return {
    key: `${date}\u0000${fact.matchId}\u0000${fact.appearanceFactId}`,
    appearanceFactId: fact.appearanceFactId,
    matchId: fact.matchId,
    date,
  };
}

/** Groups measured appearances into one first-to-last window per player and represented club. */
function collectAppearanceWindows(
  input: DeriveAflTradeAppearanceMembershipSpellsInput
): Map<string, AppearanceWindow> {
  const windows = new Map<string, AppearanceWindow>();
  const seenFacts = new Set<string>();
  for (const fact of input.facts) {
    if (seenFacts.has(fact.appearanceFactId)) {
      throw new TypeError(`Appearance fact ${fact.appearanceFactId} is supplied more than once.`);
    }
    seenFacts.add(fact.appearanceFactId);
    const point = appearancePoint(fact, input);
    if (point === null) continue;
    const scope = scopeKey(fact.playerId, fact.clubId);
    const window = windows.get(scope);
    if (!window) {
      windows.set(scope, {
        playerId: fact.playerId,
        clubId: fact.clubId,
        first: point,
        last: point,
      });
    } else {
      if (compare(point.key, window.first.key) < 0) window.first = point;
      if (compare(point.key, window.last.key) > 0) window.last = point;
    }
  }
  return windows;
}

/** Indexes the supplied current spells, which must be this season's appearance membership. */
function indexCurrentSpells(
  input: DeriveAflTradeAppearanceMembershipSpellsInput
): Map<string, { spellVersionId: string; content: AppearanceSpellContent }> {
  const current = new Map<string, { spellVersionId: string; content: AppearanceSpellContent }>();
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
    const scope = scopeKey(c.playerId, c.clubId);
    if (current.has(scope)) {
      throw new TypeError(
        `More than one current spell is supplied for ${c.playerId} at ${c.clubId}.`
      );
    }
    current.set(scope, { spellVersionId: spell.spellVersionId, content: c });
  }
  return current;
}

const binding = (point: AppearancePoint) => ({
  appearanceFactId: point.appearanceFactId,
  matchId: point.matchId,
  date: point.date,
});

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
  const windows = collectAppearanceWindows(input);
  const current = indexCurrentSpells(input);
  const proposals: AflTradeAcquisitionSpellRegistration[] = [];
  for (const [scope, window] of [...windows.entries()].sort(([left], [right]) =>
    compare(left, right)
  )) {
    const existing = current.get(scope);
    if (
      existing?.content.firstAppearance.appearanceFactId === window.first.appearanceFactId &&
      existing.content.lastAppearance.appearanceFactId === window.last.appearanceFactId
    ) {
      continue;
    }
    proposals.push(
      createAflTradeAppearanceMembershipSpell({
        environment: input.environment,
        competition: input.competition,
        playerId: window.playerId,
        clubId: window.clubId,
        seasonYear: input.seasonYear,
        firstAppearance: binding(window.first),
        lastAppearance: binding(window.last),
        ruleId: input.ruleId,
        version: existing ? existing.content.version + 1 : 1,
        supersedesSpellVersionId: existing ? existing.spellVersionId : null,
        createdAt: input.createdAt,
      })
    );
  }
  return proposals;
}
