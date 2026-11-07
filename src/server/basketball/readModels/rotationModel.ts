import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { cache } from 'react';

import {
  dateOnlyToString,
  fantasyWeekOf,
  toEasternDate,
  type EasternDate,
} from '@/lib/basketball/fantasyWeeks';
import {
  buildRotation,
  type AlertLevel,
  type RotationPlayer,
  type RotationPlayerInfo,
  type RotationTeam,
  type WhyOut,
} from '@/lib/basketball/rotation';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import type { PlayerOwner, PoolPlayerInjury } from './playerPool';

/** The Prisma reads the rotation page makes; tests pass an in-memory fake. */
export type RotationReadClient = Pick<
  PrismaClient,
  'nbaPlayerGameStat' | 'nbaPlayer' | 'nbaIngestRun'
>;

export interface RotationPlayerView extends RotationPlayer {
  fullName: string;
  positions: string[];
  injury: PoolPlayerInjury | null;
  owner: PlayerOwner;
}

export interface RotationTeamView extends Omit<RotationTeam, 'lastChange'> {
  lastChange: {
    gameDate: EasternDate;
    into: { playerId: string; name: string }[];
    out: { playerId: string; name: string; why: WhyOut }[];
  } | null;
}

export interface RotationView {
  season: number;
  /** When the latest successful box-score ingest finished (ISO), or null. */
  statsUpdatedAt: string | null;
  teams: RotationTeamView[];
  /** Every player listed in a box score this season, by name. */
  players: RotationPlayerView[];
  opponentName: string | null;
  /** Players with an alert, most serious first. */
  alerts: { mine: RotationPlayerView[]; opponent: RotationPlayerView[] };
  /** Free agents with a bigger role (new starters, injury cover, minutes up) and no red alert. */
  freeAgentRoleUps: RotationPlayerView[];
}

interface SeasonRotation {
  teams: RotationTeamView[];
  players: Omit<RotationPlayerView, 'owner'>[];
  statsUpdatedAt: string | null;
}

/** One season's rotation from its final box scores; shared by every league on that season. */
const loadSeasonRotation = cache(
  async (client: RotationReadClient, season: number): Promise<SeasonRotation> => {
    const [rows, run] = await Promise.all([
      client.nbaPlayerGameStat.findMany({
        where: { game: { season, status: 'FINAL' } },
        select: {
          gameId: true,
          playerId: true,
          starter: true,
          played: true,
          dnpReason: true,
          secondsPlayed: true,
          fieldGoalsMade: true,
          fieldGoalsAttempted: true,
          threePointersMade: true,
          freeThrowsAttempted: true,
          plusMinus: true,
          game: { select: { gameDate: true } },
          team: { select: { code: true } },
        },
      }),
      client.nbaIngestRun.findFirst({
        where: { job: { in: ['BOX_SCORES', 'BACKFILL'] }, outcome: 'SUCCEEDED' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      }),
    ]);
    const identities = rows.length
      ? await client.nbaPlayer.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.playerId))] } },
          select: {
            id: true,
            fullName: true,
            positions: true,
            injury: { select: { status: true, detail: true, expectedReturnOn: true } },
          },
        })
      : [];

    const identityById = new Map(identities.map((player) => [player.id, player]));
    const injuryOf = (playerId: string): PoolPlayerInjury | null => {
      const injury = identityById.get(playerId)?.injury;
      return injury
        ? {
            status: injury.status,
            detail: injury.detail,
            expectedReturnOn: injury.expectedReturnOn
              ? dateOnlyToString(injury.expectedReturnOn)
              : null,
          }
        : null;
    };
    const info = new Map<string, RotationPlayerInfo>(
      identities.map((player) => [
        player.id,
        {
          name: player.fullName,
          position: player.positions[0] ?? null,
          returnOn: injuryOf(player.id)?.expectedReturnOn ?? null,
        },
      ])
    );
    const nameOf = (playerId: string) => identityById.get(playerId)?.fullName ?? 'Unknown player';

    const rotation = buildRotation(
      rows.map(({ game, team, ...row }) => ({
        ...row,
        gameDate: dateOnlyToString(game.gameDate),
        teamCode: team.code,
      })),
      info
    );

    return {
      statsUpdatedAt: run?.finishedAt?.toISOString() ?? null,
      teams: rotation.teams.map((team) => ({
        ...team,
        lastChange: team.lastChange
          ? {
              gameDate: team.lastChange.gameDate,
              into: team.lastChange.into.map((playerId) => ({ playerId, name: nameOf(playerId) })),
              out: team.lastChange.out.map((left) => ({ ...left, name: nameOf(left.playerId) })),
            }
          : null,
      })),
      players: rotation.players
        .map((player) => ({
          ...player,
          fullName: nameOf(player.playerId),
          positions: identityById.get(player.playerId)?.positions ?? [],
          injury: injuryOf(player.playerId),
        }))
        .sort(
          (a, b) => a.fullName.localeCompare(b.fullName) || a.playerId.localeCompare(b.playerId)
        ),
    };
  }
);

