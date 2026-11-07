import 'server-only';

import type { PrismaClient } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { dateOnlyToString, toEasternDate, type EasternDate } from '@/lib/basketball/fantasyWeeks';
import {
  buildRotation,
  isRoleUp,
  type AlertLevel,
  type RotationDnpReason,
  type RotationGameRow,
  type RotationPlayer,
  type RotationPlayerInfo,
  type RotationTeam,
  type WhyOut,
} from '@/lib/basketball/rotation';
import { prisma } from '@/lib/prisma';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';

import {
  loadStatsUpdatedAt,
  ownerLabels,
  type PlayerOwner,
  type PoolPlayerInjury,
} from './playerPool';

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

const DNP_REASONS: readonly RotationDnpReason[] = [
  'COACH_DECISION',
  'INJURY',
  'REST',
  'SUSPENDED',
  'PERSONAL',
  'OTHER',
];

/**
 * A season's box-score rows as the data cache stores them (JSON, 2 MB per entry at most): one
 * number tuple per row, with game ids, dates, team codes and player ids listed once. A full season
 * (about 37,000 rows) packs to about 1 MB; as plain objects it would be several times the limit.
 */
interface PackedRows {
  games: [gameId: string, gameDate: EasternDate][];
  teamCodes: string[];
  playerIds: string[];
  /** game, team, player (indexes), flags (1 starter + 2 played), dnp (0 or 1 + DNP_REASONS index),
   * seconds, FGM, FGA, 3PM, FTA, plus-minus. */
  rows: number[][];
}

function packRows(rows: RotationGameRow[]): PackedRows {
  const indexer = <T>(key: (value: T) => string) => {
    const list: T[] = [];
    const index = new Map<string, number>();
    return {
      list,
      of(value: T): number {
        const found = index.get(key(value));
        if (found !== undefined) return found;
        index.set(key(value), list.length);
        return list.push(value) - 1;
      },
    };
  };
  const games = indexer<[string, EasternDate]>(([gameId]) => gameId);
  const teams = indexer<string>((code) => code);
  const players = indexer<string>((id) => id);
  return {
    rows: rows.map((row) => [
      games.of([row.gameId, row.gameDate]),
      teams.of(row.teamCode),
      players.of(row.playerId),
      (row.starter ? 1 : 0) + (row.played ? 2 : 0),
      row.dnpReason ? DNP_REASONS.indexOf(row.dnpReason) + 1 : 0,
      row.secondsPlayed,
      row.fieldGoalsMade,
      row.fieldGoalsAttempted,
      row.threePointersMade,
      row.freeThrowsAttempted,
      row.plusMinus,
    ]),
    games: games.list,
    teamCodes: teams.list,
    playerIds: players.list,
  };
}

function unpackRows(packed: PackedRows): RotationGameRow[] {
  return packed.rows.map(([game, team, player, flags, dnp, seconds, fgm, fga, tpm, fta, pm]) => ({
    gameId: packed.games[game][0],
    gameDate: packed.games[game][1],
    teamCode: packed.teamCodes[team],
    playerId: packed.playerIds[player],
    starter: (flags & 1) === 1,
    played: (flags & 2) === 2,
    dnpReason: dnp ? DNP_REASONS[dnp - 1] : null,
    secondsPlayed: seconds,
    fieldGoalsMade: fgm,
    fieldGoalsAttempted: fga,
    threePointersMade: tpm,
    freeThrowsAttempted: fta,
    plusMinus: pm,
  }));
}

async function readSeasonRows(client: RotationReadClient, season: number): Promise<PackedRows> {
  const rows = await client.nbaPlayerGameStat.findMany({
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
  });
  return packRows(
    rows.map(({ game, team, ...row }) => ({
      ...row,
      gameDate: dateOnlyToString(game.gameDate),
      teamCode: team.code,
    }))
  );
}

/** One season's rotation from its final box scores; shared by every league on that season. */
const loadSeasonRotation = cache(
  async (client: RotationReadClient, season: number): Promise<SeasonRotation> => {
    // The box scores only change when an ingest run lands, so its finish time keys the cache;
    // the revalidate is a backstop. Names and injuries are read fresh on every render.
    const statsUpdatedAt = await loadStatsUpdatedAt(client);
    const packed = await unstable_cache(
      () => readSeasonRows(client, season),
      ['basketball:rotation', String(season), statsUpdatedAt ?? 'never'],
      { revalidate: 300 }
    )();
    const rows = unpackRows(packed);
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

    const rotation = buildRotation(rows, info);

    return {
      statsUpdatedAt,
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
      .filter((player) => player.owner.kind === 'FREE_AGENT' && isRoleUp(player.alert))
      .sort((a, b) => b.minutesPerGame - a.minutesPerGame),
  };
}
