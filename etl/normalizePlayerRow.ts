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
    PLAYER_NUMERIC_FIELDS.map((field) => [field, toFiniteNumber(row[field], field)])
  ) as Partial<Pick<PlayerRow, PlayerNumericField>>;

  return {
    season: requiredFiniteNumber(row.season, 'season'),
    round: requiredFiniteNumber(row.round, 'round'),
    team: requiredString(row, 'team'),
    opposition: typeof row.opposition === 'string' ? row.opposition.trim() : '',
    player_name: requiredString(row, 'player_name'),
    ...numericStats,
  };
}

export { normalizePlayerRow };
export type { PlayerRow };
