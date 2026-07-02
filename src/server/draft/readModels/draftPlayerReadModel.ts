import { getPlayers } from '@/lib/data';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import {
  calculateTotalValue,
  FANTASY_CATEGORIES,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';
import type { Player } from '@/types/players';

const STAT_KEYS = [
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'goals',
  'hitouts',
  'clearances',
  'inside50s',
  'rebound50s',
  'clangers',
  'contestedPossessions',
  'uncontestedPossessions',
  'freesFor',
  'freesAgainst',
  'onePercenters',
  'goalAssists',
  'timeOnGroundPct',
  'disposalEffPct',
  'turnovers',
  'intercepts',
  'metresGained',
  'contestedMarks',
  'effectiveDisposals',
  'scoreInvolvements',
] as const satisfies readonly (keyof PlayerStats)[];

const AVERAGE_STAT_KEYS = new Set<keyof PlayerStats>(['timeOnGroundPct', 'disposalEffPct']);
const LOWER_IS_BETTER_CATEGORIES = new Set<FantasyCategoryKey>([
  'clangers',
  'freesAgainst',
  'turnovers',
]);

type DraftPlayerStatsProjection = {
  avgPoints: number;
  averagePoints: number;
  fantasyPoints: number;
  gamesPlayed: number;
  statsSeason: number;
  availableStatSeasons: number[];
  stats: Partial<PlayerStats>;
  statsTotal: Partial<PlayerStats>;
};

export type StatlyZPlayerInput = {
  id: string;
  stats?: Partial<PlayerStats> | null;
};

type StatlyZBreakdownEntry = {
  category: FantasyCategoryKey;
  value: number;
  zScore: number;
};

type StatlyZScore = {
  score: number;
  breakdown: StatlyZBreakdownEntry[];
  missingCategories: FantasyCategoryKey[];
};

export type AvailableDraftPlayerSource = {
  id: string;
  name: string;
  position: string;
  club: string;
};

export type DraftPlayerStatsLookup = ReturnType<typeof buildDraftPlayerStatsLookup>;
export type DraftStatSeasonOptions = {
  selectedSeason: number;
  availableSeasons: number[];
};

function normalizeLookupPart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(',').map((value) => value.trim());
    }
  }

  if (!Array.isArray(parsed)) return [];

  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES));
  return parsed.map(String).filter((value): value is FantasyCategoryKey => validKeys.has(value));
}

function readNumericStat(
  player: Player,
  key: keyof PlayerStats,
  statsSource: Record<string, unknown> | undefined = player.stats
): number {
  const stats = statsSource ?? {};
  const aliases: Record<string, string[]> = {
    disposalEffPct: ['disposalEffPct', 'disposalEfficiency'],
    timeOnGroundPct: ['timeOnGroundPct', 'togPct'],
  };
  const candidateKeys = [key, ...(aliases[String(key)] ?? [])];

  for (const candidateKey of candidateKeys) {
    const statValue = stats[candidateKey];
    if (typeof statValue === 'number' && Number.isFinite(statValue)) return statValue;

    const playerValue = player[candidateKey as keyof Player];
    if (typeof playerValue === 'number' && Number.isFinite(playerValue)) return playerValue;
  }

  return 0;
}

function roundStat(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundStatlyZ(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validSelectedCategories(
  selectedCategories: readonly (FantasyCategoryKey | string)[]
): FantasyCategoryKey[] {
  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES));
  const seen = new Set<string>();

  return selectedCategories.filter((category): category is FantasyCategoryKey => {
    if (!validKeys.has(category) || seen.has(category)) return false;
    seen.add(category);
    return true;
  });
}

