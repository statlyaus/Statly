import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import {
  FANTASY_CATEGORIES,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  LEAGUE_PLAYER_STAT_BASIS,
  LEAGUE_PLAYER_STAT_PERIOD,
  type LeaguePlayerStatDatasetDto,
  type LeaguePlayerStatLineDto,
} from '@/types/leaguePlayerStats';
import type { CategoryDirection } from '@/types/leagues';
import type { Player, PlayerSeasonStatSource } from '@/types/players';

const SOURCE_KEYS_BY_CATEGORY: Partial<Record<FantasyCategoryKey, readonly string[]>> = {
  disposalEffPct: ['disposalEffPct', 'disposalEfficiency'],
  timeOnGroundPct: ['timeOnGroundPct', 'togPct'],
};

export interface LeaguePlayerStatReadModelOptions {
  categories: readonly FantasyCategoryKey[];
  categoryDirections?: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  season?: number | null;
}

export interface LeaguePlayerStatSeasonOptions {
  selectedSeason: number;
  availableSeasons: number[];
}

export interface LeaguePlayerStatTarget {
  id: string;
  name: string;
  club?: string | null;
  team?: string | null;
}

function sourceKeysFor(category: FantasyCategoryKey): readonly string[] {
  return SOURCE_KEYS_BY_CATEGORY[category] ?? [category];
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeLookupPart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function addUniqueLookup<T>(
  lookup: Map<string, T>,
  ambiguousKeys: Set<string>,
  key: string,
  value: T
): void {
  if (!key || ambiguousKeys.has(key)) return;
  if (!lookup.has(key)) {
    lookup.set(key, value);
    return;
  }
  if (lookup.get(key) === value) return;
  lookup.delete(key);
  ambiguousKeys.add(key);
}

export function readPlayerSeasonStatAverage(
  source: PlayerSeasonStatSource,
  sourceKeys: readonly string[]
): number | null {
  for (const sourceKey of sourceKeys) {
    const value = readFiniteNumber(source.stats[sourceKey]);
    if (value === null) continue;

    const basis = source.basisByStat[sourceKey];
    if (basis === 'PER_GAME') return value;
    if (basis === 'TOTAL' && source.games > 0) return value / source.games;
  }

  return null;
}

function readPerGameValue(
  source: PlayerSeasonStatSource,
  category: FantasyCategoryKey
): number | null {
  return readPlayerSeasonStatAverage(source, sourceKeysFor(category));
}

function getAvailableSeasons(players: readonly Player[]): number[] {
  const seasons = new Set<number>();

  for (const player of players) {
    for (const [rawSeason, source] of Object.entries(player.statsBySeason ?? {})) {
      const season = Number(rawSeason);
      if (Number.isInteger(season) && season > 0 && source.games > 0) seasons.add(season);
    }
  }

  return Array.from(seasons).sort((a, b) => b - a);
}

function latestDataThrough(players: readonly Player[], season: number): string | null {
  let latest: { value: string; timestamp: number } | null = null;

  for (const player of players) {
    const value = player.statsBySeason?.[String(season)]?.dataThrough;
    if (!value) continue;

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (!latest || timestamp > latest.timestamp) latest = { value, timestamp };
  }

  return latest?.value ?? null;
}

export function getLeaguePlayerStatSeasonOptions(
  players: readonly Player[],
  requestedSeason?: number | null
): LeaguePlayerStatSeasonOptions {
  const availableSeasons = getAvailableSeasons(players);
  const currentSeason = new Date().getFullYear();
  const fallbackSeason = availableSeasons[0] ?? currentSeason;
  const selectedSeason =
    requestedSeason && availableSeasons.includes(requestedSeason)
      ? requestedSeason
      : fallbackSeason;

  return { selectedSeason, availableSeasons };
}

export function projectLeaguePlayerStatLine(
  player: Player,
  categories: readonly FantasyCategoryKey[],
  season: number
): LeaguePlayerStatLineDto {
  const source = player.statsBySeason?.[String(season)];
  const values = Object.fromEntries(
    categories.map((category) => [category, source ? readPerGameValue(source, category) : null])
  );

  return {
    gamesPlayed: source?.games ?? 0,
    values,
  };
}

export function buildLeaguePlayerStatDataset(
  players: readonly Player[],
  options: LeaguePlayerStatReadModelOptions
): LeaguePlayerStatDatasetDto {
  const categories = normalizeFantasyCategoryKeys(options.categories, []);
  const directions = normalizeCategoryDirections(categories, options.categoryDirections);
  const { selectedSeason, availableSeasons } = getLeaguePlayerStatSeasonOptions(
    players,
    options.season
  );

  return {
    context: {
      basis: LEAGUE_PLAYER_STAT_BASIS,
      period: LEAGUE_PLAYER_STAT_PERIOD,
      season: selectedSeason,
      availableSeasons,
      dataThrough: latestDataThrough(players, selectedSeason),
    },
    columns: categories.map((key) => {
      const category = FANTASY_CATEGORIES[key];
      return {
        key,
        label: category.label,
        shortLabel: category.shortLabel ?? category.abbrev ?? category.label,
        format: category.format,
        direction: directions[key],
      };
    }),
    playersById: Object.fromEntries(
      players.map((player) => [
        player.id,
        projectLeaguePlayerStatLine(player, categories, selectedSeason),
      ])
    ),
  };
}

export function buildLeaguePlayerStatDatasetForTargets(
  sourcePlayers: readonly Player[],
  targets: readonly LeaguePlayerStatTarget[],
  options: LeaguePlayerStatReadModelOptions
): LeaguePlayerStatDatasetDto {
  const sourceDataset = buildLeaguePlayerStatDataset(sourcePlayers, options);
  const byCanonicalId = new Map<string, LeaguePlayerStatLineDto>();
  const byNameAndTeam = new Map<string, LeaguePlayerStatLineDto>();
  const byName = new Map<string, LeaguePlayerStatLineDto>();
  const ambiguousCanonicalIds = new Set<string>();
  const ambiguousNames = new Set<string>();

  for (const player of sourcePlayers) {
    const line = sourceDataset.playersById[player.id];
    if (!line) continue;

    addUniqueLookup(byCanonicalId, ambiguousCanonicalIds, buildCanonicalPlayerId(player.id), line);
    addUniqueLookup(
      byCanonicalId,
      ambiguousCanonicalIds,
      buildCanonicalPlayerId(player.name),
      line
    );

    const normalizedName = normalizeLookupPart(player.name);
    const normalizedTeam = normalizeLookupPart(player.team);
    if (normalizedName && normalizedTeam) {
      byNameAndTeam.set(`${normalizedName}|${normalizedTeam}`, line);
    }
    addUniqueLookup(byName, ambiguousNames, normalizedName, line);
  }

  const emptyValues = () =>
    Object.fromEntries(sourceDataset.columns.map(({ key }) => [key, null] as const));

  return {
    ...sourceDataset,
    playersById: Object.fromEntries(
      targets.map((target) => {
        const normalizedName = normalizeLookupPart(target.name);
        const normalizedTeam = normalizeLookupPart(target.club ?? target.team);
        const line =
          sourceDataset.playersById[target.id] ??
          byCanonicalId.get(buildCanonicalPlayerId(target.id)) ??
          byCanonicalId.get(buildCanonicalPlayerId(target.name)) ??
          byNameAndTeam.get(`${normalizedName}|${normalizedTeam}`) ??
          byName.get(normalizedName);

        return [
          target.id,
          line ?? {
            gamesPlayed: 0,
            values: emptyValues(),
          },
        ];
      })
    ),
  };
}
