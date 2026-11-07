import type { NbaDnpReason, NbaGameStatus, NbaInjuryStatus } from '@prisma/client';

import type { EasternDate } from '@/lib/basketball/fantasyWeeks';

/**
 * The NBA stats provider port. An adapter (today only `espn/`) fetches, validates and converts its
 * source into these provider-neutral shapes: standard team codes (GSW, NYK, SAS), seconds played, a
 * did-not-play reason enum and US Eastern game dates. Jobs never see a provider's own spellings.
 *
 * Every method throws `NbaIngestRejected` with `fetch_failed` (network, timeout, non-2xx) or
 * `parse_failed` (the response does not have the expected shape, or names an unknown team).
 * Only regular-season games are returned.
 */
export interface NbaStatsProvider {
  /** Stored as `NbaPlayerIdentity.provider`, `NbaGame.provider` and `NbaIngestRun.provider`. */
  readonly id: string;
  /** False when the source's terms forbid commercial use. See `assertNbaProviderAllowed`. */
  readonly commercialUseLicensed: boolean;
  fetchTeams(): Promise<NbaProviderTeam[]>;
  fetchTeamRoster(teamExternalId: string): Promise<NbaProviderPlayer[]>;
  fetchTeamSchedule(teamExternalId: string, season: number): Promise<NbaProviderGame[]>;
  fetchScoreboard(easternDate: EasternDate): Promise<NbaProviderGame[]>;
  fetchBoxScore(gameExternalId: string): Promise<NbaProviderBoxScore>;
  fetchInjuries(): Promise<NbaProviderInjury[]>;
  /** Regular-season totals for a sample of players, used to verify a backfill. */
  fetchSeasonTotals(season: number): Promise<NbaProviderSeasonTotal[]>;
}

export interface NbaProviderTeam {
  externalId: string;
  /** Standard three-letter code. */
  code: string;
  name: string;
}

export interface NbaProviderPlayer {
  externalId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  /** As the provider lists them, e.g. ["G"] or ["PG", "SG"]. */
  positions: string[];
  birthDate: EasternDate | null;
}

export interface NbaProviderGame {
  externalId: string;
  /** The year the season ends: 2026-27 is 2027. */
  season: number;
  startsAt: Date;
  /** US Eastern date of `startsAt`. */
  gameDate: EasternDate;
  homeTeamCode: string;
  awayTeamCode: string;
  status: NbaGameStatus;
  /** Null until the game has started. */
  homeScore: number | null;
  awayScore: number | null;
}

export interface NbaProviderPlayerLine {
  player: { externalId: string; fullName: string; positions: string[] };
  teamCode: string;
  starter: boolean;
  played: boolean;
  /** Only when the player was listed but did not play. */
  dnpReason: NbaDnpReason | null;
  secondsPlayed: number;
  points: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  personalFouls: number;
  plusMinus: number;
}

export interface NbaProviderBoxScore {
  game: NbaProviderGame;
  /** Every player the box score lists, including did-not-play rows. */
  lines: NbaProviderPlayerLine[];
  /** Did-not-play rows dropped because the provider gave no player identity. */
  unidentifiedDidNotPlay: number;
}

export interface NbaProviderInjury {
  athleteExternalId: string;
  status: NbaInjuryStatus;
  detail: string | null;
  expectedReturnOn: EasternDate | null;
  reportedAt: Date | null;
}

export interface NbaProviderSeasonTotal {
  athleteExternalId: string;
  fullName: string;
  gamesPlayed: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
}

export type NbaIngestRejectionReason =
  'fetch_failed' | 'parse_failed' | 'out_of_bounds' | 'unlicensed_provider';

/** A run refused before writing anything but its `NbaIngestRun` row. */
export class NbaIngestRejected extends Error {
  constructor(
    readonly reason: NbaIngestRejectionReason,
    message: string,
    options?: { cause?: unknown; httpStatus?: number }
  ) {
    super(message, options);
    this.name = 'NbaIngestRejected';
    this.httpStatus = options?.httpStatus;
  }

  /** The upstream HTTP status of a `fetch_failed`, when there was one. */
  readonly httpStatus: number | undefined;
}
