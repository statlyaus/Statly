import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PrismaClient,
  type Prisma,
} from '@prisma/client';

import {
  addDays,
  daysBetween,
  stringToDateOnly,
  toEasternDate,
  type EasternDate,
} from '../../src/lib/basketball/fantasyWeeks';
import { DEVELOPMENT_AUTH_EMAIL, DEVELOPMENT_AUTH_USER_ID } from '../../src/lib/devAuth';
import { upsertCanonicalPlayer } from '../../src/server/players/playerIdentityService';
import {
  NINE_CATEGORY_PRESET,
  YAHOO_DEFAULT_ROSTER_SLOTS,
  type BasketballCategoryId,
} from '../../src/types/basketball';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '../../src/types/fantasyCategories';

export const E2E_LEAGUE_ID = 'e2e-completed-league';
export const E2E_DRAFT_ID = 'cme2edraft0000e2etestdraft';
export const E2E_SEASON_ID = 'e2e-completed-season';
const E2E_SETTINGS_ID = 'e2e-completed-settings';
export const E2E_HUMAN_MEMBER_ID = 'e2e-member-human';
export const E2E_BOT_MEMBER_ID = 'e2e-member-bot';
export const E2E_BOT_USER_ID = 'e2e-bot-user';
const E2E_MEMBER_IDS = [E2E_HUMAN_MEMBER_ID, E2E_BOT_MEMBER_ID];

const E2E_PLAYERS = [
  { id: 'e2e-player-darcy-cameron', name: 'Darcy Cameron', club: 'Collingwood', position: 'RUC' },
  { id: 'e2e-player-zach-merrett', name: 'Zach Merrett', club: 'Essendon', position: 'MID' },
  { id: 'e2e-player-hayden-young', name: 'Hayden Young', club: 'Fremantle', position: 'MID' },
  { id: 'e2e-player-sam-durham', name: 'Sam Durham', club: 'Essendon', position: 'MID' },
] as const;
export const E2E_PLAYER_ID = E2E_PLAYERS[0].id;

// Fantasy basketball fixtures: four NBA teams, twelve players, games this fantasy week and the two
// before it, last season's games, one injury, fresh ingest runs, and a league profile owned by the
// development user with a matchup this week. Dates are relative to today's US Eastern date, so the
// fixtures never go stale: the league's week 3 is always the Monday-to-Sunday week containing today.
export const E2E_BASKETBALL_LEAGUE_ID = 'e2e-bball-league';
export const E2E_BASKETBALL_MY_TEAM_ID = 'e2e-bball-team-mine';
export const E2E_BASKETBALL_OPPONENT_TEAM_ID = 'e2e-bball-team-rival';
const E2E_BASKETBALL_OTHER_TEAM_ID = 'e2e-bball-team-bench-mob';
/** Leagues the development user creates in e2e specs are named with this prefix and removed here. */
export const E2E_BASKETBALL_CREATED_LEAGUE_PREFIX = 'E2E ';
const E2E_NBA_PROVIDER = 'e2e';

const E2E_NBA_TEAMS = [
  { id: 'e2e-nba-team-bos', code: 'BOS', name: 'Boston Celtics' },
  { id: 'e2e-nba-team-nyk', code: 'NYK', name: 'New York Knicks' },
  { id: 'e2e-nba-team-den', code: 'DEN', name: 'Denver Nuggets' },
  { id: 'e2e-nba-team-lal', code: 'LAL', name: 'Los Angeles Lakers' },
] as const;

type E2eNbaTeamCode = (typeof E2E_NBA_TEAMS)[number]['code'];

