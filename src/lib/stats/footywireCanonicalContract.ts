import { canonicalStatRawAliases, type CanonicalStatKey } from './statColumns';

export type FootywireCanonicalStatField =
  | 'kicks'
  | 'handballs'
  | 'disposals'
  | 'marks'
  | 'tackles'
  | 'goals'
  | 'behinds'
  | 'hit_outs'
  | 'clearances'
  | 'inside_50s'
  | 'rebound_50s'
  | 'clangers'
  | 'contested_possessions'
  | 'uncontested_possessions'
  | 'frees_for'
  | 'frees_against'
  | 'one_percenters'
  | 'goal_assists'
  | 'turnovers'
  | 'intercepts'
  | 'metres_gained'
  | 'contested_marks'
  | 'effective_disposals'
  | 'score_involvements'
  | 'minutes'
  | 'tog_pct'
  | 'disposal_efficiency';

export const FOOTYWIRE_CANONICAL_STAT_FIELDS = [
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
  'disposal_efficiency',
] as const satisfies readonly FootywireCanonicalStatField[];

export const FOOTYWIRE_CANONICAL_SOURCE_PRIORITY = [
  'fitzroy_merged',
  'footywire_match',
  'afltables',
  'legacy_top_level',
] as const;

export type FootywireCanonicalSource = (typeof FOOTYWIRE_CANONICAL_SOURCE_PRIORITY)[number];

export function rankFootywireCanonicalSource(source: string | null | undefined): number {
  const index = FOOTYWIRE_CANONICAL_SOURCE_PRIORITY.indexOf(source as FootywireCanonicalSource);
  return index === -1 ? FOOTYWIRE_CANONICAL_SOURCE_PRIORITY.length : index;
}

export function isCanonicalStatPresent(params: {
  availabilityValue: boolean | null | undefined;
  rawValue: number | null | undefined;
}): boolean {
  if (params.availabilityValue != null) return params.availabilityValue;
  return params.rawValue != null;
}

export const FOOTYWIRE_CANONICAL_FIELD_BY_STAT_KEY: Record<
  CanonicalStatKey,
  FootywireCanonicalStatField
> = {
  goals: 'goals',
  behinds: 'behinds',
  kicks: 'kicks',
  handballs: 'handballs',
  disposals: 'disposals',
  marks: 'marks',
  tackles: 'tackles',
  hitouts: 'hit_outs',
  clearances: 'clearances',
  inside50s: 'inside_50s',
  rebound50s: 'rebound_50s',
  contestedPossessions: 'contested_possessions',
  uncontestedPossessions: 'uncontested_possessions',
  goalAssists: 'goal_assists',
  scoreInvolvements: 'score_involvements',
  effectiveDisposals: 'effective_disposals',
  disposalEffPct: 'disposal_efficiency',
  timeOnGroundPct: 'tog_pct',
  minutes: 'minutes',
  contestedMarks: 'contested_marks',
  intercepts: 'intercepts',
  metresGained: 'metres_gained',
  turnovers: 'turnovers',
  freesFor: 'frees_for',
  freesAgainst: 'frees_against',
  onePercenters: 'one_percenters',
  clangers: 'clangers',
};

export type FootywireCanonicalStats = Record<FootywireCanonicalStatField, number>;

export type FootywireCanonicalAvailability = Record<FootywireCanonicalStatField, boolean>;

export type FootywireCanonicalProvenance = Partial<Record<FootywireCanonicalStatField, string>>;

export type FootywireCanonicalRawMatchContract = {
  version: 1;
  source_name: string;
  stats: FootywireCanonicalStats;
  availability: FootywireCanonicalAvailability;
  provenance: FootywireCanonicalProvenance;
  source_priority: string[];
  raw_source_rows: Record<string, unknown> | null;
};

