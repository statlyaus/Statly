// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  boxAthlete,
  ESPN_TEAMS,
  injuriesResponse,
  rosterAthlete,
  rosterResponse,
  scheduleEvent,
  scheduleResponse,
  scoreboardEvent,
  scoreboardResponse,
  seasonTotalsResponse,
  summaryResponse,
  teamAthletes,
  teamsResponse,
} from '../__fixtures__/espnFixtures';
import { NbaIngestRejected } from '../nbaStatsProvider';
import {
  classifyDnpReason,
  parseBoxScore,
  parseInjuries,
  parseRoster,
  parseSchedule,
  parseScoreboard,
  parseSeasonTotals,
  parseTeams,
  standardTeamCode,
} from './espnParsers';

function rejection(run: () => unknown): NbaIngestRejected {
  try {
    run();
  } catch (error) {
    if (error instanceof NbaIngestRejected) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

const PHX: [string, string] = ['21', 'PHX'];
const GS: [string, string] = ['9', 'GS'];

describe('standardTeamCode', () => {
  it.each([
    ['GS', 'GSW'],
    ['NY', 'NYK'],
    ['SA', 'SAS'],
    ['NO', 'NOP'],
    ['UTAH', 'UTA'],
    ['WSH', 'WAS'],
    ['PHX', 'PHX'],
    ['BKN', 'BKN'],
  ])('maps ESPN %s to %s', (espn, standard) => {
    expect(standardTeamCode(espn)).toBe(standard);
  });

  it('rejects an unknown code as parse_failed', () => {
    expect(rejection(() => standardTeamCode('USA')).reason).toBe('parse_failed');
  });
});

describe('parseTeams', () => {
  it('returns all thirty teams with standard codes', () => {
    const teams = parseTeams(teamsResponse());

    expect(teams).toHaveLength(30);
    expect(new Set(teams.map((team) => team.code)).size).toBe(30);
    expect(teams).toContainEqual({ externalId: '9', code: 'GSW', name: 'Golden State Warriors' });
  });

  it('rejects a response without the sports/leagues/teams nesting', () => {
    expect(rejection(() => parseTeams({ teams: [] })).reason).toBe('parse_failed');
  });

  it('rejects an unknown team abbreviation', () => {
    const response = teamsResponse([...ESPN_TEAMS.slice(1), ['99', 'XYZ', 'Nobody']]);
    expect(rejection(() => parseTeams(response)).reason).toBe('parse_failed');
  });
});

describe('parseRoster', () => {
  it('reads identity, names, positions and the birth date', () => {
    const players = parseRoster(
      rosterResponse('21', [
        rosterAthlete('3136193', {
          firstName: 'Devin',
          lastName: 'Booker',
          fullName: 'Devin Booker',
          dateOfBirth: '1996-10-30T08:00Z',
        }),
        rosterAthlete('2', {
          position: { abbreviation: 'G-F' },
          dateOfBirth: undefined,
        }),
      ])
    );

    expect(players).toEqual([
      {
        externalId: '3136193',
        fullName: 'Devin Booker',
        firstName: 'Devin',
        lastName: 'Booker',
        positions: ['G'],
        birthDate: '1996-10-30',
      },
      {
        externalId: '2',
        fullName: 'Test Player2',
        firstName: 'Test',
        lastName: 'Player2',
        positions: ['G', 'F'],
        birthDate: null,
      },
    ]);
  });

  it('rejects an athlete without an id', () => {
    const response = rosterResponse('21', [{ fullName: 'No Id' }]);
    expect(rejection(() => parseRoster(response)).reason).toBe('parse_failed');
  });
});

describe('parseSchedule', () => {
  it('keeps regular-season standard games with standard codes, ET date and scores', () => {
    const games = parseSchedule(
      scheduleResponse([
        scheduleEvent({
          id: '401909841',
          date: '2026-10-22T02:00Z',
          home: ['22', 'POR'],
          away: PHX,
          homeScore: 124,
          awayScore: 83,
        }),
        scheduleEvent({
          id: '401909958',
          date: '2026-11-10T02:00Z',
          home: PHX,
          away: GS,
          state: 'pre',
        }),
      ])
    );

    expect(games).toEqual([
      {
        externalId: '401909841',
        season: 2027,
        startsAt: new Date('2026-10-22T02:00:00Z'),
        // 10 pm Eastern on 21 October.
        gameDate: '2026-10-21',
        homeTeamCode: 'POR',
        awayTeamCode: 'PHX',
        status: 'FINAL',
        homeScore: 124,
        awayScore: 83,
      },
      {
        externalId: '401909958',
        season: 2027,
        startsAt: new Date('2026-11-10T02:00:00Z'),
        gameDate: '2026-11-09',
        homeTeamCode: 'PHX',
        awayTeamCode: 'GSW',
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
      },
    ]);
  });

  it('drops the NBA Cup final, preseason and playoff games', () => {
    const games = parseSchedule(
      scheduleResponse([
        scheduleEvent({
          id: 'cup-final',
          home: ['24', 'SA'],
          away: ['18', 'NY'],
          competitionType: 'CC',
        }),
        scheduleEvent({ id: 'preseason', home: PHX, away: GS, seasonType: 1 }),
        scheduleEvent({ id: 'playoff', home: PHX, away: GS, seasonType: 3 }),
        scheduleEvent({ id: 'regular', home: PHX, away: GS }),
      ])
    );

    expect(games.map((game) => game.externalId)).toEqual(['regular']);
  });

  it.each([
    ['STATUS_POSTPONED', 'pre', 'POSTPONED'],
    ['STATUS_CANCELED', 'post', 'CANCELLED'],
    ['STATUS_HALFTIME', 'in', 'IN_PROGRESS'],
  ] as const)('maps %s (state %s) to %s', (statusName, state, expected) => {
    const [game] = parseSchedule(
      scheduleResponse([scheduleEvent({ id: '1', home: PHX, away: GS, statusName, state })])
    );
    expect(game.status).toBe(expected);
  });

  it('rejects an unknown team in a regular-season game', () => {
    const response = scheduleResponse([scheduleEvent({ id: '1', home: PHX, away: ['0', 'TBD'] })]);
    expect(rejection(() => parseSchedule(response)).reason).toBe('parse_failed');
  });
});

describe('parseScoreboard', () => {
  it('reads string scores and filters on the event season type', () => {
    const games = parseScoreboard(
      scoreboardResponse([
        scoreboardEvent({
          id: 'live',
          home: GS,
          away: ['14', 'MIA'],
          state: 'in',
          homeScore: 50,
          awayScore: 48,
        }),
        scoreboardEvent({
          id: 'all-star',
          home: ['90', 'USA'],
          away: ['91', 'WLD'],
          seasonType: 4,
        }),
        scoreboardEvent({ id: 'later', home: GS, away: ['14', 'MIA'], state: 'pre' }),
      ])
    );

    expect(
      games.map((game) => [game.externalId, game.status, game.homeScore, game.awayScore])
    ).toEqual([
      ['live', 'IN_PROGRESS', 50, 48],
      ['later', 'SCHEDULED', null, null],
    ]);
  });
});

describe('classifyDnpReason', () => {
  it.each([
    ["COACH'S DECISION", 'COACH_DECISION'],
    ['REST', 'REST'],
    ['SUSPENDED', 'SUSPENDED'],
    ['SUSPENSION - LEAGUE', 'SUSPENDED'],
    ['PERSONAL REASONS', 'PERSONAL'],
    ['LEFT ANKLE SURGERY', 'INJURY'],
    ['ILLNESS', 'INJURY'],
    ['RIGHT HAMSTRING STRAIN', 'INJURY'],
    ['G LEAGUE - TWO-WAY', 'OTHER'],
    ['NOT WITH TEAM', 'OTHER'],
    ['', 'OTHER'],
  ] as const)('classifies "%s" as %s', (reason, expected) => {
    expect(classifyDnpReason(reason)).toBe(expected);
  });
});

describe('parseBoxScore', () => {
  const base = {
    id: '401909937',
    date: '2026-11-06T03:00Z',
    home: GS,
    away: ['14', 'MIA'] as [string, string],
    homeScore: 120,
    awayScore: 100,
  };

  it('reads the game and every listed player line', () => {
    const box = parseBoxScore(
      summaryResponse({
        ...base,
        homeAthletes: [
          {
            id: '3975',
            name: 'Stephen Curry',
            position: 'G',
            starter: true,
            stats: [
              '34',
              '31',
              '11-21',
              '6-12',
              '3-3',
              '5',
              '7',
              '2',
              '1',
              '0',
              '1',
              '4',
              '2',
              '+18',
            ],
          },
        ],
        awayAthletes: [
          { id: '3899664', name: 'Simone Fontecchio', position: 'F', didNotPlay: true },
          { id: '4', didNotPlay: true, reason: 'LEFT ANKLE SPRAIN' },
        ],
      })
    );

    expect(box.game).toMatchObject({
      externalId: '401909937',
      season: 2027,
      gameDate: '2026-11-05',
      homeTeamCode: 'GSW',
      awayTeamCode: 'MIA',
      status: 'FINAL',
      homeScore: 120,
      awayScore: 100,
    });
    expect(box.lines).toContainEqual({
      player: { externalId: '3975', fullName: 'Stephen Curry', positions: ['G'] },
      teamCode: 'GSW',
      starter: true,
      played: true,
      dnpReason: null,
      secondsPlayed: 34 * 60,
      points: 31,
      rebounds: 5,
      offensiveRebounds: 1,
      defensiveRebounds: 4,
      assists: 7,
      steals: 1,
      blocks: 0,
      turnovers: 2,
      fieldGoalsMade: 11,
      fieldGoalsAttempted: 21,
      threePointersMade: 6,
      threePointersAttempted: 12,
      freeThrowsMade: 3,
      freeThrowsAttempted: 3,
      personalFouls: 2,
      plusMinus: 18,
    });
    const dnp = box.lines.filter((line) => !line.played);
    expect(dnp.map((line) => [line.player.externalId, line.teamCode, line.dnpReason])).toEqual([
      ['3899664', 'MIA', 'COACH_DECISION'],
      ['4', 'MIA', 'INJURY'],
    ]);
    expect(dnp.every((line) => line.points === 0 && line.secondsPlayed === 0)).toBe(true);
  });

  it('ignores the reason of a player who played', () => {
    const box = parseBoxScore(
      summaryResponse({ ...base, homeAthletes: [{ id: '1' }], awayAthletes: teamAthletes('m', 1) })
    );
    expect(box.lines[1].dnpReason).toBeNull();
  });

  it('drops and counts a did-not-play row with no athlete record', () => {
    const response = summaryResponse({
      ...base,
      homeAthletes: [{ id: '1' }, { id: 'x', didNotPlay: true }],
      awayAthletes: [],
    });
    // As ESPN lists an unsigned two-way player: no id, no name, no stats.
    response.boxscore.players[1].statistics[0].athletes[1].athlete = {
      links: [],
      shortName: 'Olbrich',
    } as never;

    const box = parseBoxScore(response);

    expect(box.lines.map((entry) => entry.player.externalId)).toEqual(['1']);
    expect(box.unidentifiedEmptyRows).toBe(1);
  });

  it('drops and counts an unidentified row whose stats are all zero', () => {
    const zeros = ['--', '0', '0-0', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '0'];
    const response = summaryResponse({
      ...base,
      homeAthletes: [{ id: '1' }, { id: 'x', stats: zeros }],
      awayAthletes: [],
    });
    response.boxscore.players[1].statistics[0].athletes[1].athlete = {
      links: [],
      shortName: 'Olbrich',
    } as never;

    const box = parseBoxScore(response);

    expect(box.lines).toHaveLength(1);
    expect(box.unidentifiedEmptyRows).toBe(1);
  });

  it('rejects a row with stats but no athlete record', () => {
    const response = summaryResponse({ ...base, homeAthletes: [{ id: '1' }], awayAthletes: [] });
    response.boxscore.players[1].statistics[0].athletes[0].athlete = { links: [] } as never;
    expect(rejection(() => parseBoxScore(response)).reason).toBe('parse_failed');
  });

  it('reads the stats by key, not by position', () => {
    const response = summaryResponse({ ...base, homeAthletes: [{ id: '1' }], awayAthletes: [] });
    const homePlayers = response.boxscore.players[1].statistics[0];
    homePlayers.keys = [...homePlayers.keys].reverse();
    homePlayers.athletes[0].stats = [...homePlayers.athletes[0].stats].reverse();

    const [line] = parseBoxScore(response).lines;
    expect(line).toMatchObject({ secondsPlayed: 600, points: 7, plusMinus: 3, fieldGoalsMade: 3 });
  });

  it('reads "--" minutes and plus-minus as zero for a player who checked in without time', () => {
    const stats = ['--', '0', '0-0', '0-0', '0-0', '0', '0', '0', '0', '0', '0', '0', '0', '--'];
    const response = summaryResponse({
      ...base,
      homeAthletes: [{ id: '1', stats }],
      awayAthletes: [],
    });

    const [line] = parseBoxScore(response).lines;

    expect(line).toMatchObject({ played: true, secondsPlayed: 0, points: 0, plusMinus: 0 });
  });

  it.each([
    ['a made-attempted pair without a dash', 2, '7/13'],
    ['a dash pair where a made-attempted pair belongs', 2, '--'],
    ['a non-numeric count', 1, '--'],
  ])('rejects %s', (_label, index, value) => {
    const stats = [...boxAthlete({ id: '1' }).stats];
    stats[index] = value;
    const response = summaryResponse({
      ...base,
      homeAthletes: [{ id: '1', stats }],
      awayAthletes: [],
    });
    expect(rejection(() => parseBoxScore(response)).reason).toBe('parse_failed');
  });

  it('rejects a box score missing a stat key', () => {
    const response = summaryResponse({ ...base, homeAthletes: [{ id: '1' }], awayAthletes: [] });
    response.boxscore.players[1].statistics[0].keys = ['minutes'];
    expect(rejection(() => parseBoxScore(response)).reason).toBe('parse_failed');
  });
});

describe('parseInjuries', () => {
  it('reads the athlete id from the player link and maps statuses', () => {
    const injuries = parseInjuries(
      injuriesResponse([
        {
          id: '1',
          entries: [
            {
              athleteId: '4701230',
              status: 'Out',
              returnDate: '2026-11-07',
              type: 'Ankle',
              side: 'Left',
            },
            { athleteId: '5', status: 'Day-To-Day', type: 'Knee', side: 'Not Specified' },
          ],
        },
      ])
    );

    expect(injuries).toEqual([
      {
        athleteExternalId: '4701230',
        status: 'OUT',
        detail: 'Left Ankle',
        expectedReturnOn: '2026-11-07',
        reportedAt: new Date('2026-11-06T22:06:00Z'),
        comment: 'Player (ankle) is out.',
        fantasyStatus: 'OUT',
        seasonEnding: false,
      },
      {
        athleteExternalId: '5',
        status: 'DAY_TO_DAY',
        detail: 'Knee',
        expectedReturnOn: null,
        reportedAt: new Date('2026-11-06T22:06:00Z'),
        comment: 'Player (ankle) is out.',
        fantasyStatus: 'OUT',
        seasonEnding: false,
      },
    ]);
  });

  it('keeps the trimmed note and fantasy status, and nulls them when missing', () => {
    const [noted, bare] = parseInjuries(
      injuriesResponse([
        {
          id: '1',
          entries: [
            {
              athleteId: '11',
              status: 'Day-To-Day',
              fantasyStatus: 'GTD',
              comment: '  Zed Example (ankle) is questionable for Sunday.  ',
            },
            { athleteId: '12', fantasyStatus: null, comment: null },
          ],
        },
      ])
    );

    expect(noted).toMatchObject({
      status: 'DAY_TO_DAY',
      comment: 'Zed Example (ankle) is questionable for Sunday.',
      fantasyStatus: 'GTD',
      seasonEnding: false,
    });
    expect(bare).toMatchObject({ comment: null, fantasyStatus: null, seasonEnding: false });
  });

  it('marks a season-ender from the fantasy status OFS, keeping its placeholder return date', () => {
    const [entry] = parseInjuries(
      injuriesResponse([
        {
          id: '1',
          entries: [
            {
              athleteId: '13',
              fantasyStatus: 'OFS',
              returnDate: '2027-10-01',
              comment: 'Zed Example underwent surgery to repair a torn right Achilles tendon.',
            },
          ],
        },
      ])
    );

    expect(entry).toMatchObject({
      status: 'OUT',
      fantasyStatus: 'OFS',
      expectedReturnOn: '2027-10-01',
      seasonEnding: true,
    });
  });

  it('does not read the comment for season-enders without the OFS status', () => {
    const [entry] = parseInjuries(
      injuriesResponse([
        {
          id: '1',
          entries: [
            { athleteId: '14', comment: 'Zed Example (knee) will miss the rest of the season.' },
          ],
        },
      ])
    );

    expect(entry).toMatchObject({ status: 'OUT', seasonEnding: false });
  });

  it('rejects an entry whose link has no athlete id', () => {
    const response = injuriesResponse([
      { id: '1', entries: [{ athleteId: '1', href: 'https://www.espn.com/nba/' }] },
    ]);
    expect(rejection(() => parseInjuries(response)).reason).toBe('parse_failed');
  });

  it('rejects a status it does not know', () => {
    const response = injuriesResponse([
      { id: '1', entries: [{ athleteId: '1', status: 'Probable' }] },
    ]);
    expect(rejection(() => parseInjuries(response)).reason).toBe('parse_failed');
  });
});

describe('parseSeasonTotals', () => {
  it('reads totals by stat name', () => {
    const totals = parseSeasonTotals(
      seasonTotalsResponse([
        {
          id: '3945274',
          name: 'Luka Doncic',
          gamesPlayed: 64,
          minutes: 2289,
          points: 2143,
          rebounds: 495,
          assists: 530,
        },
      ])
    );

    expect(totals).toEqual([
      {
        athleteExternalId: '3945274',
        fullName: 'Luka Doncic',
        gamesPlayed: 64,
        minutes: 2289,
        points: 2143,
        rebounds: 495,
        assists: 530,
      },
    ]);
  });
});
