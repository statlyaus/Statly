/**
 * Synthetic ESPN site-API responses in the real raw shapes (checked against live responses on
 * 2026-11-08), trimmed to the fields the adapter reads plus a few it ignores. Names and numbers are
 * made up; no ESPN response is committed.
 */

export const ESPN_TEAMS: ReadonlyArray<[id: string, abbreviation: string, displayName: string]> = [
  ['1', 'ATL', 'Atlanta Hawks'],
  ['2', 'BOS', 'Boston Celtics'],
  ['17', 'BKN', 'Brooklyn Nets'],
  ['30', 'CHA', 'Charlotte Hornets'],
  ['4', 'CHI', 'Chicago Bulls'],
  ['5', 'CLE', 'Cleveland Cavaliers'],
  ['6', 'DAL', 'Dallas Mavericks'],
  ['7', 'DEN', 'Denver Nuggets'],
  ['8', 'DET', 'Detroit Pistons'],
  ['9', 'GS', 'Golden State Warriors'],
  ['10', 'HOU', 'Houston Rockets'],
  ['11', 'IND', 'Indiana Pacers'],
  ['12', 'LAC', 'LA Clippers'],
  ['13', 'LAL', 'Los Angeles Lakers'],
  ['29', 'MEM', 'Memphis Grizzlies'],
  ['14', 'MIA', 'Miami Heat'],
  ['15', 'MIL', 'Milwaukee Bucks'],
  ['16', 'MIN', 'Minnesota Timberwolves'],
  ['3', 'NO', 'New Orleans Pelicans'],
  ['18', 'NY', 'New York Knicks'],
  ['25', 'OKC', 'Oklahoma City Thunder'],
  ['19', 'ORL', 'Orlando Magic'],
  ['20', 'PHI', 'Philadelphia 76ers'],
  ['21', 'PHX', 'Phoenix Suns'],
  ['22', 'POR', 'Portland Trail Blazers'],
  ['23', 'SAC', 'Sacramento Kings'],
  ['24', 'SA', 'San Antonio Spurs'],
  ['28', 'TOR', 'Toronto Raptors'],
  ['26', 'UTAH', 'Utah Jazz'],
  ['27', 'WSH', 'Washington Wizards'],
];

export function teamsResponse(teams = ESPN_TEAMS) {
  return {
    sports: [
      {
        leagues: [
          {
            teams: teams.map(([id, abbreviation, displayName]) => ({
              team: { id, abbreviation, displayName, location: 'Somewhere', isActive: true },
            })),
          },
        ],
      },
    ],
  };
}

export function rosterAthlete(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    firstName: 'Test',
    lastName: `Player${id}`,
    fullName: `Test Player${id}`,
    displayName: `Test Player${id}`,
    position: { name: 'Guard', displayName: 'Guard', abbreviation: 'G', leaf: false },
    dateOfBirth: '1996-10-30T08:00Z',
    status: { id: '1', name: 'Active', type: 'active', abbreviation: 'Active' },
    injuries: [],
    ...overrides,
  };
}

export function rosterResponse(teamId: string, athletes: unknown[]) {
  return {
    team: { id: teamId, abbreviation: 'PHX', displayName: 'Phoenix Suns' },
    season: { year: 2027, displayName: '2026-27', type: 2, name: 'Regular Season' },
    athletes,
  };
}

export interface EventSpec {
  id: string;
  date?: string;
  home: [id: string, abbreviation: string];
  away: [id: string, abbreviation: string];
  state?: 'pre' | 'in' | 'post';
  statusName?: string;
  homeScore?: number;
  awayScore?: number;
  seasonType?: number;
  competitionType?: string;
  season?: number;
}

function statusOf(spec: EventSpec) {
  const state = spec.state ?? 'post';
  const name =
    spec.statusName ??
    (state === 'post'
      ? 'STATUS_FINAL'
      : state === 'in'
        ? 'STATUS_IN_PROGRESS'
        : 'STATUS_SCHEDULED');
  return { type: { name, state, completed: state === 'post' && name === 'STATUS_FINAL' } };
}

function competitionTypeOf(spec: EventSpec) {
  const abbreviation = spec.competitionType ?? 'STD';
  return { id: abbreviation === 'STD' ? '1' : '39', abbreviation };
}

