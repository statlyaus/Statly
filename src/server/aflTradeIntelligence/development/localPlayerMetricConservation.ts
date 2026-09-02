import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';

export const LOCAL_GENUINE_PLAYER_MATCH_CONSERVATION_POLICY_VERSION =
  'local-genuine-player-match-conservation/v1' as const;

type ConservedMetricCode = 'goals' | 'brownlow_votes' | 'coaches_votes';

export interface LocalPlayerMatchAppearance {
  playerId: string;
  clubId: string;
  sourceFactId: string;
}

export interface LocalPositivePlayerMetric {
  playerId: string;
  clubId: string;
  metricCode: ConservedMetricCode;
  value: number;
  sourceFactId: string;
}

export interface LocalPlayerMatchMetricConservationInput {
  matchId: string;
  matchCompletionSourceFactId: string;
  seasonYear: number;
  matchDate: string;
  scope: 'home_and_away';
  homeClubId: string;
  awayClubId: string;
  clubGoalTotals: readonly { clubId: string; goals: number; sourceFactId: string }[];
  appearances: readonly LocalPlayerMatchAppearance[];
  positiveMetrics: readonly LocalPositivePlayerMetric[];
}

type MetricProvenance = Readonly<{
  kind: 'measured_positive' | 'conservation_derived_zero';
  sourceFactIds: readonly string[];
}>;

export interface ConservedLocalPlayerMatchMetricRow {
  matchId: string;
  seasonYear: number;
  matchDate: string;
  playerId: string;
  clubId: string;
  metrics: Readonly<{
    games: 1;
    goals: number;
    brownlow_votes: number;
    coaches_votes: number;
  }>;
  provenance: Readonly<{
    games: Readonly<{ kind: 'reviewed_appearance'; sourceFactIds: readonly string[] }>;
    goals: MetricProvenance;
    brownlow_votes: MetricProvenance;
    coaches_votes: MetricProvenance;
  }>;
}

export interface ConservedLocalPlayerMatchMetrics {
  policyVersion: typeof LOCAL_GENUINE_PLAYER_MATCH_CONSERVATION_POLICY_VERSION;
  conservationSha256: string;
  rows: readonly ConservedLocalPlayerMatchMetricRow[];
}