type BuildCanonicalContractParams = {
  stats: FootywireCanonicalStats;
  availability: Partial<Record<FootywireCanonicalStatField, boolean>>;
  provenance?: Partial<Record<FootywireCanonicalStatField, string | null | undefined>>;
  sourceName: string;
  sourcePriority?: string[];
  rawSourceRows?: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

export function buildFootywireCanonicalAvailability(
  hasValue: (field: FootywireCanonicalStatField) => boolean
): FootywireCanonicalAvailability {
  return Object.fromEntries(
    FOOTYWIRE_CANONICAL_STAT_FIELDS.map((field) => [field, hasValue(field)])
  ) as FootywireCanonicalAvailability;
}

export function buildFootywireCanonicalProvenance(
  getSource: (field: FootywireCanonicalStatField) => string | null | undefined
): FootywireCanonicalProvenance {
  return Object.fromEntries(
    FOOTYWIRE_CANONICAL_STAT_FIELDS.flatMap((field) => {
      const source = getSource(field);
      return typeof source === 'string' && source.trim().length > 0 ? [[field, source]] : [];
    })
  ) as FootywireCanonicalProvenance;
}

export function buildFootywireCanonicalRawMatchContract(
  params: BuildCanonicalContractParams
): FootywireCanonicalRawMatchContract {
  return {
    version: 1,
    source_name: params.sourceName,
    stats: params.stats,
    availability: buildFootywireCanonicalAvailability(
      (field) => params.availability[field] === true
    ),
    provenance: buildFootywireCanonicalProvenance((field) => params.provenance?.[field]),
    source_priority: params.sourcePriority ?? [],
    raw_source_rows: params.rawSourceRows ?? null,
  };
}

export function hasFootywireCanonicalRawMatchContract(
  value: unknown
): value is FootywireCanonicalRawMatchContract {
  if (!isRecord(value)) return false;

  return value.version === 1 && isRecord(value.stats) && isRecord(value.availability);
}

export function readFootywireCanonicalRawMatchContract(
  value: unknown
): FootywireCanonicalRawMatchContract | null {
  return hasFootywireCanonicalRawMatchContract(value) ? value : null;
}

export function readFootywireCanonicalContractBucket(
  value: unknown,
  bucket: 'stats' | 'availability' | 'provenance'
): Record<string, unknown> | null {
  const contract = readFootywireCanonicalRawMatchContract(value);
  if (!contract) return null;

  const section = contract[bucket];
  return isRecord(section) ? section : null;
}

export function readFootywireCanonicalContractCandidate(
  value: unknown,
  bucket: 'stats' | 'availability' | 'provenance',
  statKey: CanonicalStatKey
): { found: boolean; field: FootywireCanonicalStatField; value: unknown } {
  const section = readFootywireCanonicalContractBucket(value, bucket);
  const field = FOOTYWIRE_CANONICAL_FIELD_BY_STAT_KEY[statKey];
  if (section && Object.prototype.hasOwnProperty.call(section, field)) {
    return { found: true, field, value: section[field] };
  }

  for (const alias of canonicalStatRawAliases(statKey)) {
    if (section && Object.prototype.hasOwnProperty.call(section, alias)) {
      return { found: true, field, value: section[alias] };
    }
  }

  return { found: false, field, value: undefined };
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function readFootywireCanonicalStatNumber(
  value: unknown,
  statKey: CanonicalStatKey
): { found: boolean; value: number } {
  const candidate = readFootywireCanonicalContractCandidate(value, 'stats', statKey);

  return {
    found: candidate.found,
    value: candidate.found ? readNumber(candidate.value) : 0,
  };
}

export function readFootywireCanonicalStatPresence(
  value: unknown,
  statKey: CanonicalStatKey
): { hasValue: boolean; hasNonZeroValue: boolean } {
  const availability = readFootywireCanonicalContractCandidate(value, 'availability', statKey);
  const stat = readFootywireCanonicalStatNumber(value, statKey);
  const hasValue = isCanonicalStatPresent({
    availabilityValue:
      availability.found && typeof availability.value === 'boolean' ? availability.value : null,
    rawValue: stat.found ? stat.value : null,
  });

  return { hasValue, hasNonZeroValue: hasValue && stat.value !== 0 };
}

export function readFootywireCanonicalStatProvenance(
  value: unknown,
  statKey: CanonicalStatKey
): string | null {
  const candidate = readFootywireCanonicalContractCandidate(value, 'provenance', statKey);

  return candidate.found && typeof candidate.value === 'string' ? candidate.value : null;
}