/** One event as `teams/{id}/schedule` lists it: scores are `{ value, displayValue }` or null. */
export function scheduleEvent(spec: EventSpec) {
  const started = (spec.state ?? 'post') !== 'pre';
  const score = (value: number) => (started ? { value, displayValue: String(value) } : null);
  return {
    id: spec.id,
    date: spec.date ?? '2026-11-06T02:00Z',
    season: { year: spec.season ?? 2027, displayName: '2026-27' },
    seasonType: { id: String(spec.seasonType ?? 2), type: spec.seasonType ?? 2 },
    competitions: [
      {
        id: spec.id,
        type: competitionTypeOf(spec),
        status: statusOf(spec),
        competitors: [
          {
            id: spec.home[0],
            homeAway: 'home',
            team: { id: spec.home[0], abbreviation: spec.home[1] },
            score: score(spec.homeScore ?? 110),
          },
          {
            id: spec.away[0],
            homeAway: 'away',
            team: { id: spec.away[0], abbreviation: spec.away[1] },
            score: score(spec.awayScore ?? 100),
          },
        ],
      },
    ],
  };
}

export function scheduleResponse(events: unknown[]) {
  return {
    team: { id: '21', abbreviation: 'PHX' },
    season: { year: 2027, type: 2 },
    requestedSeason: { year: 2027, type: 2 },
    events,
  };
}

/** One event as `scoreboard` lists it: season type sits on `season`, scores are strings. */
export function scoreboardEvent(spec: EventSpec) {
  return {
    id: spec.id,
    date: spec.date ?? '2026-11-06T02:00Z',
    season: { year: spec.season ?? 2027, type: spec.seasonType ?? 2, slug: 'regular-season' },
    status: statusOf(spec),
    competitions: [
      {
        id: spec.id,
        type: competitionTypeOf(spec),
        status: statusOf(spec),
        competitors: [
          {
            id: spec.home[0],
            homeAway: 'home',
            team: { id: spec.home[0], abbreviation: spec.home[1] },
            score: String(spec.homeScore ?? 0),
          },
          {
            id: spec.away[0],
            homeAway: 'away',
            team: { id: spec.away[0], abbreviation: spec.away[1] },
            score: String(spec.awayScore ?? 0),
          },
        ],
      },
    ],
  };
}

export function scoreboardResponse(events: unknown[]) {
  return { leagues: [], events };
}

export const BOX_SCORE_KEYS = [
  'minutes',
  'points',
  'fieldGoalsMade-fieldGoalsAttempted',
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'freeThrowsMade-freeThrowsAttempted',
  'rebounds',
  'assists',
  'turnovers',
  'steals',
  'blocks',
  'offensiveRebounds',
  'defensiveRebounds',
  'fouls',
  'plusMinus',
];

export interface BoxAthleteSpec {
  id: string;
  name?: string;
  position?: string;
  starter?: boolean;
  didNotPlay?: boolean;
  reason?: string;
  /** In BOX_SCORE_KEYS order. Omitted for a did-not-play row. */
  stats?: string[];
}

/** Ten minutes, 7 points on 3-5 FG, 1-2 3PT, 0-0 FT, 4 reb, 2 ast, 1 to, 1 stl, 0 blk. */
export const TYPICAL_STATS = [
  '10',
  '7',
  '3-5',
  '1-2',
  '0-0',
  '4',
  '2',
  '1',
  '1',
  '0',
  '1',
  '3',
  '2',
  '+3',
];

export function boxAthlete(spec: BoxAthleteSpec) {
  const didNotPlay = spec.didNotPlay ?? false;
  return {
    active: false,
    athlete: {
      id: spec.id,
      displayName: spec.name ?? `Box Player${spec.id}`,
      shortName: 'B. Player',
      position: { name: 'Guard', displayName: 'Guard', abbreviation: spec.position ?? 'G' },
    },
    starter: spec.starter ?? false,
    didNotPlay,
    // ESPN fills `reason` with "COACH'S DECISION" even for players who played.
    reason: spec.reason ?? "COACH'S DECISION",
    ejected: false,
    stats: didNotPlay ? [] : (spec.stats ?? TYPICAL_STATS),
  };
}

export function teamAthletes(prefix: string, count: number): BoxAthleteSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    starter: index < 5,
  }));
}

export interface SummarySpec extends EventSpec {
  homeAthletes: BoxAthleteSpec[];
  awayAthletes: BoxAthleteSpec[];
}

