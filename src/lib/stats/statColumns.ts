export type CanonicalStatKey =
  | 'goals'
  | 'behinds'
  | 'kicks'
  | 'handballs'
  | 'disposals'
  | 'marks'
  | 'tackles'
  | 'hitouts'
  | 'clearances'
  | 'inside50s'
  | 'rebound50s'
  | 'contestedPossessions'
  | 'uncontestedPossessions'
  | 'goalAssists'
  | 'scoreInvolvements'
  | 'effectiveDisposals'
  | 'disposalEffPct'
  | 'timeOnGroundPct'
  | 'minutes'
  | 'contestedMarks'
  | 'intercepts'
  | 'metresGained'
  | 'turnovers'
  | 'freesFor'
  | 'freesAgainst'
  | 'onePercenters'
  | 'clangers';

export const STAT_COLUMNS: Record<CanonicalStatKey, { label: string; short?: string }> = {
  goals: { label: 'Goals', short: 'G' },
  behinds: { label: 'Behinds', short: 'B' },
  kicks: { label: 'Kicks', short: 'K' },
  handballs: { label: 'Handballs', short: 'HB' },
  disposals: { label: 'Disposals', short: 'D' },
  marks: { label: 'Marks', short: 'M' },
  tackles: { label: 'Tackles', short: 'T' },
  hitouts: { label: 'Hitouts', short: 'HO' },
  clearances: { label: 'Clearances', short: 'CL' },
  inside50s: { label: 'Inside 50s', short: 'I50' },
  rebound50s: { label: 'Rebound 50s', short: 'R50' },
  contestedPossessions: { label: 'Contested Poss.', short: 'CP' },
  uncontestedPossessions: { label: 'Uncontested Poss.', short: 'UP' },
  goalAssists: { label: 'Goal Assists', short: 'GA' },
  scoreInvolvements: { label: 'Score Involvements', short: 'SI' },
  effectiveDisposals: { label: 'Effective Disposals', short: 'ED' },
  disposalEffPct: { label: 'Disposal Eff. %', short: 'DE%' },
  timeOnGroundPct: { label: 'Time On Ground %', short: 'TG%' },
  minutes: { label: 'Minutes', short: 'MIN' },
  contestedMarks: { label: 'Contested Marks', short: 'CM' },
  intercepts: { label: 'Intercepts', short: 'INT' },
  metresGained: { label: 'Metres Gained', short: 'MG' },
  turnovers: { label: 'Turnovers', short: 'TO' },
  freesFor: { label: 'Frees For', short: 'FF' },
  freesAgainst: { label: 'Frees Against', short: 'FA' },
  onePercenters: { label: 'One Percenters', short: '1P' },
  clangers: { label: 'Clangers', short: 'CLG' },
};

export const CANONICAL_STAT_KEYS = Object.keys(STAT_COLUMNS) as CanonicalStatKey[];
export const DOWNSTREAM_ENRICHED_STAT_KEYS = ['timeOnGroundPct'] as const satisfies readonly CanonicalStatKey[];

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const CATEGORY_ALIAS_MAP: Record<string, CanonicalStatKey> = {
  goals: 'goals',
  goalspergame: 'goals',
  g: 'goals',
  behinds: 'behinds',
  b: 'behinds',
  kicks: 'kicks',
  k: 'kicks',
  handballs: 'handballs',
  hb: 'handballs',
  disposals: 'disposals',
  d: 'disposals',
  marks: 'marks',
  m: 'marks',
  tackles: 'tackles',
  t: 'tackles',
  hitouts: 'hitouts',
  ho: 'hitouts',
  clearances: 'clearances',
  cl: 'clearances',
  inside50s: 'inside50s',
  i50: 'inside50s',
  insidefifties: 'inside50s',
  rebound50s: 'rebound50s',
  reboundfifties: 'rebound50s',
  r50: 'rebound50s',
  contestedpossessions: 'contestedPossessions',
  cp: 'contestedPossessions',
  uncontestedpossessions: 'uncontestedPossessions',
  uncontested: 'uncontestedPossessions',
  goalassists: 'goalAssists',
  ga: 'goalAssists',
  scoreinvolvements: 'scoreInvolvements',
  si: 'scoreInvolvements',
  effectivedisposals: 'effectiveDisposals',
  ed: 'effectiveDisposals',
  disposaleffpct: 'disposalEffPct',
  timeongroundpct: 'timeOnGroundPct',
  minutes: 'minutes',
  contestedmarks: 'contestedMarks',
  cm: 'contestedMarks',
  intercepts: 'intercepts',
  int: 'intercepts',
  metresgained: 'metresGained',
  mg: 'metresGained',
  turnovers: 'turnovers',
  to: 'turnovers',
  freesfor: 'freesFor',
  ff: 'freesFor',
  freesagainst: 'freesAgainst',
  fa: 'freesAgainst',
  onepercenters: 'onePercenters',
  onep: 'onePercenters',
  clangers: 'clangers',
};

