import type { NbaDnpReason, NbaGameStatus } from '@prisma/client';
import { z } from 'zod';

import { isEasternDate, toEasternDate } from '@/lib/basketball/fantasyWeeks';

import {
  NbaIngestRejected,
  type NbaProviderBoxScore,
  type NbaProviderGame,
  type NbaProviderInjury,
  type NbaProviderPlayer,
  type NbaProviderPlayerLine,
  type NbaProviderSeasonTotal,
  type NbaProviderTeam,
} from '../nbaStatsProvider';

/**
 * Pure parsers for ESPN's site API. Each validates the response with zod and converts it to the
 * provider-neutral shapes; any mismatch, or a team code outside the thirty below, throws
 * `NbaIngestRejected('parse_failed')`. Schemas name only the fields we read, so extra fields pass.
 */

// ESPN's abbreviations → the standard NBA codes stored in NbaTeam.code.
const STANDARD_TEAM_CODES: Readonly<Record<string, string>> = {
  ATL: 'ATL',
  BOS: 'BOS',
  BKN: 'BKN',
  CHA: 'CHA',
  CHI: 'CHI',
  CLE: 'CLE',
  DAL: 'DAL',
  DEN: 'DEN',
  DET: 'DET',
  GS: 'GSW',
  HOU: 'HOU',
  IND: 'IND',
  LAC: 'LAC',
  LAL: 'LAL',
  MEM: 'MEM',
  MIA: 'MIA',
  MIL: 'MIL',
  MIN: 'MIN',
  NO: 'NOP',
  NY: 'NYK',
  OKC: 'OKC',
  ORL: 'ORL',
  PHI: 'PHI',
  PHX: 'PHX',
  POR: 'POR',
  SAC: 'SAC',
  SA: 'SAS',
  TOR: 'TOR',
  UTAH: 'UTA',
  WSH: 'WAS',
};

const REGULAR_SEASON = 2;
// The standard competition type. The NBA Cup final is type 2 too but competition "CC": its stats do
// not count in season totals, so it is never stored. Only the schedule and scoreboard carry the
// competition type, so they are the only sources of box-score candidates (see parseBoxScore).
const STANDARD_COMPETITION = 'STD';

function parseFailed(message: string, cause?: unknown): never {
  throw new NbaIngestRejected('parse_failed', `ESPN ${message}`, { cause });
}

function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    parseFailed(
      `${what} has an unexpected shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message}`
    );
  }
  return result.data;
}

export function standardTeamCode(espnAbbreviation: string): string {
  const code = STANDARD_TEAM_CODES[espnAbbreviation.toUpperCase()];
  if (!code) parseFailed(`team abbreviation "${espnAbbreviation}" is not one of the 30 NBA teams`);
  return code;
}

function instant(value: string, what: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) parseFailed(`${what} "${value}" is not a date`);
  return parsed;
}

function datePart(value: string | undefined | null): string | null {
  const date = value?.slice(0, 10);
  return date && isEasternDate(date) ? date : null;
}

