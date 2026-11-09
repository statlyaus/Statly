interface PlayerRow {
  season: number;
  round: number;
  team: string;
  opposition: string;
  player_name: string;
  kicks?: number;
  handballs?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  behinds?: number;
  hit_outs?: number;
  clearances?: number;
  inside_50s?: number;
  rebound_50s?: number;
  clangers?: number;
  contested_possessions?: number;
  uncontested_possessions?: number;
  frees_for?: number;
  frees_against?: number;
  one_percenters?: number;
  goal_assists?: number;
  turnovers?: number;
  intercepts?: number;
  metres_gained?: number;
  contested_marks?: number;
  effective_disposals?: number;
  /** Footywire's DE: effective disposals as a percentage of disposals (0 to 100). */
  disposal_efficiency?: number;
  score_involvements?: number;
  minutes?: number;
  tog_pct?: number;
}

const PLAYER_NUMERIC_FIELDS = [
  'kicks',
  'handballs',
  'disposals',
  'marks',
  'tackles',
  'goals',
  'behinds',
  'hit_outs',
  'clearances',
  'inside_50s',
  'rebound_50s',
  'clangers',
  'contested_possessions',
  'uncontested_possessions',
  'frees_for',
  'frees_against',
  'one_percenters',
  'goal_assists',
  'turnovers',
  'intercepts',
  'metres_gained',
  'contested_marks',
  'effective_disposals',
  'disposal_efficiency',
  'score_involvements',
  'minutes',
  'tog_pct',
] as const;

type PlayerNumericField = (typeof PLAYER_NUMERIC_FIELDS)[number];

function toFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }

  const normalized = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`${field} must be a finite number`);
  }
  return normalized;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  const normalized = toFiniteNumber(value, field);
  if (normalized === undefined) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizePlayerRow(input: unknown): PlayerRow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Player row must be an object');
  }

  const row = input as Record<string, unknown>;
  const numericStats = Object.fromEntries(
    PLAYER_NUMERIC_FIELDS.flatMap((field) => {
      const value = toFiniteNumber(row[field], field);
      return value === undefined ? [] : [[field, value] as const];
    })
  ) as Partial<Pick<PlayerRow, PlayerNumericField>>;

  // A player with no disposals has no efficiency: Footywire's figure for them is not a result,
  // so it stays missing rather than reading as 0% and winning LOW_WINS leagues.
  if (numericStats.disposals === 0) {
    delete numericStats.disposal_efficiency;
  }
  const efficiency = numericStats.disposal_efficiency;
  if (efficiency !== undefined && (efficiency < 0 || efficiency > 100)) {
    throw new Error('disposal_efficiency must be a percentage from 0 to 100');
  }

  return {
    season: requiredFiniteNumber(row.season, 'season'),
    round: requiredFiniteNumber(row.round, 'round'),
    team: requiredString(row, 'team'),
    opposition: typeof row.opposition === 'string' ? row.opposition.trim() : '',
    player_name: requiredString(row, 'player_name'),
    ...numericStats,
  };
}

// Footywire names for the default nine-category preset (REAL_DATA_NINE_CATEGORY_PRESET in
// src/types/fantasyCategories.ts). A row missing any of them cannot be scored, so it is refused.
const REQUIRED_CATEGORY_FIELDS = [
  'goals',
  'tackles',
  'inside_50s',
  'intercepts',
  'contested_marks',
  'rebound_50s',
  'contested_possessions',
  'effective_disposals',
  'score_involvements',
] as const satisfies readonly PlayerNumericField[];

type ProcessedStats = Record<PlayerNumericField, number | null>;

/**
 * Maps a normalized row to the stored stats. A stat Footywire did not report stays `null`; it is
 * never written as a zero, because a zero reads as a real result and wins LOW_WINS categories.
 */
function toProcessedStats(row: PlayerRow): ProcessedStats {
  const missing = REQUIRED_CATEGORY_FIELDS.filter((field) => row[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`${row.player_name} is missing category stats: ${missing.join(', ')}`);
  }

  return Object.fromEntries(
    PLAYER_NUMERIC_FIELDS.map((field) => [field, row[field] ?? null])
  ) as ProcessedStats;
}

export { normalizePlayerRow, toProcessedStats, REQUIRED_CATEGORY_FIELDS };
export type { PlayerRow, ProcessedStats };