export class LocalPlayerMetricConservationError extends Error {
  constructor(
    readonly code:
      | 'INVALID_MATCH_EVIDENCE'
      | 'DUPLICATE_APPEARANCE'
      | 'UNKNOWN_METRIC_RECIPIENT'
      | 'DUPLICATE_METRIC_FACT'
      | 'GOAL_TOTAL_MISMATCH'
      | 'BROWNLOW_TOTAL_MISMATCH'
      | 'COACHES_TOTAL_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'LocalPlayerMetricConservationError';
  }
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function appearanceKey(appearance: LocalPlayerMatchAppearance): string {
  return `${appearance.playerId}\u0000${appearance.clubId}`;
}

function metricKey(metric: Pick<LocalPositivePlayerMetric, 'playerId' | 'metricCode'>): string {
  return `${metric.playerId}\u0000${metric.metricCode}`;
}

function validateMatch(input: LocalPlayerMatchMetricConservationInput): void {
  const matchDate = /^\d{4}-\d{2}-\d{2}$/.test(input.matchDate)
    ? Date.parse(`${input.matchDate}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !nonEmpty(input.matchId) ||
    !nonEmpty(input.matchCompletionSourceFactId) ||
    !Number.isInteger(input.seasonYear) ||
    input.seasonYear < 1897 ||
    !Number.isFinite(matchDate) ||
    Number(input.matchDate.slice(0, 4)) !== input.seasonYear ||
    !nonEmpty(input.homeClubId) ||
    !nonEmpty(input.awayClubId) ||
    input.homeClubId === input.awayClubId ||
    input.appearances.length === 0
  ) {
    throw new LocalPlayerMetricConservationError(
      'INVALID_MATCH_EVIDENCE',
      'Conservation requires one valid completed home-and-away match and reviewed appearances.'
    );
  }

  const goalTotals = new Map(input.clubGoalTotals.map(({ clubId, goals }) => [clubId, goals]));
  if (
    input.clubGoalTotals.length !== 2 ||
    goalTotals.size !== 2 ||
    !goalTotals.has(input.homeClubId) ||
    !goalTotals.has(input.awayClubId) ||
    [...goalTotals.values()].some((goals) => !nonNegativeInteger(goals)) ||
    input.clubGoalTotals.some(({ sourceFactId }) => !nonEmpty(sourceFactId))
  ) {
    throw new LocalPlayerMetricConservationError(
      'INVALID_MATCH_EVIDENCE',
      'Conservation requires exact non-negative scoreboard goal totals for both match clubs.'
    );
  }
}

function validateAppearances(input: LocalPlayerMatchMetricConservationInput): Set<string> {
  const permittedClubs = new Set([input.homeClubId, input.awayClubId]);
  const keys = new Set<string>();
  const players = new Set<string>();
  for (const appearance of input.appearances) {
    const key = appearanceKey(appearance);
    if (
      !nonEmpty(appearance.playerId) ||
      !nonEmpty(appearance.sourceFactId) ||
      !permittedClubs.has(appearance.clubId) ||
      keys.has(key) ||
      players.has(appearance.playerId)
    ) {
      throw new LocalPlayerMetricConservationError(
        'DUPLICATE_APPEARANCE',
        'Every reviewed player may appear exactly once for one of the two match clubs.'
      );
    }
    keys.add(key);
    players.add(appearance.playerId);
  }
  return keys;
}

function validateMetrics(
  input: LocalPlayerMatchMetricConservationInput,
  appearances: ReadonlySet<string>
): Map<string, LocalPositivePlayerMetric> {
  const metrics = new Map<string, LocalPositivePlayerMetric>();
  for (const metric of input.positiveMetrics) {
    if (!appearances.has(appearanceKey(metric))) {
      throw new LocalPlayerMetricConservationError(
        'UNKNOWN_METRIC_RECIPIENT',
        'Every positive metric recipient must bind one exact reviewed match appearance.'
      );
    }
    const validBound =
      metric.metricCode === 'brownlow_votes'
        ? metric.value <= 3
        : metric.metricCode === 'coaches_votes'
          ? metric.value <= 10
          : true;
    if (!positiveInteger(metric.value) || !validBound || !nonEmpty(metric.sourceFactId)) {
      throw new LocalPlayerMetricConservationError(
        'INVALID_MATCH_EVIDENCE',
        'Positive match metrics require exact bounded integer values and source facts.'
      );
    }
    const key = metricKey(metric);
    if (metrics.has(key)) {
      throw new LocalPlayerMetricConservationError(
        'DUPLICATE_METRIC_FACT',
        'A player may have only one exact positive fact for each conserved match metric.'
      );
    }
    metrics.set(key, metric);
  }
  return metrics;
}

function requireConservation(
  input: LocalPlayerMatchMetricConservationInput,
  metrics: ReadonlyMap<string, LocalPositivePlayerMetric>
): void {
  const goalTotals = new Map(input.clubGoalTotals.map(({ clubId, goals }) => [clubId, goals]));
  for (const clubId of [input.homeClubId, input.awayClubId]) {
    const observed = [...metrics.values()]
      .filter((metric) => metric.metricCode === 'goals' && metric.clubId === clubId)
      .reduce((total, metric) => total + metric.value, 0);
    if (observed !== goalTotals.get(clubId)) {
      throw new LocalPlayerMetricConservationError(
        'GOAL_TOTAL_MISMATCH',
        `Positive player goals do not conserve the exact ${clubId} scoreboard total.`
      );
    }
  }
  const total = (metricCode: ConservedMetricCode): number =>
    [...metrics.values()]
      .filter((metric) => metric.metricCode === metricCode)
      .reduce((sum, metric) => sum + metric.value, 0);
  if (total('brownlow_votes') !== 6) {
    throw new LocalPlayerMetricConservationError(
      'BROWNLOW_TOTAL_MISMATCH',
      'Positive Brownlow votes must conserve the exact six-vote home-and-away match total.'
    );
  }
  if (total('coaches_votes') !== 30) {
    throw new LocalPlayerMetricConservationError(
      'COACHES_TOTAL_MISMATCH',
      'Positive coaches votes must conserve the exact thirty-vote home-and-away match total.'
    );
  }
}

function metricValue(
  metrics: ReadonlyMap<string, LocalPositivePlayerMetric>,
  playerId: string,
  metricCode: ConservedMetricCode,
  zeroEvidenceIds: readonly string[]
): { value: number; provenance: MetricProvenance } {
  const measured = metrics.get(metricKey({ playerId, metricCode }));
  return measured
    ? {
        value: measured.value,
        provenance: { kind: 'measured_positive', sourceFactIds: [measured.sourceFactId] },
      }
    : {
        value: 0,
        provenance: {
          kind: 'conservation_derived_zero',
          sourceFactIds: [...new Set(zeroEvidenceIds)].sort(),
        },
      };
}

export function conserveLocalPlayerMatchMetrics(
  input: LocalPlayerMatchMetricConservationInput
): ConservedLocalPlayerMatchMetrics {
  validateMatch(input);
  const appearances = validateAppearances(input);
  const metrics = validateMetrics(input, appearances);
  requireConservation(input, metrics);

  const rows = [...input.appearances]
    .sort(
      (left, right) =>
        left.playerId.localeCompare(right.playerId) || left.clubId.localeCompare(right.clubId)
    )
    .map((appearance): ConservedLocalPlayerMatchMetricRow => {
      const matchEvidence = [
        input.matchCompletionSourceFactId,
        ...input.appearances.map(({ sourceFactId }) => sourceFactId),
      ];
      const goals = metricValue(metrics, appearance.playerId, 'goals', [
        ...matchEvidence,
        input.clubGoalTotals.find(({ clubId }) => clubId === appearance.clubId)!.sourceFactId,
        ...[...metrics.values()]
          .filter((metric) => metric.metricCode === 'goals' && metric.clubId === appearance.clubId)
          .map(({ sourceFactId }) => sourceFactId),
      ]);
      const brownlow = metricValue(metrics, appearance.playerId, 'brownlow_votes', [
        ...matchEvidence,
        ...[...metrics.values()]
          .filter((metric) => metric.metricCode === 'brownlow_votes')
          .map(({ sourceFactId }) => sourceFactId),
      ]);
      const coaches = metricValue(metrics, appearance.playerId, 'coaches_votes', [
        ...matchEvidence,
        ...[...metrics.values()]
          .filter((metric) => metric.metricCode === 'coaches_votes')
          .map(({ sourceFactId }) => sourceFactId),
      ]);
      return {
        matchId: input.matchId,
        seasonYear: input.seasonYear,
        matchDate: input.matchDate,
        playerId: appearance.playerId,
        clubId: appearance.clubId,
        metrics: {
          games: 1,
          goals: goals.value,
          brownlow_votes: brownlow.value,
          coaches_votes: coaches.value,
        },
        provenance: {
          games: {
            kind: 'reviewed_appearance',
            sourceFactIds: [appearance.sourceFactId, input.matchCompletionSourceFactId].sort(),
          },
          goals: goals.provenance,
          brownlow_votes: brownlow.provenance,
          coaches_votes: coaches.provenance,
        },
      };
    });
  const content = {
    policyVersion: LOCAL_GENUINE_PLAYER_MATCH_CONSERVATION_POLICY_VERSION,
    match: {
      matchId: input.matchId,
      seasonYear: input.seasonYear,
      matchDate: input.matchDate,
      scope: input.scope,
      homeClubId: input.homeClubId,
      awayClubId: input.awayClubId,
      clubGoalTotals: [...input.clubGoalTotals].sort((left, right) =>
        left.clubId.localeCompare(right.clubId)
      ),
    },
    rows,
  };
  return {
    policyVersion: LOCAL_GENUINE_PLAYER_MATCH_CONSERVATION_POLICY_VERSION,
    conservationSha256: sha256AflTradeCanonicalJson(content),
    rows,
  };
}
