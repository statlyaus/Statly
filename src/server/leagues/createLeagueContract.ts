import {
  isFantasyCategoryKey,
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  LEAGUE_CONSTRAINTS,
  type CategoryDirection,
  type LeagueFixtureGenerationMode,
  type LeagueScoringMode,
} from '@/types/leagues';

import { normalizeCategoryDirections } from './categoryDirections';
import { DEFAULT_ACTIVE_LINEUP_SLOTS, normalizeLineupSlots } from './lineupSettings';
import type { LineupSlotSettings } from './scoringTypes';

export interface CreateLeagueInput {
  name?: string;
  maxTeams?: number;
  teamCount?: number;
  categories?: FantasyCategoryKey[];
  scoringFormat?: string;
  privacy?: string;
  type?: string;
  visibility?: string;
  timeZone?: string;
  scoringMode?: LeagueScoringMode;
  fixtureGenerationMode?: LeagueFixtureGenerationMode;
  lineupSlots?: Partial<LineupSlotSettings>;
  categoryDirections?: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
}

export interface NormalizedCreateLeagueInput {
  name: string;
  maxTeams: number;
  categories: FantasyCategoryKey[];
  visibility: 'PUBLIC' | 'PRIVATE';
  timeZone: string;
  scoringMode: LeagueScoringMode;
  fixtureGenerationMode: LeagueFixtureGenerationMode;
  lineupSlots: LineupSlotSettings;
  categoryDirections: Record<FantasyCategoryKey, CategoryDirection>;
}

export type LeagueValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/** League names are 3-50 characters after trimming, on create and on every later edit. */
export function validateLeagueName(name: string): LeagueValidation<string> {
  const trimmed = name.trim();
  const { minLength, maxLength } = LEAGUE_CONSTRAINTS.name;
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return { ok: false, error: `League name must be ${minLength}-${maxLength} characters` };
  }
  return { ok: true, value: trimmed };
}

/**
 * A league scores 3-10 known categories. Unknown keys are rejected rather than dropped, so a typo
 * never silently becomes a different category set.
 */
export function validateLeagueCategories(value: unknown): LeagueValidation<FantasyCategoryKey[]> {
  if (!Array.isArray(value) || value.some((key) => !isFantasyCategoryKey(key))) {
    return { ok: false, error: 'One or more scoring categories are invalid' };
  }
  const categories = normalizeFantasyCategoryKeys(value, []);
  const { min, max } = LEAGUE_CONSTRAINTS.categories;
  if (categories.length < min || categories.length > max) {
    return { ok: false, error: `Select ${min}-${max} scoring categories` };
  }
  return { ok: true, value: categories };
}

/** An IANA time zone name the runtime recognises, such as `Australia/Melbourne`. */
export function isSupportedTimeZone(value: string): boolean {
  if (!value.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || !isSupportedTimeZone(timeZone)) {
    return 'UTC';
  }
  return timeZone.trim();
}

export function normalizeCreateLeagueInput(input: CreateLeagueInput): NormalizedCreateLeagueInput {
  const maxTeams = input.maxTeams ?? input.teamCount ?? 12;
  const categories = input.categories?.length
    ? input.categories
    : [...REAL_DATA_NINE_CATEGORY_PRESET];
  const scoringMode =
    input.scoringMode === 'H2H_MOST_CATEGORIES' ? 'H2H_MOST_CATEGORIES' : 'H2H_EACH_CATEGORY';
  const fixtureGenerationMode = input.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';
  const visibility =
    (input.visibility ?? input.privacy ?? input.type ?? 'private').toLowerCase() === 'public'
      ? 'PUBLIC'
      : 'PRIVATE';

  return {
    name: typeof input.name === 'string' ? input.name.trim() : '',
    maxTeams,
    categories,
    visibility,
    timeZone: normalizeTimeZone(input.timeZone),
    scoringMode,
    fixtureGenerationMode,
    lineupSlots: input.lineupSlots
      ? normalizeLineupSlots(input.lineupSlots)
      : DEFAULT_ACTIVE_LINEUP_SLOTS,
    categoryDirections: normalizeCategoryDirections(categories, input.categoryDirections),
  };
}

export function normalizeCreateLeagueResponse(response: unknown): { id: string } {
  if (
    response &&
    typeof response === 'object' &&
    'success' in response &&
    (response as { success?: boolean }).success === true &&
    'data' in response &&
    (response as { data?: { id?: unknown } }).data &&
    typeof (response as { data: { id?: unknown } }).data.id === 'string'
  ) {
    return { id: (response as { data: { id: string } }).data.id };
  }

  if (
    response &&
    typeof response === 'object' &&
    'id' in response &&
    typeof (response as { id?: unknown }).id === 'string'
  ) {
    return { id: (response as { id: string }).id };
  }

  throw new Error('League creation response did not include a league id');
}