// ponytail: same rule as playerPool's private ownerLabels; export that one if a third copy appears.
function ownerLabels(
  league: BasketballLeagueDetail,
  today: EasternDate
): { owners: Map<string, PlayerOwner>; opponentName: string | null } {
  const week = fantasyWeekOf(today, league.weekOneStartsOn, league.twoWeekMatchups);
  const opponentId = league.matchups.find(
    (matchup) => matchup.week === week && matchup.teamId === league.myTeamId
  )?.opponentTeamId;
  const teamName = new Map(league.teams.map((team) => [team.id, team.name]));
  const owners = new Map(
    league.rosterSpots.map((spot): [string, PlayerOwner] => {
      if (spot.teamId === null) return [spot.playerId, { kind: 'ELSEWHERE', teamName: null }];
      const kind =
        spot.teamId === league.myTeamId ? 'MINE' : spot.teamId === opponentId ? 'OPPONENT' : 'TEAM';
      return [spot.playerId, { kind, teamName: teamName.get(spot.teamId) ?? '' }];
    })
  );
  return { owners, opponentName: (opponentId && teamName.get(opponentId)) || null };
}

const LEVEL_ORDER: Record<AlertLevel, number> = { RED: 0, AMBER: 1, GREEN: 2 };

const bySeverity = (a: RotationPlayerView, b: RotationPlayerView) =>
  LEVEL_ORDER[a.alert!.level] - LEVEL_ORDER[b.alert!.level] || a.fullName.localeCompare(b.fullName);

/**
 * The Rotation page for one authorised league: the season's starting-five churn per NBA team and
 * every player's role and alerts, labelled with who holds him in this league. NBA data is read by
 * season only.
 */
export async function loadRotation(
  league: BasketballLeagueDetail,
  options: { today?: EasternDate; client?: RotationReadClient } = {}
): Promise<RotationView> {
  const season = await loadSeasonRotation(options.client ?? prisma, league.season);
  const { owners, opponentName } = ownerLabels(league, options.today ?? toEasternDate(new Date()));
  const players = season.players.map((player): RotationPlayerView => ({
    ...player,
    owner: owners.get(player.playerId) ?? { kind: 'FREE_AGENT', teamName: null },
  }));
  const withAlert = (kind: PlayerOwner['kind']) =>
    players.filter((player) => player.owner.kind === kind && player.alert).sort(bySeverity);

  return {
    season: league.season,
    statsUpdatedAt: season.statsUpdatedAt,
    teams: season.teams,
    players,
    opponentName,
    alerts: { mine: withAlert('MINE'), opponent: withAlert('OPPONENT') },
    freeAgentRoleUps: players
      .filter(
        (player) =>
          player.owner.kind === 'FREE_AGENT' &&
          player.alert?.roleUp &&
          // A benched or coach-DNP player whose minutes also rose is not moving up.
          player.alert.level !== 'RED'
      )
      .sort((a, b) => b.minutesPerGame - a.minutesPerGame),
  };
}
