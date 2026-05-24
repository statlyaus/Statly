export const LAST_LEAGUE_ID_COOKIE = 'statly_last_league_id';
export const PLAYERS_SEASON_COOKIE = 'statly_players_season';
export const UI_PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

type SearchParamValue = string | string[] | undefined;
type CookieReader = {
  get(name: string): { value?: string } | undefined;
};

function getFirstParam(value: SearchParamValue): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

export function readSearchParam(
  searchParams: Record<string, SearchParamValue> | undefined,
  key: string
): string | undefined {
  return getFirstParam(searchParams?.[key])?.trim() || undefined;
}

export function readCookiePreference(cookieStore: CookieReader, key: string): string | undefined {
  return cookieStore.get(key)?.value?.trim() || undefined;
}

export function readCookieValue(cookieHeader: string, key: string): string | undefined {
  const prefix = `${key}=`;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!match) return undefined;

  const value = match.slice(prefix.length).trim();
  return value ? decodeURIComponent(value) : undefined;
}

export function parseLeaguePreference(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim() || undefined;
}

export function parseSeasonPreference(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const season = Number.parseInt(value, 10);
  if (!Number.isInteger(season) || season < 2020 || season > 2035) {
    return undefined;
  }
  return season;
}

export function buildPreferenceCookie(
  key: string,
  value: string,
  maxAge = UI_PREFERENCE_COOKIE_MAX_AGE
): string {
  const encodedValue = encodeURIComponent(value);
  return `${key}=${encodedValue}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
