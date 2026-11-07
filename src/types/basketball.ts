/**
 * Fantasy basketball (NBA) domain catalog: categories, scoring formats, platforms and roster slots.
 *
 * Separate from the AFL catalog in `fantasyCategories.ts`. String literals match the Prisma enums of the
 * same name so client code can use them without importing `@prisma/client`.
 * See docs/domain/basketball.md.
 */

/**
 * The box-score counts that feed categories. Minutes, rebound splits, fouls and plus-minus are stored
 * too (`NbaPlayerGameStat`) but are not category inputs.
 */
export const NBA_STAT_KEYS = [
  'points',
  'rebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'threePointersMade',
  'threePointersAttempted',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'freeThrowsMade',
  'freeThrowsAttempted',
] as const;

export type NbaStatKey = (typeof NBA_STAT_KEYS)[number];

/** A stat line: per-game averages or totals, keyed by raw box-score count. */
export type NbaStatLine = Record<NbaStatKey, number>;

export type BasketballCategoryId =
  'FG_PCT' | 'FT_PCT' | 'THREES' | 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK' | 'TO';

export type BasketballCategoryDirection = 'HIGH_WINS' | 'LOW_WINS';

export type BasketballCategoryDefinition =
  | {
      id: BasketballCategoryId;
      label: string;
      shortLabel: string;
      direction: BasketballCategoryDirection;
      kind: 'COUNT';
      stat: NbaStatKey;
    }
  | {
      id: BasketballCategoryId;
      label: string;
      shortLabel: string;
      direction: BasketballCategoryDirection;
      kind: 'PERCENT';
      made: NbaStatKey;
      attempted: NbaStatKey;
    };

/** Every supported category, in the order Yahoo and ESPN display them. */
export const BASKETBALL_CATEGORIES: readonly BasketballCategoryDefinition[] = [
  {
    id: 'FG_PCT',
    label: 'Field goal %',
    shortLabel: 'FG%',
    direction: 'HIGH_WINS',
    kind: 'PERCENT',
    made: 'fieldGoalsMade',
    attempted: 'fieldGoalsAttempted',
  },
  {
    id: 'FT_PCT',
    label: 'Free throw %',
    shortLabel: 'FT%',
    direction: 'HIGH_WINS',
    kind: 'PERCENT',
    made: 'freeThrowsMade',
    attempted: 'freeThrowsAttempted',
  },
  {
    id: 'THREES',
    label: 'Three-pointers made',
    shortLabel: '3PM',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'threePointersMade',
  },
  {
    id: 'PTS',
    label: 'Points',
    shortLabel: 'PTS',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'points',
  },
  {
    id: 'REB',
    label: 'Rebounds',
    shortLabel: 'REB',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'rebounds',
  },
  {
    id: 'AST',
    label: 'Assists',
    shortLabel: 'AST',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'assists',
  },
  {
    id: 'STL',
    label: 'Steals',
    shortLabel: 'STL',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'steals',
  },
  {
    id: 'BLK',
    label: 'Blocks',
    shortLabel: 'BLK',
    direction: 'HIGH_WINS',
    kind: 'COUNT',
    stat: 'blocks',
  },
  {
    id: 'TO',
    label: 'Turnovers',
    shortLabel: 'TO',
    direction: 'LOW_WINS',
    kind: 'COUNT',
    stat: 'turnovers',
  },
];

export const BASKETBALL_CATEGORY_IDS: readonly BasketballCategoryId[] = BASKETBALL_CATEGORIES.map(
  (category) => category.id
);

export function getBasketballCategory(id: BasketballCategoryId): BasketballCategoryDefinition {
  const category = BASKETBALL_CATEGORIES.find((candidate) => candidate.id === id);
  if (!category) throw new Error(`Unknown basketball category: ${id}`);
  return category;
}

export function isBasketballCategoryId(value: unknown): value is BasketballCategoryId {
  return (
    typeof value === 'string' && (BASKETBALL_CATEGORY_IDS as readonly string[]).includes(value)
  );
}

/** Standard 9-category head-to-head (Yahoo and ESPN default). */
export const NINE_CATEGORY_PRESET: readonly BasketballCategoryId[] = BASKETBALL_CATEGORY_IDS;

/** 8-category: the nine without turnovers. */
export const EIGHT_CATEGORY_PRESET: readonly BasketballCategoryId[] =
  BASKETBALL_CATEGORY_IDS.filter((id) => id !== 'TO');

/** Head-to-head only: Statly does not compute roto standings. */
export type BasketballScoringFormat = 'H2H_MOST_CATEGORIES' | 'H2H_EACH_CATEGORY';

export const BASKETBALL_SCORING_FORMATS: readonly BasketballScoringFormat[] = [
  'H2H_MOST_CATEGORIES',
  'H2H_EACH_CATEGORY',
];

/** Where the user's real league is hosted. A label only: Statly does not sync with these platforms. */
export type BasketballPlatform = 'YAHOO' | 'ESPN' | 'SLEEPER' | 'FANTRAX' | 'OTHER';

export const BASKETBALL_PLATFORMS: readonly BasketballPlatform[] = [
  'YAHOO',
  'ESPN',
  'SLEEPER',
  'FANTRAX',
  'OTHER',
];

export type BasketballRosterSlot =
  'PG' | 'SG' | 'G' | 'SF' | 'PF' | 'F' | 'C' | 'UTIL' | 'BN' | 'IL';

export const BASKETBALL_ROSTER_SLOTS: readonly BasketballRosterSlot[] = [
  'PG',
  'SG',
  'G',
  'SF',
  'PF',
  'F',
  'C',
  'UTIL',
  'BN',
  'IL',
];

/** Count of each slot type. Starters are every slot except BN and IL. */
export type BasketballRosterSlotCounts = Record<BasketballRosterSlot, number>;

/** Yahoo's default head-to-head roster: PG, SG, G, SF, PF, F, C, C, UTIL, UTIL, 3 bench, 3 IL. */
export const YAHOO_DEFAULT_ROSTER_SLOTS: BasketballRosterSlotCounts = {
  PG: 1,
  SG: 1,
  G: 1,
  SF: 1,
  PF: 1,
  F: 1,
  C: 2,
  UTIL: 2,
  BN: 3,
  IL: 3,
};

export function countStarterSlots(slots: BasketballRosterSlotCounts): number {
  return BASKETBALL_ROSTER_SLOTS.filter((slot) => slot !== 'BN' && slot !== 'IL').reduce(
    (total, slot) => total + slots[slot],
    0
  );
}

/** Roster size used for replacement level: every slot except IL. */
export function countRosterSpots(slots: BasketballRosterSlotCounts): number {
  return BASKETBALL_ROSTER_SLOTS.filter((slot) => slot !== 'IL').reduce(
    (total, slot) => total + slots[slot],
    0
  );
}

/**
 * NBA seasons are identified by the calendar year they end in, as ESPN does: 2026-27 is 2027.
 * Game dates are US Eastern calendar dates (`YYYY-MM-DD`).
 */
export type NbaSeasonId = number;

export function formatNbaSeason(season: NbaSeasonId): string {
  return `${season - 1}-${String(season % 100).padStart(2, '0')}`;
}