function splitPositions(abbreviation: string | undefined): string[] {
  return (abbreviation ?? '')
    .split(/[-/]/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

// ---- Teams and rosters ----------------------------------------------------------------------

const teamsSchema = z.object({
  sports: z
    .array(
      z.object({
        leagues: z
          .array(
            z.object({
              teams: z.array(
                z.object({
                  team: z.object({
                    id: z.string(),
                    abbreviation: z.string(),
                    displayName: z.string(),
                  }),
                })
              ),
            })
          )
          .min(1),
      })
    )
    .min(1),
});

export function parseTeams(response: unknown): NbaProviderTeam[] {
  const data = validate(teamsSchema, response, 'teams');
  return data.sports[0].leagues[0].teams.map(({ team }) => ({
    externalId: team.id,
    code: standardTeamCode(team.abbreviation),
    name: team.displayName,
  }));
}

const rosterSchema = z.object({
  athletes: z.array(
    z.object({
      id: z.string(),
      fullName: z.string().min(1),
      firstName: z.string().nullish(),
      lastName: z.string().nullish(),
      position: z.object({ abbreviation: z.string() }).nullish(),
      dateOfBirth: z.string().nullish(),
    })
  ),
});

export function parseRoster(response: unknown): NbaProviderPlayer[] {
  return validate(rosterSchema, response, 'roster').athletes.map((athlete) => ({
    externalId: athlete.id,
    fullName: athlete.fullName,
    firstName: athlete.firstName ?? null,
    lastName: athlete.lastName ?? null,
    positions: splitPositions(athlete.position?.abbreviation),
    // ESPN gives local midnight in UTC ("1996-10-30T08:00Z"); the date part is the birth date.
    birthDate: datePart(athlete.dateOfBirth),
  }));
}

// ---- Games: team schedule, scoreboard, summary header ----------------------------------------

const statusSchema = z.object({
  type: z.object({ name: z.string(), state: z.string(), completed: z.boolean() }),
});

const scoreSchema = z
  .union([z.string(), z.object({ value: z.number() })])
  .nullish()
  .transform((score) => {
    if (score === null || score === undefined) return null;
    const value = typeof score === 'string' ? Number(score) : score.value;
    return Number.isInteger(value) ? value : Number.NaN;
  });

const competitorSchema = z.object({
  homeAway: z.enum(['home', 'away']),
  team: z.object({ abbreviation: z.string() }),
  score: scoreSchema,
});

const competitionSchema = z.object({
  type: z.object({ abbreviation: z.string() }),
  status: statusSchema,
  competitors: z.array(competitorSchema).length(2),
});

function gameStatus({ type }: z.infer<typeof statusSchema>): NbaGameStatus {
  if (type.name.includes('POSTPONED')) return 'POSTPONED';
  if (type.name.includes('CANCEL')) return 'CANCELLED';
  if (type.state === 'post' && type.completed) return 'FINAL';
  if (type.state === 'in') return 'IN_PROGRESS';
  return 'SCHEDULED';
}

function toGame(
  event: { id: string; date: string; season: number },
  status: z.infer<typeof statusSchema>,
  competitors: Array<z.infer<typeof competitorSchema>>
): NbaProviderGame {
  const home = competitors.find((competitor) => competitor.homeAway === 'home');
  const away = competitors.find((competitor) => competitor.homeAway === 'away');
  if (!home || !away) parseFailed(`event ${event.id} does not have one home and one away team`);
  const startsAt = instant(event.date, `event ${event.id} date`);
  const statusValue = gameStatus(status);
  const started = statusValue === 'IN_PROGRESS' || statusValue === 'FINAL';
  const score = (value: number | null) => {
    if (!started) return null;
    if (value === null || Number.isNaN(value)) parseFailed(`event ${event.id} has no valid score`);
    return value;
  };
  return {
    externalId: event.id,
    season: event.season,
    startsAt,
    gameDate: toEasternDate(startsAt),
    homeTeamCode: standardTeamCode(home.team.abbreviation),
    awayTeamCode: standardTeamCode(away.team.abbreviation),
    status: statusValue,
    homeScore: score(home.score),
    awayScore: score(away.score),
  };
}

const scheduleSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      season: z.object({ year: z.number().int() }),
      seasonType: z.object({ type: z.number().int() }),
      competitions: z.array(competitionSchema).min(1),
    })
  ),
});

export function parseSchedule(response: unknown): NbaProviderGame[] {
  return validate(scheduleSchema, response, 'team schedule')
    .events.filter(
      (event) =>
        event.seasonType.type === REGULAR_SEASON &&
        event.competitions[0].type.abbreviation === STANDARD_COMPETITION
    )
    .map((event) => {
      const competition = event.competitions[0];
      return toGame(
        { id: event.id, date: event.date, season: event.season.year },
        competition.status,
        competition.competitors
      );
    });
}

const scoreboardSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      season: z.object({ year: z.number().int(), type: z.number().int() }),
      competitions: z.array(competitionSchema).min(1),
    })
  ),
});

export function parseScoreboard(response: unknown): NbaProviderGame[] {
  return validate(scoreboardSchema, response, 'scoreboard')
    .events.filter(
      (event) =>
        event.season.type === REGULAR_SEASON &&
        event.competitions[0].type.abbreviation === STANDARD_COMPETITION
    )
    .map((event) => {
      const competition = event.competitions[0];
      return toGame(
        { id: event.id, date: event.date, season: event.season.year },
        competition.status,
        competition.competitors
      );
    });
}

