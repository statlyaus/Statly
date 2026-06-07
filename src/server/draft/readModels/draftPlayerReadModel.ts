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

type DraftPlayerStatsProjection = {
  avgPoints: number;
  averagePoints: number;
  fantasyPoints: number;
  gamesPlayed: number;
  stats: Partial<PlayerStats>;
  statsTotal: Partial<PlayerStats>;
};

export type AvailableDraftPlayerSource = {
  id: string;
  name: string;
  position: string;
  club: string;
};

export type DraftPlayerStatsLookup = ReturnType<typeof buildDraftPlayerStatsLookup>;

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

function readNumericStat(player: Player, key: keyof PlayerStats): number {
  const stats = player.stats ?? {};
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

function buildCompleteStats(
  player: Player,
  gamesPlayed: number
): PlayerStats & { aflFantasy?: number } {
  const stats = STAT_KEYS.reduce(
    (acc, key) => {
      acc[key] = readNumericStat(player, key);
      return acc;
    },
    { games: gamesPlayed } as PlayerStats
  );

  const aflFantasy = player.stats?.aflFantasy;
  if (typeof aflFantasy === 'number' && Number.isFinite(aflFantasy)) {
    return { ...stats, aflFantasy };
  }

  return stats;
}

function projectDraftPlayerStats(player: Player): DraftPlayerStatsProjection | null {
  const explicitGames = typeof player.games === 'number' && player.games > 0 ? player.games : null;
  const hasAnyStats = STAT_KEYS.some((key) => readNumericStat(player, key) !== 0);

  if (!explicitGames && !hasAnyStats) {
    return null;
  }

  const gamesPlayed = explicitGames ?? 1;
  const completeStats = buildCompleteStats(player, gamesPlayed);
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
    stats,
    statsTotal,
  };
}

export function buildDraftPlayerStatsLookup(players: Player[]) {
  const byId = new Map<string, DraftPlayerStatsProjection>();
  const byNameAndTeam = new Map<string, DraftPlayerStatsProjection>();
  const byName = new Map<string, DraftPlayerStatsProjection>();
  const ambiguousNames = new Set<string>();

  for (const player of players) {
    const projection = projectDraftPlayerStats(player);
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

export async function loadDraftPlayerStatsLookup(): Promise<DraftPlayerStatsLookup> {
  return buildDraftPlayerStatsLookup(await getPlayers());
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