function readFinitePlayerStat(
  player: StatlyZPlayerInput,
  category: FantasyCategoryKey
): number | null {
  const value = player.stats?.[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function calculateStatlyZScores(
  players: readonly StatlyZPlayerInput[],
  selectedCategories: readonly (FantasyCategoryKey | string)[]
): Map<string, StatlyZScore> {
  const categories = validSelectedCategories(selectedCategories);
  const categoryStats = new Map<FantasyCategoryKey, { mean: number; stdDev: number }>();

  for (const category of categories) {
    const values = players
      .map((player) => readFinitePlayerStat(player, category))
      .filter((value): value is number => value !== null);

    if (values.length === 0) {
      categoryStats.set(category, { mean: 0, stdDev: 0 });
      continue;
    }

    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const variance =
      values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;

    categoryStats.set(category, { mean, stdDev: Math.sqrt(variance) });
  }

  return new Map(
    players.map((player) => {
      const breakdown: StatlyZBreakdownEntry[] = [];
      const missingCategories: FantasyCategoryKey[] = [];
      let score = 0;

      for (const category of categories) {
        const value = readFinitePlayerStat(player, category);

        if (value === null) {
          missingCategories.push(category);
          continue;
        }

        const stats = categoryStats.get(category);
        const rawZScore = stats && stats.stdDev !== 0 ? (value - stats.mean) / stats.stdDev : 0;
        const zScore = LOWER_IS_BETTER_CATEGORIES.has(category) ? -rawZScore : rawZScore;
        const roundedZScore = roundStatlyZ(zScore);

        score += zScore;
        breakdown.push({ category, value, zScore: roundedZScore });
      }

      return [
        player.id,
        {
          score: roundStatlyZ(score),
          breakdown,
          missingCategories,
        },
      ];
    })
  );
}

function buildCompleteStats(
  player: Player,
  gamesPlayed: number,
  statsSource?: Record<string, unknown>
): PlayerStats & { aflFantasy?: number } {
  const stats = STAT_KEYS.reduce(
    (acc, key) => {
      acc[key] = readNumericStat(player, key, statsSource);
      return acc;
    },
    { games: gamesPlayed } as PlayerStats
  );

  const aflFantasy = statsSource?.aflFantasy ?? player.stats?.aflFantasy;
  if (typeof aflFantasy === 'number' && Number.isFinite(aflFantasy)) {
    return { ...stats, aflFantasy };
  }

  return stats;
}

function getSeasonStatsSource(
  player: Player,
  requestedSeason?: number | null
): { season: number; games: number; stats: Record<string, unknown> } | null {
  const seasons = player.statsBySeason ?? {};
  const selectedSeason =
    requestedSeason ?? player.statsSeason ?? Number(player.availableStatSeasons?.[0] ?? 0);

  if (selectedSeason && seasons[String(selectedSeason)]) {
    const seasonStats = seasons[String(selectedSeason)];
    return {
      season: selectedSeason,
      games: seasonStats.games,
      stats: seasonStats.stats,
    };
  }

  if (requestedSeason) {
    return null;
  }

  const fallbackGames = typeof player.games === 'number' && player.games > 0 ? player.games : 0;
  if (!fallbackGames && !player.stats) return null;

  return {
    season: selectedSeason || new Date().getFullYear(),
    games: fallbackGames,
    stats: player.stats ?? {},
  };
}

function projectDraftPlayerStats(
  player: Player,
  requestedSeason?: number | null
): DraftPlayerStatsProjection | null {
  const seasonSource = getSeasonStatsSource(player, requestedSeason);
  if (!seasonSource || seasonSource.games <= 0) {
    return null;
  }

  const explicitGames = seasonSource.games;
  const hasAnyStats = STAT_KEYS.some((key) => readNumericStat(player, key, seasonSource.stats) !== 0);

  if (!hasAnyStats) {
    return null;
  }

  const gamesPlayed = explicitGames;
  const completeStats = buildCompleteStats(player, gamesPlayed, seasonSource.stats);
  const statsTotal: Partial<PlayerStats> = {};
  const stats: Partial<PlayerStats> = {};

  for (const key of STAT_KEYS) {
    const total = completeStats[key];
    statsTotal[key] = total;
    stats[key] = AVERAGE_STAT_KEYS.has(key) ? roundStat(total) : roundStat(total / gamesPlayed);
  }

  const score =
    typeof completeStats.aflFantasy === 'number'
      ? roundStat(completeStats.aflFantasy / gamesPlayed)
      : calculateTotalValue(completeStats);

  return {
    avgPoints: score,
    averagePoints: score,
    fantasyPoints: score,
    gamesPlayed,
    statsSeason: seasonSource.season,
    availableStatSeasons: player.availableStatSeasons ?? [seasonSource.season],
    stats,
    statsTotal,
  };
}

export function getDraftStatSeasonOptions(
  players: Player[],
  requestedSeason?: number | null
): DraftStatSeasonOptions {
  const currentSeason = new Date().getFullYear();
  const availableSeasonSet = new Set<number>();

  for (const player of players) {
    if (typeof player.statsSeason === 'number' && Number.isFinite(player.statsSeason)) {
      availableSeasonSet.add(player.statsSeason);
    }

    for (const season of player.availableStatSeasons ?? []) {
      if (Number.isFinite(season)) availableSeasonSet.add(season);
    }
  }

  const availableSeasons = Array.from(availableSeasonSet).sort((a, b) => b - a);
  const fallbackSeason = availableSeasons[0] ?? currentSeason;
  const selectedSeason =
    requestedSeason && availableSeasonSet.has(requestedSeason) ? requestedSeason : fallbackSeason;

  return {
    selectedSeason,
    availableSeasons: availableSeasons.length > 0 ? availableSeasons : [fallbackSeason],
  };
}

export function buildDraftPlayerStatsLookup(
  players: Player[],
  options: { season?: number | null } = {}
) {
  const byId = new Map<string, DraftPlayerStatsProjection>();
  const byNameAndTeam = new Map<string, DraftPlayerStatsProjection>();
  const byName = new Map<string, DraftPlayerStatsProjection>();
  const ambiguousNames = new Set<string>();

  for (const player of players) {
    const projection = projectDraftPlayerStats(player, options.season);
    if (!projection) continue;

    byId.set(player.id, projection);
    byId.set(buildCanonicalPlayerId(player.id), projection);
    byId.set(buildCanonicalPlayerId(player.name), projection);

    const normalizedName = normalizeLookupPart(player.name);
    const normalizedTeam = normalizeLookupPart(player.team);

    if (normalizedName && normalizedTeam) {
      byNameAndTeam.set(`${normalizedName}|${normalizedTeam}`, projection);
    }

    if (!normalizedName || ambiguousNames.has(normalizedName)) {
      continue;
    }

    if (!byName.has(normalizedName)) {
      byName.set(normalizedName, projection);
      continue;
    }

    byName.delete(normalizedName);
    ambiguousNames.add(normalizedName);
  }

  return { byId, byNameAndTeam, byName };
}

export async function loadDraftPlayerStatsLookup(
  options: { season?: number | null } = {}
): Promise<DraftPlayerStatsLookup> {
  return buildDraftPlayerStatsLookup(await getPlayers(), options);
}

export async function loadDraftStatSeasonOptions(
  requestedSeason?: number | null
): Promise<DraftStatSeasonOptions> {
  return getDraftStatSeasonOptions(await getPlayers(), requestedSeason);
}

function findStatsProjection(
  lookup: DraftPlayerStatsLookup,
  player: AvailableDraftPlayerSource
): DraftPlayerStatsProjection | undefined {
  return (
    lookup.byId.get(player.id) ??
    lookup.byId.get(buildCanonicalPlayerId(player.id)) ??
    lookup.byId.get(buildCanonicalPlayerId(player.name)) ??
    lookup.byNameAndTeam.get(
      `${normalizeLookupPart(player.name)}|${normalizeLookupPart(player.club)}`
    ) ??
    lookup.byName.get(normalizeLookupPart(player.name))
  );
}

export function buildAvailableDraftPlayer(
  player: AvailableDraftPlayerSource,
  statsLookup: DraftPlayerStatsLookup | null
) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    club: player.club,
    isAvailable: true,
    ...(statsLookup ? findStatsProjection(statsLookup, player) : undefined),
  };
}