// ---- Box score (summary) ----------------------------------------------------------------------

const COACH = /COACH/i;
const REST = /\bREST\b/i;
const SUSPENDED = /SUSP/i;
const PERSONAL = /PERSONAL/i;
const INJURY =
  /INJUR|ILLNESS|SICK|SURGERY|SPRAIN|STRAIN|SORE|CONTUSION|FRACTURE|TEAR|TORN|CONCUSSION|TENDIN|BRUISE|INFLAMMATION|DISLOCAT|ANKLE|KNEE|FOOT|TOE|HAMSTRING|CALF|GROIN|HIP|BACK|SHOULDER|WRIST|HAND|FINGER|THUMB|ELBOW|NECK|ACHILLES|QUAD|ADDUCTOR|ABDOM|OBLIQUE|RIB|HEEL|SHIN|LEG|ARM|EYE|NOSE|FACE|JAW|PLANTAR|PROTOCOL|REHAB/i;

/** ESPN's free-text did-not-play reason, classified as the REC Bible sheet's `llDnp_` did. */
export function classifyDnpReason(reason: string): NbaDnpReason {
  if (COACH.test(reason)) return 'COACH_DECISION';
  if (REST.test(reason)) return 'REST';
  if (SUSPENDED.test(reason)) return 'SUSPENDED';
  if (PERSONAL.test(reason)) return 'PERSONAL';
  if (INJURY.test(reason)) return 'INJURY';
  return 'OTHER';
}

const athleteLineSchema = z.object({
  // ESPN lists some unsigned two-way players with no athlete record (no id, no name).
  athlete: z.object({
    id: z.string().optional(),
    displayName: z.string().min(1).optional(),
    position: z.object({ abbreviation: z.string() }).nullish(),
  }),
  starter: z.boolean(),
  didNotPlay: z.boolean(),
  reason: z.string().nullish(),
  stats: z.array(z.string()),
});

const summarySchema = z.object({
  header: z.object({
    id: z.string(),
    season: z.object({ year: z.number().int(), type: z.number().int() }),
    competitions: z
      .array(
        z.object({
          date: z.string(),
          status: statusSchema,
          competitors: z.array(competitorSchema).length(2),
        })
      )
      .min(1),
  }),
  boxscore: z.object({
    players: z.array(
      z.object({
        team: z.object({ abbreviation: z.string() }),
        statistics: z
          .array(z.object({ keys: z.array(z.string()), athletes: z.array(athleteLineSchema) }))
          .min(1),
      })
    ),
  }),
});

const COUNT = /^[+-]?\d+$/;
const MADE_ATTEMPTED = /^(\d+)-(\d+)$/;

function count(value: string | undefined, what: string): number {
  if (value === undefined || !COUNT.test(value))
    parseFailed(`${what} "${value}" is not a whole number`);
  return Number.parseInt(value, 10);
}

// ESPN shows "--" minutes and plus-minus for a player who checked in with no recorded time.
function countOrDash(value: string | undefined, what: string): number {
  return value === '--' ? 0 : count(value, what);
}

function madeAttempted(value: string | undefined, what: string): [number, number] {
  const match = value === undefined ? null : MADE_ATTEMPTED.exec(value);
  if (!match) parseFailed(`${what} "${value}" is not a made-attempted pair`);
  return [Number(match[1]), Number(match[2])];
}

type StatValues = Omit<
  NbaProviderPlayerLine,
  'player' | 'teamCode' | 'starter' | 'played' | 'dnpReason'
>;

const ZERO_STATS: StatValues = {
  secondsPlayed: 0,
  points: 0,
  rebounds: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  threePointersAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  personalFouls: 0,
  plusMinus: 0,
};

