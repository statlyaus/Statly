import { REAL_DATA_NINE_CATEGORY_PRESET, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type {
  CategoryDirection,
  LeagueFixtureGenerationMode,
  LeagueScoringMode,
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

function normalizeTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    return 'UTC';
  }

  const trimmed = timeZone.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    return 'UTC';
  }
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
