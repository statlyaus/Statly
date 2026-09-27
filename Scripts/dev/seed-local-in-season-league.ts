#!/usr/bin/env tsx
/**
 * Local-only fixture: one in-season league for the development user so the manager home, matchup,
 * standings and lineup surfaces can be reviewed with realistic state. Refuses non-local databases.
 *
 * Run after `npm run dev:full:local` has seeded the base stack:
 *   npm run dev:seed:in-season
 */
import { PrismaClient } from '@prisma/client';

import { buildDefaultLineup } from '../../src/lib/leagues/lineupAutoFill';

const LEAGUE_ID = 'local-in-season-league';
const SETTINGS_ID = 'local-in-season-settings';
const SEASON_ID = 'local-in-season-2026';
const DRAFT_ID = 'local-in-season-draft';
const FIXTURE_VERSION = 1;
const ROUNDS = 6;
const LIVE_ROUND = 4;
const DAY = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  ['goals', 8, 18],
  ['tackles', 55, 85],
  ['inside50s', 40, 65],
  ['intercepts', 45, 75],
  ['contestedMarks', 6, 16],
  ['rebound50s', 30, 50],
  ['contestedPossessions', 120, 170],
  ['effectiveDisposals', 250, 330],
  ['scoreInvolvements', 75, 110],
] as const;

const TEAMS = [
  'Robbo Rockers',
  'Punt Road Pirates',
  'Hard Ball Gets',
  'Centre Square Crew',
  'Goal Square Gang',
  'Behind the Posts',
  'Wing Commanders',
  'Forward Pocket FC',
  'Ruck Rovers',
  'Boundary Riders',
];

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const local = url.startsWith('file:') || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (!local || process.env.NODE_ENV === 'production') {
    throw new Error('seed-local-in-season-league only runs against a local development database');
  }
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Circle-method round robin for an even number of teams. */
function roundRobin(teamCount: number, round: number): Array<[number, number]> {
  const others = Array.from({ length: teamCount - 1 }, (_, i) => i + 1);
  const shift = (round - 1) % others.length;
  const rotated = [...others.slice(shift), ...others.slice(0, shift)];
  const order = [0, ...rotated];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < teamCount / 2; i += 1) {
    const a = order[i];
    const b = order[teamCount - 1 - i];
    pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
  }
  return pairs;
}

const GAME_SLOTS_HOURS = [0, 24.2, 42.25, 45.1, 48.1, 65.7, 67.8, 70.2, 72.8];

async function seedAflFixtures({
  now,
  players,
  liveRound,
}: {
  now: Date;
  players: Array<{ club: string }>;
  liveRound: number;
}) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.warn('[local-in-season] FIRESTORE_EMULATOR_HOST not set; skipping AFL fixtures.');
    return;
  }
  // Same local project id the full local stack gives the emulators and the web app.
  const projectId = process.env.STATLY_LOCAL_PROJECT_ID || 'statly-4cbed';
  if (!process.env.GCLOUD_PROJECT) process.env.GCLOUD_PROJECT = projectId;
  if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = projectId;
  const { adminDb } = await import('../../src/lib/firebaseAdmin');
  const season = now.getFullYear();
  const clubs = [...new Set(players.map((player) => player.club))].sort();
  for (let round = 1; round <= ROUNDS; round += 1) {
    const aflRound = round + 20;
    // Round starts on the same Thursday evening the fantasy round opens.
    const roundStart = new Date(now.getTime() + (round - liveRound) * 7 * DAY - DAY);
    const shift = round % clubs.length;
    const order = [...clubs.slice(shift), ...clubs.slice(0, shift)];
    const byes = round === liveRound + 1 ? order.splice(order.length - 2, 2) : [];
    const batch = adminDb.batch();
    for (let index = 0; index < order.length / 2; index += 1) {
      const startsAt = new Date(roundStart.getTime() + GAME_SLOTS_HOURS[index] * 60 * 60 * 1000);
      const status =
        round < liveRound
          ? 'final'
          : round > liveRound
            ? 'scheduled'
            : startsAt.getTime() + 3 * 60 * 60 * 1000 < now.getTime()
              ? 'final'
              : startsAt.getTime() < now.getTime()
                ? 'in_progress'
                : 'scheduled';
      const id = `local-in-season-${season}-r${aflRound}-${index + 1}`;
      batch.set(adminDb.collection('matches').doc(id), {
        match_uid: id,
        season,
        round_number: aflRound,
        home_team: order[index * 2],
        away_team: order[index * 2 + 1],
        start_time_utc: startsAt.toISOString(),
        status,
        confirmed_bye_teams: index === 0 ? byes : [],
        localFixture: true,
      });
    }
    await batch.commit();
  }
  console.log(`[local-in-season] Wrote AFL fixtures for rounds 21-${20 + ROUNDS} of ${season}.`);
}