/** Fictional players. Jalen Price and Jordan Price make a pasted "J. Price" ambiguous. */
export const E2E_NBA_PLAYERS: readonly {
  id: string;
  fullName: string;
  team: E2eNbaTeamCode;
  positions: string[];
  owner: 'mine' | 'rival' | null;
}[] = [
  {
    id: 'e2e-nba-player-marcus-hale',
    fullName: 'Marcus Hale',
    team: 'BOS',
    positions: ['PG'],
    owner: 'mine',
  },
  {
    id: 'e2e-nba-player-devin-brooks',
    fullName: 'Devin Brooks',
    team: 'BOS',
    positions: ['SF', 'PF'],
    owner: 'rival',
  },
  {
    id: 'e2e-nba-player-owen-carter',
    fullName: 'Owen Carter',
    team: 'BOS',
    positions: ['C'],
    owner: 'mine',
  },
  {
    id: 'e2e-nba-player-jalen-price',
    fullName: 'Jalen Price',
    team: 'NYK',
    positions: ['SG'],
    owner: 'mine',
  },
  {
    id: 'e2e-nba-player-tariq-bell',
    fullName: 'Tariq Bell',
    team: 'NYK',
    positions: ['PF'],
    owner: 'rival',
  },
  {
    id: 'e2e-nba-player-luca-moretti',
    fullName: 'Luca Moretti',
    team: 'NYK',
    positions: ['PG', 'SG'],
    owner: null,
  },
  {
    id: 'e2e-nba-player-jordan-price',
    fullName: 'Jordan Price',
    team: 'DEN',
    positions: ['SF'],
    owner: 'rival',
  },
  {
    id: 'e2e-nba-player-nikolai-petrov',
    fullName: 'Nikolai Petrov',
    team: 'DEN',
    positions: ['C'],
    owner: 'mine',
  },
  {
    id: 'e2e-nba-player-andre-wallace',
    fullName: 'Andre Wallace',
    team: 'DEN',
    positions: ['G'],
    owner: 'rival',
  },
  {
    id: 'e2e-nba-player-caleb-young',
    fullName: 'Caleb Young',
    team: 'LAL',
    positions: ['PG'],
    owner: 'mine',
  },
  {
    id: 'e2e-nba-player-darius-holt',
    fullName: 'Darius Holt',
    team: 'LAL',
    positions: ['F'],
    owner: null,
  },
  {
    id: 'e2e-nba-player-kenji-watanabe',
    fullName: 'Kenji Watanabe',
    team: 'LAL',
    positions: ['C', 'PF'],
    owner: 'rival',
  },
];
/** On the injury report as OUT. */
export const E2E_NBA_INJURED_PLAYER_ID = 'e2e-nba-player-owen-carter';

// Every team plays the other three once per fantasy week, in three rounds.
const E2E_ROUND_ROBIN: readonly { round: 0 | 1 | 2; home: E2eNbaTeamCode; away: E2eNbaTeamCode }[] =
  [
    { round: 0, home: 'BOS', away: 'NYK' },
    { round: 0, home: 'DEN', away: 'LAL' },
    { round: 1, home: 'BOS', away: 'DEN' },
    { round: 1, home: 'NYK', away: 'LAL' },
    { round: 2, home: 'LAL', away: 'BOS' },
    { round: 2, home: 'NYK', away: 'DEN' },
  ];

export interface E2eBasketballCalendar {
  today: EasternDate;
  /** Monday of week 1: two weeks before the Monday of the week containing today. */
  weekOneStartsOn: EasternDate;
  regularSeasonEndsOn: EasternDate;
  /** The season the league reads, named as the leagues service names it: from week one. */
  season: number;
  /** The fantasy week containing today. */
  currentWeek: 3;
  currentWeekStart: EasternDate;
}

