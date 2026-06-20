import { REAL_DATA_NINE_CATEGORY_PRESET, type FantasyCategoryKey } from '@/types/fantasyCategories';

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
}

export interface NormalizedCreateLeagueInput {
  name: string;
  maxTeams: number;
  categories: FantasyCategoryKey[];
  visibility: 'PUBLIC' | 'PRIVATE';
  timeZone: string;
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