// Raw keys (Fryzigg / legacy) map into canonical
// Note: normalizeKey() removes all non-alphanumeric chars, so we need both
// original keys (with underscores) and normalized keys (without) for lookups
export const RAW_KEY_MAP: Record<string, CanonicalStatKey> = {
  // Original keys (with underscores, camelCase, etc.)
  goals: 'goals',
  behinds: 'behinds',
  kicks: 'kicks',
  handballs: 'handballs',
  disposals: 'disposals',
  marks: 'marks',
  tackles: 'tackles',
  hitouts: 'hitouts',
  hit_outs: 'hitouts',
  clearances: 'clearances',
  inside_50s: 'inside50s',
  inside50s: 'inside50s',
  insidefifties: 'inside50s',
  inside50: 'inside50s',
  i50: 'inside50s',
  rebound_50s: 'rebound50s',
  rebound50s: 'rebound50s',
  rebounds: 'rebound50s',
  r50: 'rebound50s',
  contested_possessions: 'contestedPossessions',
  contestedPossessions: 'contestedPossessions',
  contestedpossess: 'contestedPossessions',
  uncontested_possessions: 'uncontestedPossessions',
  uncontestedPossessions: 'uncontestedPossessions',
  uncontested: 'uncontestedPossessions',
  goal_assists: 'goalAssists',
  goalAssists: 'goalAssists',
  ga: 'goalAssists',
  score_involvements: 'scoreInvolvements',
  scoreInvolvements: 'scoreInvolvements',
  si: 'scoreInvolvements',
  effective_disposals: 'effectiveDisposals',
  effectiveDisposals: 'effectiveDisposals',
  ed: 'effectiveDisposals',
  disposal_efficiency_percentage: 'disposalEffPct',
  disposal_efficiency: 'disposalEffPct',
  disposalEfficiency: 'disposalEffPct', // From loadAllPlayers normalization
  disposalEffPct: 'disposalEffPct',
  time_on_ground_percentage: 'timeOnGroundPct',
  timeOnGroundPct: 'timeOnGroundPct',
  time_on_ground_pct: 'timeOnGroundPct',
  tog_pct: 'timeOnGroundPct',
  minutes: 'minutes',
  contested_marks: 'contestedMarks',
  contestedMarks: 'contestedMarks',
  cm: 'contestedMarks',
  intercepts: 'intercepts',
  metres_gained: 'metresGained',
  metresGained: 'metresGained',
  mg: 'metresGained',
  turnovers: 'turnovers',
  frees_for: 'freesFor',
  freesFor: 'freesFor',
  frees_against: 'freesAgainst',
  freesAgainst: 'freesAgainst',
  fa: 'freesAgainst',
  one_percenters: 'onePercenters',
  onePercenters: 'onePercenters',
  clangers: 'clangers',
  // Normalized keys (all lowercase, no special chars) - needed for normalizeKey() lookups
  contestedpossessions: 'contestedPossessions',
  uncontestedpossessions: 'uncontestedPossessions',
  goalassists: 'goalAssists',
  scoreinvolvements: 'scoreInvolvements',
  effectivedisposals: 'effectiveDisposals',
  disposalefficiencypercentage: 'disposalEffPct',
  disposalefficiency: 'disposalEffPct',
  timeongroundpercentage: 'timeOnGroundPct',
  timeongroundpct: 'timeOnGroundPct',
  togpt: 'timeOnGroundPct',
  contestedmarks: 'contestedMarks',
  metresgained: 'metresGained',
  freesfor: 'freesFor',
  freesagainst: 'freesAgainst',
  onepercenters: 'onePercenters',
};

export const BLOCKED_STAT_KEYS = new Set(['supercoach_score', 'dt_score', 'dreamteam_score']);

export function canonicalStatKeyFromCategory(category: string): CanonicalStatKey | undefined {
  return CATEGORY_ALIAS_MAP[normalizeKey(category)] ?? undefined;
}

export function canonicalStatKeyFromRaw(key: string): CanonicalStatKey | undefined {
  const alias = normalizeKey(key);
  return RAW_KEY_MAP[alias] ?? CATEGORY_ALIAS_MAP[alias] ?? undefined;
}

export function canonicalStatRawAliases(key: CanonicalStatKey): string[] {
  switch (key) {
    case 'hitouts':
      return ['hit_outs'];
    case 'inside50s':
      return ['inside_50s'];
    case 'rebound50s':
      return ['rebound_50s'];
    case 'contestedPossessions':
      return ['contested_possessions'];
    case 'uncontestedPossessions':
      return ['uncontested_possessions'];
    case 'goalAssists':
      return ['goal_assists'];
    case 'scoreInvolvements':
      return ['score_involvements'];
    case 'effectiveDisposals':
      return ['effective_disposals'];
    case 'disposalEffPct':
      return ['disposal_efficiency', 'disposal_efficiency_percentage'];
    case 'timeOnGroundPct':
      return ['tog_pct', 'time_on_ground_percentage', 'time_on_ground_pct'];
    case 'contestedMarks':
      return ['contested_marks'];
    case 'intercepts':
      return [];
    case 'metresGained':
      return ['metres_gained', 'MG', 'mg'];
    case 'turnovers':
      return [];
    case 'freesFor':
      return ['frees_for'];
    case 'freesAgainst':
      return ['frees_against'];
    case 'onePercenters':
      return ['one_percenters'];
    default:
      return [];
  }
}

export function isDownstreamEnrichedStatKey(key: CanonicalStatKey): boolean {
  return (DOWNSTREAM_ENRICHED_STAT_KEYS as readonly CanonicalStatKey[]).includes(key);
}