async function main() {
  assertLocalDatabase();
  const prisma = new PrismaClient();
  const { DEVELOPMENT_AUTH_USER_ID } = await import('../../src/lib/devAuth');
  const random = rng(20260926);
  const now = new Date();

  try {
    // Remove a previous run of this fixture only.
    const offers = await prisma.leagueTradeOffer.findMany({
      where: { thread: { leagueId: LEAGUE_ID } },
      select: { id: true },
    });
    await prisma.leagueTradePlayer.deleteMany({
      where: { offerId: { in: offers.map((offer) => offer.id) } },
    });
    await prisma.leagueTradeThread.updateMany({
      where: { leagueId: LEAGUE_ID },
      data: { currentOfferId: null },
    });
    await prisma.leagueTradeOffer.deleteMany({ where: { thread: { leagueId: LEAGUE_ID } } });
    await prisma.leagueTradeThread.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueLineupPlayer.deleteMany({ where: { lineup: { leagueId: LEAGUE_ID } } });
    await prisma.leagueLineup.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueMatchupScore.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueMatchup.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueCompetitionRound.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueStanding.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.draft.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.league.updateMany({ where: { id: LEAGUE_ID }, data: { activeSeasonId: null } });
    await prisma.leagueSeason.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.leagueMember.deleteMany({ where: { leagueId: LEAGUE_ID } });
    await prisma.league.deleteMany({ where: { id: LEAGUE_ID } });
    await prisma.leagueSettings.deleteMany({ where: { id: SETTINGS_ID } });

    await prisma.leagueSettings.create({
      data: {
        id: SETTINGS_ID,
        rosterSize: 22,
        benchSize: 4,
        maxTeams: TEAMS.length,
        pickSeconds: 60,
        draftType: 'SNAKE',
        timeZone: 'Australia/Melbourne',
        startAt: new Date(now.getTime() - 40 * DAY),
        competitionStatus: 'ACTIVE',
        competitionRulesVersion: FIXTURE_VERSION,
        // Top four play finals, so Standings shows a finals line.
        competitionRulesJson: JSON.stringify({ regularSeasonRounds: ROUNDS, finalsTeams: 4 }),
        competitionPublishedAt: new Date(now.getTime() - 30 * DAY),
      },
    });
    await prisma.league.create({
      data: {
        id: LEAGUE_ID,
        name: 'Thursday Night Footy League',
        inviteCode: 'LOCALSEASON',
        ownerId: DEVELOPMENT_AUTH_USER_ID,
        settingsId: SETTINGS_ID,
        categoriesJson: JSON.stringify(CATEGORIES.map(([key]) => key)),
      },
    });
    await prisma.leagueSeason.create({
      data: {
        id: SEASON_ID,
        leagueId: LEAGUE_ID,
        label: '2026 Season',
        year: 2026,
        startsAt: new Date(now.getTime() - 22 * DAY),
        endsAt: new Date(now.getTime() + 60 * DAY),
      },
    });
    await prisma.league.update({ where: { id: LEAGUE_ID }, data: { activeSeasonId: SEASON_ID } });

    for (let index = 1; index < TEAMS.length; index += 1) {
      await prisma.user.upsert({
        where: { id: `local-in-season-bot-${index}` },
        update: {},
        create: {
          id: `local-in-season-bot-${index}`,
          email: `local-in-season-bot-${index}@statly.local`,
          passwordHash: 'local-fixture-no-login',
          displayName: TEAMS[index],
        },
      });
    }

    const members = [];
    for (const [index, teamName] of TEAMS.entries()) {
      members.push(
        await prisma.leagueMember.create({
          data: {
            id: `local-in-season-member-${index + 1}`,
            leagueId: LEAGUE_ID,
            userId: index === 0 ? DEVELOPMENT_AUTH_USER_ID : `local-in-season-bot-${index}`,
            role: index === 0 ? 'OWNER' : 'MANAGER',
            teamName,
            draftSlot: index + 1,
          },
        })
      );
    }
    const me = members[0];

    await prisma.draft.create({
      data: {
        id: DRAFT_ID,
        leagueId: LEAGUE_ID,
        status: 'COMPLETED',
        totalPicks: TEAMS.length * 22,
        currentPick: TEAMS.length * 22,
        startedAt: new Date(now.getTime() - 40 * DAY),
        completedAt: new Date(now.getTime() - 40 * DAY + 3 * 60 * 60 * 1000),
      },
    });

    const players = await prisma.player.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      take: TEAMS.length * 22,
      select: { id: true, name: true, club: true, position: true },
    });
    const rosters = new Map<string, typeof players>();
    players.forEach((player, index) => {
      const member = members[index % members.length];
      rosters.set(member.id, [...(rosters.get(member.id) ?? []), player]);
    });
    for (const [memberId, roster] of rosters) {
      await prisma.leagueRosterPlayer.createMany({
        data: roster.map((player) => ({
          leagueId: LEAGUE_ID,
          memberId,
          draftId: DRAFT_ID,
          playerId: player.id,
        })),
      });
    }

    const standings = new Map(
      members.map((member) => [
        member.id,
        { wins: 0, losses: 0, draws: 0, categoryWins: 0, categoryLosses: 0, categoryDraws: 0 },
      ])
    );

    for (let round = 1; round <= ROUNDS; round += 1) {
      const startsAt = new Date(now.getTime() + (round - LIVE_ROUND) * 7 * DAY - DAY);
      const endsAt = new Date(startsAt.getTime() + 4 * DAY);
      const status = round < LIVE_ROUND ? 'FINAL' : round === LIVE_ROUND ? 'LOCKED' : 'SCHEDULED';
      const competitionRound = await prisma.leagueCompetitionRound.create({
        data: {
          leagueId: LEAGUE_ID,
          seasonId: SEASON_ID,
          fixtureVersion: FIXTURE_VERSION,
          round,
          aflRound: round + 20,
          status,
          startsAt,
          endsAt,
          publishedAt: new Date(now.getTime() - 30 * DAY),
          lockedAt: round <= LIVE_ROUND ? startsAt : null,
        },
      });

      for (const [homeIndex, awayIndex] of roundRobin(TEAMS.length, round)) {
        const home = members[homeIndex];
        const away = members[awayIndex];
        const played = round <= LIVE_ROUND;
        const progress = round === LIVE_ROUND ? 0.6 : 1;
        const rows = CATEGORIES.map(([category, min, max]) => {
          if (!played) {
            return { category, homeValue: 0, awayValue: 0, direction: 'HIGH_WINS', winner: 'draw' };
          }
          const homeValue = Math.round((min + random() * (max - min)) * progress);
          const awayValue = Math.round((min + random() * (max - min)) * progress);
          const winner = homeValue === awayValue ? 'draw' : homeValue > awayValue ? 'home' : 'away';
          return { category, homeValue, awayValue, direction: 'HIGH_WINS', winner };
        });
        const homeWins = rows.filter((row) => played && row.winner === 'home').length;
        const awayWins = rows.filter((row) => played && row.winner === 'away').length;
        const draws = played ? rows.length - homeWins - awayWins : 0;
        const final = round < LIVE_ROUND;
        const matchupStatus = final ? 'FINAL' : round === LIVE_ROUND ? 'LIVE' : 'SCHEDULED';
        const winnerMemberId =
          final && homeWins !== awayWins ? (homeWins > awayWins ? home.id : away.id) : null;

        const matchup = await prisma.leagueMatchup.create({
          data: {
            leagueId: LEAGUE_ID,
            round,
            fixtureVersion: FIXTURE_VERSION,
            competitionRoundId: competitionRound.id,
            homeMemberId: home.id,
            awayMemberId: away.id,
            status: matchupStatus,
            startsAt,
            endsAt,
            finalizedAt: final ? endsAt : null,
            winnerMemberId,
            homeCategoryWins: homeWins,
            awayCategoryWins: awayWins,
            drawnCategories: draws,
          },
        });

        if (played) {
          const categoriesJson = JSON.stringify(rows);
          for (const [member, wins, losses] of [
            [home, homeWins, awayWins],
            [away, awayWins, homeWins],
          ] as const) {
            await prisma.leagueMatchupScore.create({
              data: {
                leagueId: LEAGUE_ID,
                matchupId: matchup.id,
                memberId: member.id,
                round,
                categoriesJson,
                categoryWins: wins,
                categoryLosses: losses,
                categoryDraws: draws,
                matchupWin: final && wins > losses,
                matchupLoss: final && wins < losses,
                matchupDraw: final && wins === losses,
                status: matchupStatus,
                finalizedAt: final ? endsAt : null,
              },
            });
            if (final) {
              const standing = standings.get(member.id)!;
              standing.categoryWins += wins;
              standing.categoryLosses += losses;
              standing.categoryDraws += draws;
              if (wins > losses) standing.wins += 1;
              else if (wins < losses) standing.losses += 1;
              else standing.draws += 1;
            }
          }
        }
      }
    }

    await prisma.leagueStanding.createMany({
      data: [...standings].map(([memberId, standing]) => ({
        leagueId: LEAGUE_ID,
        memberId,
        ...standing,
      })),
    });

    // Every team fielded a lineup, picked by position, in each played round. The next round has
    // no saved lineups, so My Team shows each manager their default team to confirm.
    const SLOT_COUNTS = { DEF: 5, MID: 5, RUC: 1, FWD: 5, UTIL: 3 } as const;
    const INTERCHANGE_SLOTS = 3;
    const spots = [
      ...(['DEF', 'MID', 'RUC', 'FWD', 'UTIL'] as const).flatMap((slot) =>
        Array.from({ length: SLOT_COUNTS[slot] }, (_, slotIndex) => ({ slot, slotIndex }))
      ),
      ...Array.from({ length: INTERCHANGE_SLOTS }, (_, slotIndex) => ({
        slot: 'INTERCHANGE' as const,
        slotIndex,
      })),
    ];
    for (const member of members) {
      const roster = rosters.get(member.id) ?? [];
      const { assignments } = buildDefaultLineup({
        spots,
        players: roster.map((player, index) => ({
          playerId: player.id,
          position: player.position,
          available: true,
          // Draft order stands in for form, so earlier picks start.
          score: roster.length - index,
        })),
      });
      for (let round = 1; round <= LIVE_ROUND; round += 1) {
        await prisma.leagueLineup.create({
          data: {
            leagueId: LEAGUE_ID,
            memberId: member.id,
            round,
            lockedAt: new Date(now.getTime() - DAY),
            players: { create: assignments },
          },
        });
      }
    }

    // AFL fixtures for the league's rounds in the local Firestore emulator, so lineups show each
    // player's opponent, game time and byes. Two clubs have a bye in the next round.
    await seedAflFixtures({ now, players, liveRound: LIVE_ROUND });

    // One trade offer waiting on the development user, and one pending waiver claim.
    const proposer = members[2];
    const thread = await prisma.leagueTradeThread.create({
      data: {
        leagueId: LEAGUE_ID,
        seasonId: SEASON_ID,
        memberOneId: proposer.id,
        memberTwoId: me.id,
      },
    });
    const offer = await prisma.leagueTradeOffer.create({
      data: {
        threadId: thread.id,
        sequence: 1,
        proposerMemberId: proposer.id,
        recipientMemberId: me.id,
        expiresAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
        reviewMode: 'NONE',
        reviewHours: 24,
        vetoThreshold: 3,
        message: 'Your ruck depth for my forward line?',
      },
    });
    const theirPlayer = (rosters.get(proposer.id) ?? [])[0];
    const myRoster = rosters.get(me.id) ?? [];
    const myPlayer = myRoster[myRoster.length - 1];
    await prisma.leagueTradePlayer.createMany({
      data: [
        {
          offerId: offer.id,
          playerId: theirPlayer.id,
          playerNameSnapshot: theirPlayer.name,
          playerClubSnapshot: theirPlayer.club,
          playerPositionSnapshot: theirPlayer.position,
          fromMemberId: proposer.id,
          toMemberId: me.id,
        },
        {
          offerId: offer.id,
          playerId: myPlayer.id,
          playerNameSnapshot: myPlayer.name,
          playerClubSnapshot: myPlayer.club,
          playerPositionSnapshot: myPlayer.position,
          fromMemberId: me.id,
          toMemberId: proposer.id,
        },
      ],
    });
    await prisma.leagueTradeThread.update({
      where: { id: thread.id },
      data: { currentOfferId: offer.id },
    });
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE_ID,
        memberId: me.id,
        actionType: 'WAIVER_CLAIM',
        details: JSON.stringify({ note: 'Local fixture claim' }),
      },
    });

    console.log(
      `[local-in-season] Seeded "${TEAMS[0]}" in Thursday Night Footy League: round ${LIVE_ROUND} live, ${players.length} rostered players.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