export function e2eBasketballCalendar(now = new Date()): E2eBasketballCalendar {
  const today = toEasternDate(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const currentWeekStart = addDays(today, -((weekday + 6) % 7));
  const weekOneStartsOn = addDays(currentWeekStart, -14);
  const regularSeasonEndsOn = addDays(weekOneStartsOn, 174);
  return {
    today,
    weekOneStartsOn,
    regularSeasonEndsOn,
    // A week one from July on belongs to the season ending the next year (2026-27 is 2027).
    season:
      Number(weekOneStartsOn.slice(0, 4)) + (Number(weekOneStartsOn.slice(5, 7)) >= 7 ? 1 : 0),
    currentWeek: 3,
    currentWeekStart,
  };
}

/** A plausible, internally consistent box-score line that varies by player and game. */
function e2eStatLine(playerIndex: number, gameIndex: number) {
  const fieldGoalsAttempted = 8 + (playerIndex % 5) * 2 + (gameIndex % 3);
  const fieldGoalsMade = Math.round(fieldGoalsAttempted * (0.42 + (playerIndex % 4) * 0.03));
  const threePointersAttempted = 2 + (playerIndex % 4);
  const threePointersMade = Math.min(fieldGoalsMade, Math.round(threePointersAttempted * 0.36));
  const freeThrowsAttempted = 2 + (playerIndex % 3) * 2;
  const freeThrowsMade = Math.round(freeThrowsAttempted * (0.7 + (playerIndex % 3) * 0.08));
  const rebounds = 3 + ((playerIndex * 2) % 9) + (gameIndex % 2);
  const offensiveRebounds = Math.floor(rebounds / 4);
  return {
    starter: playerIndex % 3 !== 2,
    played: true,
    secondsPlayed: (24 + ((playerIndex * 3) % 14)) * 60,
    points: 2 * (fieldGoalsMade - threePointersMade) + 3 * threePointersMade + freeThrowsMade,
    rebounds,
    offensiveRebounds,
    defensiveRebounds: rebounds - offensiveRebounds,
    assists: 1 + ((playerIndex * 3) % 8),
    steals: (playerIndex + gameIndex) % 3,
    blocks: (playerIndex * 2 + gameIndex) % 3,
    turnovers: 1 + ((playerIndex + gameIndex) % 3),
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    personalFouls: 2,
    plusMinus: gameIndex % 2 ? 4 : -3,
  };
}

async function seedBasketballFixtures(tx: Prisma.TransactionClient, now: Date) {
  const calendar = e2eBasketballCalendar(now);
  const playerIds = E2E_NBA_PLAYERS.map((player) => player.id);

  // League profiles first: their roster spots reference the players.
  await tx.basketballLeague.deleteMany({
    where: {
      OR: [
        { id: E2E_BASKETBALL_LEAGUE_ID },
        {
          ownerId: DEVELOPMENT_AUTH_USER_ID,
          name: { startsWith: E2E_BASKETBALL_CREATED_LEAGUE_PREFIX },
        },
      ],
    },
  });
  await tx.nbaPlayerGameStat.deleteMany({ where: { game: { provider: E2E_NBA_PROVIDER } } });
  await tx.nbaGame.deleteMany({ where: { provider: E2E_NBA_PROVIDER } });
  await tx.nbaPlayerInjury.deleteMany({ where: { playerId: { in: playerIds } } });
  await tx.nbaIngestRun.deleteMany({ where: { provider: E2E_NBA_PROVIDER } });

  // Reference teams are matched by their standard code, so a database that already holds real
  // teams keeps their ids.
  const teamIdByCode = new Map<E2eNbaTeamCode, string>();
  for (const team of E2E_NBA_TEAMS) {
    const row = await tx.nbaTeam.upsert({
      where: { code: team.code },
      update: {},
      create: team,
      select: { id: true },
    });
    teamIdByCode.set(team.code, row.id);
  }
  const teamId = (code: E2eNbaTeamCode) => teamIdByCode.get(code) as string;

  for (const player of E2E_NBA_PLAYERS) {
    const [firstName, ...rest] = player.fullName.split(' ');
    const data = {
      fullName: player.fullName,
      firstName,
      lastName: rest.join(' '),
      positions: player.positions,
      teamId: teamId(player.team),
      active: true,
    };
    await tx.nbaPlayer.upsert({
      where: { id: player.id },
      update: data,
      create: { id: player.id, ...data },
    });
    await tx.nbaPlayerIdentity.upsert({
      where: { provider_externalId: { provider: E2E_NBA_PROVIDER, externalId: player.id } },
      update: { playerId: player.id },
      create: { playerId: player.id, provider: E2E_NBA_PROVIDER, externalId: player.id },
    });
  }

  // Rounds play Monday, Wednesday and Friday. In the current week the last round moves to today
  // when today is later than Friday, so from Tuesday to Sunday the week always has games played
  // (FINAL, with stats) and games still to come (SCHEDULED, today included).
  const todayIndex = daysBetween(calendar.currentWeekStart, calendar.today);
  const pastWeekDays = [0, 2, 4];
  const currentWeekDays = [0, 2, Math.max(4, todayIndex)];
  // This season's weeks 1 to 3, and week 1's schedule a year earlier for last season.
  const schedules = [
    { season: calendar.season, weekStart: calendar.weekOneStartsOn, days: pastWeekDays },
    {
      season: calendar.season,
      weekStart: addDays(calendar.weekOneStartsOn, 7),
      days: pastWeekDays,
    },
    { season: calendar.season, weekStart: calendar.currentWeekStart, days: currentWeekDays },
    {
      season: calendar.season - 1,
      weekStart: addDays(calendar.weekOneStartsOn, -364),
      days: pastWeekDays,
    },
  ];
  let gameIndex = 0;
  for (const { season, weekStart, days } of schedules) {
    for (const fixture of E2E_ROUND_ROBIN) {
      gameIndex += 1;
      const gameDate = addDays(weekStart, days[fixture.round]);
      const final = gameDate < calendar.today;
      const externalId = `${season}-${gameDate}-${fixture.home}-${fixture.away}`;
      const game = await tx.nbaGame.create({
        data: {
          id: `e2e-nba-game-${externalId}`,
          provider: E2E_NBA_PROVIDER,
          externalId,
          season,
          startsAt: new Date(`${gameDate}T23:30:00.000Z`),
          gameDate: stringToDateOnly(gameDate),
          homeTeamId: teamId(fixture.home),
          awayTeamId: teamId(fixture.away),
          status: final ? 'FINAL' : 'SCHEDULED',
          homeScore: final ? 110 + (gameIndex % 9) : null,
          awayScore: final ? 104 + (gameIndex % 7) : null,
          boxScoreIngestedAt: final ? now : null,
        },
        select: { id: true },
      });
      if (!final) continue;
      await tx.nbaPlayerGameStat.createMany({
        data: E2E_NBA_PLAYERS.flatMap((player, playerIndex) =>
          player.team === fixture.home || player.team === fixture.away
            ? [
                {
                  gameId: game.id,
                  playerId: player.id,
                  teamId: teamId(player.team),
                  ...e2eStatLine(playerIndex, gameIndex),
                },
              ]
            : []
        ),
      });
    }
  }

  await tx.nbaPlayerInjury.create({
    data: {
      playerId: E2E_NBA_INJURED_PLAYER_ID,
      status: 'OUT',
      detail: 'Ankle',
      expectedReturnOn: stringToDateOnly(addDays(calendar.today, 10)),
      reportedAt: now,
      fetchedAt: now,
    },
  });
  const finishedAt = new Date(now.getTime() - 30 * 60_000);
  await tx.nbaIngestRun.createMany({
    data: (['BOX_SCORES', 'INJURIES'] as const).map((job) => ({
      job,
      provider: E2E_NBA_PROVIDER,
      startedAt: finishedAt,
      finishedAt,
      outcome: 'SUCCEEDED' as const,
      summaryJson: { fixture: 'e2e' },
    })),
  });

  await tx.basketballLeague.create({
    data: {
      id: E2E_BASKETBALL_LEAGUE_ID,
      ownerId: DEVELOPMENT_AUTH_USER_ID,
      name: 'Hardwood Heroes',
      platform: 'YAHOO',
      season: calendar.season,
      format: 'H2H_MOST_CATEGORIES',
      categories: [...NINE_CATEGORY_PRESET] as BasketballCategoryId[],
      puntCategories: [],
      teamCount: 12,
      rosterSlotsJson: YAHOO_DEFAULT_ROSTER_SLOTS,
      weekOneStartsOn: stringToDateOnly(calendar.weekOneStartsOn),
      regularSeasonEndsOn: stringToDateOnly(calendar.regularSeasonEndsOn),
      auctionBudget: 200,
      teams: {
        create: [
          { id: E2E_BASKETBALL_MY_TEAM_ID, name: 'Dev Dunkers', isMine: true, sortOrder: 0 },
          { id: E2E_BASKETBALL_OPPONENT_TEAM_ID, name: 'Rival Rebounders', sortOrder: 1 },
          { id: E2E_BASKETBALL_OTHER_TEAM_ID, name: 'Bench Mob', sortOrder: 2 },
        ],
      },
    },
  });
  await tx.basketballRosterSpot.createMany({
    data: E2E_NBA_PLAYERS.flatMap((player) =>
      player.owner
        ? [
            {
              leagueId: E2E_BASKETBALL_LEAGUE_ID,
              teamId:
                player.owner === 'mine'
                  ? E2E_BASKETBALL_MY_TEAM_ID
                  : E2E_BASKETBALL_OPPONENT_TEAM_ID,
              playerId: player.id,
              acquiredOn: stringToDateOnly(calendar.weekOneStartsOn),
            },
          ]
        : []
    ),
  });
  await tx.basketballMatchup.create({
    data: {
      leagueId: E2E_BASKETBALL_LEAGUE_ID,
      week: calendar.currentWeek,
      teamId: E2E_BASKETBALL_MY_TEAM_ID,
      opponentTeamId: E2E_BASKETBALL_OPPONENT_TEAM_ID,
    },
  });
}

async function globalSetup() {
  const prisma = new PrismaClient();
  const now = new Date('2026-06-14T00:00:00.000Z');

  try {
    await prisma.$transaction(async (tx) => {
      const fixtureDrafts = await tx.draft.findMany({
        where: { OR: [{ id: E2E_DRAFT_ID }, { leagueId: E2E_LEAGUE_ID }] },
        select: { id: true },
      });
      const fixtureDraftIds = fixtureDrafts.map((draft) => draft.id);

      await tx.leagueRosterPlayer.deleteMany({
        where: { OR: [{ leagueId: E2E_LEAGUE_ID }, { memberId: { in: E2E_MEMBER_IDS } }] },
      });
      await tx.teamAction.deleteMany({
        where: {
          OR: [
            { leagueId: E2E_LEAGUE_ID },
            { memberId: { in: E2E_MEMBER_IDS } },
            { targetMemberId: { in: E2E_MEMBER_IDS } },
          ],
        },
      });
      await tx.queueItem.deleteMany({ where: { memberId: { in: E2E_MEMBER_IDS } } });

      if (fixtureDraftIds.length > 0) {
        await tx.draftWatchlist.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.preDraftQueue.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.lobbyActivity.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draftEvent.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.pick.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draftOrder.deleteMany({ where: { draftId: { in: fixtureDraftIds } } });
        await tx.draft.deleteMany({ where: { id: { in: fixtureDraftIds } } });
      }

      // The season cascades to season-scoped rows (trade threads, social) that would block deleting
      // members, and itself blocks deleting the league.
      await tx.leagueSeason.deleteMany({ where: { leagueId: E2E_LEAGUE_ID } });
      await tx.leagueMember.deleteMany({ where: { leagueId: E2E_LEAGUE_ID } });
      await tx.league.deleteMany({ where: { id: E2E_LEAGUE_ID } });
      await tx.leagueSettings.deleteMany({ where: { id: E2E_SETTINGS_ID } });

      await tx.user.upsert({
        where: { id: DEVELOPMENT_AUTH_USER_ID },
        update: {
          email: DEVELOPMENT_AUTH_EMAIL,
          displayName: 'Statly Dev Tester',
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: DEVELOPMENT_AUTH_USER_ID,
          email: DEVELOPMENT_AUTH_EMAIL,
          passwordHash: 'e2e-dev-user',
          displayName: 'Statly Dev Tester',
          timeZone: 'Australia/Melbourne',
        },
      });

      await tx.user.upsert({
        where: { id: E2E_BOT_USER_ID },
        update: {
          email: 'e2e-bot@statly.local',
          displayName: 'AFL Legends',
          timeZone: 'Australia/Melbourne',
        },
        create: {
          id: E2E_BOT_USER_ID,
          email: 'e2e-bot@statly.local',
          passwordHash: 'e2e-bot-user',
          displayName: 'AFL Legends',
          timeZone: 'Australia/Melbourne',
        },
      });

      await tx.leagueSettings.create({
        data: {
          id: E2E_SETTINGS_ID,
          rosterSize: 2,
          benchSize: 0,
          maxTeams: 2,
          pickSeconds: 30,
          allowAutoPick: true,
          positionLimitsJson: { MID: 2, RUC: 1 },
          autoPickRulesJson: { strategy: 'statly-z' },
          draftType: DraftType.SNAKE,
          pickOrder: 'MANUAL',
          waiverRule: 'WEEKLY',
          startAt: now,
          timeZone: 'Australia/Melbourne',
          locked: true,
        },
      });

      await tx.league.create({
        data: {
          id: E2E_LEAGUE_ID,
          name: 'Test AFL Champions League',
          inviteCode: 'E2ETEST1',
          ownerId: DEVELOPMENT_AUTH_USER_ID,
          settingsId: E2E_SETTINGS_ID,
          categoriesJson: [...REAL_DATA_NINE_CATEGORY_PRESET],
          createdAt: now,
        },
      });

      await tx.leagueSeason.create({
        data: {
          id: E2E_SEASON_ID,
          leagueId: E2E_LEAGUE_ID,
          label: '2026 season',
          year: 2026,
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2026-12-31T23:59:59.999Z'),
        },
      });

      await tx.league.update({
        where: { id: E2E_LEAGUE_ID },
        data: { activeSeasonId: E2E_SEASON_ID },
      });

      await tx.leagueMember.createMany({
        data: [
          {
            id: E2E_HUMAN_MEMBER_ID,
            leagueId: E2E_LEAGUE_ID,
            userId: DEVELOPMENT_AUTH_USER_ID,
            role: LeagueRole.OWNER,
            teamName: 'Robbo Rockers',
            draftSlot: 1,
            joinedAt: now,
          },
          {
            id: E2E_BOT_MEMBER_ID,
            leagueId: E2E_LEAGUE_ID,
            userId: E2E_BOT_USER_ID,
            role: LeagueRole.MANAGER,
            teamName: 'AFL Legends',
            draftSlot: 2,
            joinedAt: now,
          },
        ],
      });

      await tx.playerExternalIdentity.deleteMany({
        where: {
          provider: 'statly-e2e',
          externalId: { in: E2E_PLAYERS.map((player) => player.id) },
        },
      });

      const canonicalPlayerIds: string[] = [];
      for (const player of E2E_PLAYERS) {
        await tx.player.upsert({
          where: { id: player.id },
          update: {
            name: player.name,
            club: player.club,
            position: player.position,
            active: true,
          },
          create: {
            id: player.id,
            name: player.name,
            club: player.club,
            position: player.position,
            active: true,
          },
        });
        const canonicalPlayer = await upsertCanonicalPlayer(tx, {
          provider: 'statly-e2e',
          externalId: player.id,
          name: player.name,
          club: player.club,
          position: player.position,
          active: true,
          canonicalPlayerId: player.id,
        });
        canonicalPlayerIds.push(canonicalPlayer.id);
      }

      await tx.draft.create({
        data: {
          id: E2E_DRAFT_ID,
          leagueId: E2E_LEAGUE_ID,
          status: DraftStatus.COMPLETED,
          currentPick: 4,
          totalPicks: 4,
          round: 2,
          direction: DraftDirection.REVERSE,
          lobbyStatus: 'CLOSED',
          lobbyOpenAt: now,
          startedAt: now,
          completedAt: now,
          pickStartedAt: now,
          pickDeadlineAt: now,
        },
      });

      await tx.draftOrder.createMany({
        data: [
          { draftId: E2E_DRAFT_ID, memberId: E2E_HUMAN_MEMBER_ID, slot: 1 },
          { draftId: E2E_DRAFT_ID, memberId: E2E_BOT_MEMBER_ID, slot: 2 },
        ],
      });

      const picks = [
        {
          id: 'e2e-pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          memberId: E2E_HUMAN_MEMBER_ID,
          playerId: canonicalPlayerIds[0],
        },
        {
          id: 'e2e-pick-2',
          overall: 2,
          round: 1,
          slot: 2,
          memberId: E2E_BOT_MEMBER_ID,
          playerId: canonicalPlayerIds[1],
        },
        {
          id: 'e2e-pick-3',
          overall: 3,
          round: 2,
          slot: 2,
          memberId: E2E_BOT_MEMBER_ID,
          playerId: canonicalPlayerIds[2],
        },
        {
          id: 'e2e-pick-4',
          overall: 4,
          round: 2,
          slot: 1,
          memberId: E2E_HUMAN_MEMBER_ID,
          playerId: canonicalPlayerIds[3],
        },
      ];

      await tx.pick.createMany({
        data: picks.map((pick) => ({
          ...pick,
          draftId: E2E_DRAFT_ID,
          madeAt: now,
          auto: pick.memberId !== E2E_HUMAN_MEMBER_ID,
        })),
      });

      await tx.leagueRosterPlayer.createMany({
        data: [
          {
            id: 'e2e-roster-player-1',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_HUMAN_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-1',
            playerId: canonicalPlayerIds[0],
            slot: 'RUC',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-2',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_HUMAN_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-4',
            playerId: canonicalPlayerIds[3],
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-3',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_BOT_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-2',
            playerId: canonicalPlayerIds[1],
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
          {
            id: 'e2e-roster-player-4',
            leagueId: E2E_LEAGUE_ID,
            memberId: E2E_BOT_MEMBER_ID,
            draftId: E2E_DRAFT_ID,
            pickId: 'e2e-pick-3',
            playerId: canonicalPlayerIds[2],
            slot: 'MID',
            acquiredBy: 'DRAFT',
            acquiredAt: now,
          },
        ],
      });
    });

    await prisma.$transaction((tx) => seedBasketballFixtures(tx, new Date()), { timeout: 30_000 });
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