function statValues(keys: string[], stats: string[], who: string): StatValues {
  const read = (key: string) => {
    const index = keys.indexOf(key);
    if (index < 0) parseFailed(`box score has no "${key}" column`);
    return stats[index];
  };
  const [fieldGoalsMade, fieldGoalsAttempted] = madeAttempted(
    read('fieldGoalsMade-fieldGoalsAttempted'),
    `${who} FG`
  );
  const [threePointersMade, threePointersAttempted] = madeAttempted(
    read('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
    `${who} 3PT`
  );
  const [freeThrowsMade, freeThrowsAttempted] = madeAttempted(
    read('freeThrowsMade-freeThrowsAttempted'),
    `${who} FT`
  );
  return {
    // ESPN reports whole minutes only.
    secondsPlayed: countOrDash(read('minutes'), `${who} MIN`) * 60,
    points: count(read('points'), `${who} PTS`),
    rebounds: count(read('rebounds'), `${who} REB`),
    offensiveRebounds: count(read('offensiveRebounds'), `${who} OREB`),
    defensiveRebounds: count(read('defensiveRebounds'), `${who} DREB`),
    assists: count(read('assists'), `${who} AST`),
    steals: count(read('steals'), `${who} STL`),
    blocks: count(read('blocks'), `${who} BLK`),
    turnovers: count(read('turnovers'), `${who} TO`),
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    personalFouls: count(read('fouls'), `${who} PF`),
    plusMinus: countOrDash(read('plusMinus'), `${who} +/-`),
  };
}

/**
 * A summary's header has no competition type, so this parser cannot tell an NBA Cup final from a
 * standard game. The regular-season invariant holds only because box-score candidates come from
 * the filtered schedule and scoreboard (`parseSchedule`, `parseScoreboard`). Do not add a path that
 * fetches box scores by event id from anywhere else.
 */
export function parseBoxScore(response: unknown): NbaProviderBoxScore {
  const data = validate(summarySchema, response, 'summary');
  const header = data.header;
  const competition = header.competitions[0];
  const game = toGame(
    { id: header.id, date: competition.date, season: header.season.year },
    competition.status,
    competition.competitors
  );

  if (header.season.type !== REGULAR_SEASON) {
    parseFailed(
      `game ${header.id} is not a regular-season game (season type ${header.season.type})`
    );
  }

  let unidentifiedEmptyRows = 0;
  const lines = data.boxscore.players.flatMap((team) => {
    const teamCode = standardTeamCode(team.team.abbreviation);
    const { keys, athletes } = team.statistics[0];
    return athletes.flatMap((line): NbaProviderPlayerLine[] => {
      const { id, displayName } = line.athlete;
      const who = `game ${header.id} athlete ${id}`;
      if (!id || !displayName) {
        // No identity to link, and never a name match. ESPN lists some unsigned two-way players
        // this way. A row that records nothing (no stats, or all zeros) is dropped and counted;
        // one with real numbers would lose them, so the game fails.
        const values = line.stats.length > 0 ? statValues(keys, line.stats, who) : ZERO_STATS;
        if (Object.values(values).some((value) => value !== 0)) {
          parseFailed(`${who} has stats but no athlete id or name`);
        }
        unidentifiedEmptyRows += 1;
        return [];
      }
      // Rows with no stats (did not play) carry zeros. ESPN fills `reason` for players who played
      // too, so it is read only for a did-not-play row.
      const played = !line.didNotPlay && line.stats.length > 0;
      return [
        {
          player: {
            externalId: id,
            fullName: displayName,
            positions: splitPositions(line.athlete.position?.abbreviation),
          },
          teamCode,
          starter: line.starter,
          played,
          dnpReason: line.didNotPlay ? classifyDnpReason(line.reason ?? '') : null,
          ...(line.stats.length > 0 ? statValues(keys, line.stats, who) : ZERO_STATS),
        },
      ];
    });
  });

  return { game, lines, unidentifiedEmptyRows };
}

// ---- Injuries ---------------------------------------------------------------------------------

const INJURY_STATUSES = { Out: 'OUT', 'Day-To-Day': 'DAY_TO_DAY' } as const;
const ATHLETE_ID_IN_LINK = /\/id\/(\d+)(?:\/|$)/;
// ESPN's fantasy status codes seen in the feed: OUT, GTD and OFS ("out for season"). An OFS row
// carries a placeholder return date months after the season ends.
const OUT_FOR_SEASON = 'OFS';
// The one-line note says the player is out for the rest of this season: "season-ending" (but not
// "from/after/following a season-ending ...", which looks back at an earlier injury), or "miss / out
// for / sidelined for / sit out the [rest of the | remainder of the | entire | whole] [2026-27]
// [regular] season|campaign" (but not "the season opener", "the season's ..."). "The start of the
// season" and "most, if not all, of the season" do not match.
const SEASON_ENDING_NOTE = new RegExp(
  [
    String.raw`(?<!\b(?:from|after|following)\s+(?:a|an|his|the)\s+)\bseason[- ]ending\b`,
    String.raw`\b(?:miss|out for|sidelined for|sit out)\s+the\s+(?:(?:rest|remainder)\s+of\s+the\s+|entire\s+|whole\s+)?(?:\d{4}-\d{2}\s+)?(?:regular\s+)?(?:season|campaign)\b(?![\s-]+(?:opener|debut|finale)|['’]s)`,
  ].join('|'),
  'i'
);

const injuriesSchema = z.object({
  injuries: z.array(
    z.object({
      injuries: z.array(
        z.object({
          status: z.enum(['Out', 'Day-To-Day']),
          date: z.string().nullish(),
          shortComment: z.string().nullish(),
          athlete: z.object({ links: z.array(z.object({ href: z.string() })) }),
          details: z
            .object({
              type: z.string().nullish(),
              side: z.string().nullish(),
              returnDate: z.string().nullish(),
              fantasyStatus: z.object({ abbreviation: z.string().nullish() }).nullish(),
            })
            .nullish(),
        })
      ),
    })
  ),
});

export function parseInjuries(response: unknown): NbaProviderInjury[] {
  const data = validate(injuriesSchema, response, 'injuries');
  return data.injuries.flatMap((team) =>
    team.injuries.map((entry) => {
      const athleteId = entry.athlete.links
        .map((link) => ATHLETE_ID_IN_LINK.exec(link.href)?.[1])
        .find(Boolean);
      if (!athleteId) parseFailed('injury entry has no athlete id in its links');
      const side = entry.details?.side;
      const detail = [side && side !== 'Not Specified' ? side : null, entry.details?.type]
        .filter(Boolean)
        .join(' ');
      const comment = entry.shortComment?.trim() || null;
      const fantasyStatus = entry.details?.fantasyStatus?.abbreviation?.trim() || null;
      return {
        athleteExternalId: athleteId,
        status: INJURY_STATUSES[entry.status],
        detail: detail || null,
        expectedReturnOn: datePart(entry.details?.returnDate),
        reportedAt: entry.date ? instant(entry.date, 'injury date') : null,
        comment,
        fantasyStatus,
        // Only the one-line note is read: the long note often names teammates who are out.
        seasonEnding:
          fantasyStatus === OUT_FOR_SEASON ||
          (entry.status === 'Out' && SEASON_ENDING_NOTE.test(comment ?? '')),
      };
    })
  );
}

// ---- Season totals (byathlete) ------------------------------------------------------------------

const seasonTotalsSchema = z.object({
  categories: z.array(z.object({ name: z.string(), names: z.array(z.string()) })),
  athletes: z.array(
    z.object({
      athlete: z.object({ id: z.string(), displayName: z.string() }),
      categories: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
    })
  ),
});

export function parseSeasonTotals(response: unknown): NbaProviderSeasonTotal[] {
  const data = validate(seasonTotalsSchema, response, 'season totals');
  const columns = new Map(data.categories.map((category) => [category.name, category.names]));
  return data.athletes.map(({ athlete, categories }) => {
    const value = (category: string, name: string) => {
      const index = columns.get(category)?.indexOf(name) ?? -1;
      const found = categories.find((entry) => entry.name === category)?.values[index];
      if (index < 0 || found === undefined)
        parseFailed(`season totals have no ${category}.${name}`);
      return found;
    };
    return {
      athleteExternalId: athlete.id,
      fullName: athlete.displayName,
      gamesPlayed: value('general', 'gamesPlayed'),
      minutes: value('general', 'minutes'),
      points: value('offensive', 'points'),
      rebounds: value('general', 'rebounds'),
      assists: value('offensive', 'assists'),
    };
  });
}