/** `summary?event=`: header, plus the box score's two player lists (away first, as ESPN lists). */
export function summaryResponse(spec: SummarySpec) {
  const players = (team: [string, string], athletes: BoxAthleteSpec[]) => ({
    team: { id: team[0], abbreviation: team[1] },
    statistics: [
      {
        names: [],
        keys: BOX_SCORE_KEYS,
        labels: [],
        athletes: athletes.map(boxAthlete),
        totals: [],
      },
    ],
  });
  return {
    header: {
      id: spec.id,
      season: { year: spec.season ?? 2027, current: true, type: spec.seasonType ?? 2 },
      competitions: [
        {
          id: spec.id,
          date: spec.date ?? '2026-11-06T02:00Z',
          status: statusOf(spec),
          competitors: [
            {
              id: spec.home[0],
              homeAway: 'home',
              score: String(spec.homeScore ?? 110),
              team: { id: spec.home[0], abbreviation: spec.home[1] },
            },
            {
              id: spec.away[0],
              homeAway: 'away',
              score: String(spec.awayScore ?? 100),
              team: { id: spec.away[0], abbreviation: spec.away[1] },
            },
          ],
        },
      ],
    },
    boxscore: {
      teams: [],
      players: [players(spec.away, spec.awayAthletes), players(spec.home, spec.homeAthletes)],
    },
    injuries: [],
  };
}

export interface InjurySpec {
  athleteId: string;
  status?: string;
  type?: string;
  side?: string;
  returnDate?: string;
  date?: string;
  href?: string;
  /** ESPN's one-line note (`shortComment`); null leaves it out. */
  comment?: string | null;
  /** ESPN's longer note, which can discuss teammates. */
  longComment?: string;
  /** ESPN's fantasy status code (OUT, OFS, GTD); null leaves it out. */
  fantasyStatus?: string | null;
}

export function injuryEntry(spec: InjurySpec) {
  const fantasyStatus = spec.fantasyStatus === undefined ? 'OUT' : spec.fantasyStatus;
  return {
    id: `9${spec.athleteId}`,
    shortComment: spec.comment === undefined ? 'Player (ankle) is out.' : spec.comment,
    longComment: spec.longComment,
    status: spec.status ?? 'Out',
    date: spec.date ?? '2026-11-06T22:06Z',
    athlete: {
      displayName: `Injured Player${spec.athleteId}`,
      links: [
        {
          rel: ['playercard', 'desktop', 'athlete'],
          href:
            spec.href ??
            `https://www.espn.com/nba/player/_/id/${spec.athleteId}/injured-player${spec.athleteId}`,
        },
      ],
    },
    type: { id: '4', name: 'INJURY_STATUS_OUT', abbreviation: 'O' },
    details: {
      fantasyStatus: fantasyStatus && { description: fantasyStatus, abbreviation: fantasyStatus },
      type: spec.type ?? 'Ankle',
      location: 'Leg',
      side: spec.side ?? 'Left',
      returnDate: spec.returnDate,
    },
  };
}

export function injuriesResponse(teams: Array<{ id: string; entries: InjurySpec[] }>) {
  return {
    timestamp: '2026-11-07T00:00:00Z',
    status: 'success',
    season: { year: 2027, type: 2 },
    injuries: teams.map((team) => ({
      id: team.id,
      displayName: `Team ${team.id}`,
      injuries: team.entries.map(injuryEntry),
    })),
  };
}

export function seasonTotalsResponse(
  athletes: Array<{
    id: string;
    name: string;
    gamesPlayed: number;
    minutes: number;
    points: number;
    rebounds: number;
    assists: number;
  }>
) {
  return {
    pagination: { count: athletes.length, limit: 50, page: 1, pages: 1 },
    categories: [
      { name: 'general', names: ['gamesPlayed', 'avgMinutes', 'minutes', 'rebounds'] },
      { name: 'offensive', names: ['avgPoints', 'points', 'assists'] },
    ],
    athletes: athletes.map((athlete) => ({
      athlete: { id: athlete.id, displayName: athlete.name },
      categories: [
        {
          name: 'general',
          values: [
            athlete.gamesPlayed,
            athlete.minutes / athlete.gamesPlayed,
            athlete.minutes,
            athlete.rebounds,
          ],
        },
        {
          name: 'offensive',
          values: [athlete.points / athlete.gamesPlayed, athlete.points, athlete.assists],
        },
      ],
    })),
  };
}
