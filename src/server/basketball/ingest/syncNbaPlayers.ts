import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { dateOnlyToString, stringToDateOnly } from '@/lib/basketball/fantasyWeeks';

import {
  type NbaIngestJobOptions,
  type NbaIngestPrisma,
  type NbaIngestResult,
  recordNbaIngestRun,
} from './nbaIngestRun';
import {
  NbaIngestRejected,
  type NbaProviderPlayer,
  type NbaProviderTeam,
  type NbaStatsProvider,
} from './nbaStatsProvider';

/**
 * PLAYERS job: the thirty teams and their current rosters. Upserts NbaTeam by code and NbaPlayer by
 * provider identity (never by name); a player no longer on any roster is marked inactive with no
 * team. Rejected, writing nothing but the run row, unless there are exactly 30 teams and 300 to 700
 * rostered players (about 530 in season, two-way contracts included).
 */

export const NBA_TEAM_COUNT = 30;
export const MIN_ROSTERED_PLAYERS = 300;
export const MAX_ROSTERED_PLAYERS = 700;
const CREATE_CHUNK = 500;

export interface NbaPlayersSummary {
  teams: number;
  players: number;
  created: number;
  updated: number;
  deactivated: number;
  /** Players listed on two rosters at once; the first roster wins. */
  duplicates: number;
}

/** Fetches the teams and rejects anything but 30 distinct standard codes. */
export async function fetchThirtyTeams(provider: NbaStatsProvider): Promise<NbaProviderTeam[]> {
  const teams = await provider.fetchTeams();
  const codes = new Set(teams.map((team) => team.code));
  if (teams.length !== NBA_TEAM_COUNT || codes.size !== NBA_TEAM_COUNT) {
    throw new NbaIngestRejected(
      'out_of_bounds',
      `Expected ${NBA_TEAM_COUNT} teams with distinct codes, got ${teams.length} teams and ${codes.size} codes`
    );
  }
  return teams;
}

interface RosteredPlayer extends NbaProviderPlayer {
  teamCode: string;
}

async function fetchRosteredPlayers(provider: NbaStatsProvider, teams: NbaProviderTeam[]) {
  const rosters = await Promise.all(
    teams.map(async (team) => ({ team, players: await provider.fetchTeamRoster(team.externalId) }))
  );
  const players = new Map<string, RosteredPlayer>();
  let duplicates = 0;
  for (const { team, players: roster } of rosters) {
    for (const player of roster) {
      if (players.has(player.externalId)) duplicates += 1;
      else players.set(player.externalId, { ...player, teamCode: team.code });
    }
  }
  if (players.size < MIN_ROSTERED_PLAYERS || players.size > MAX_ROSTERED_PLAYERS) {
    throw new NbaIngestRejected(
      'out_of_bounds',
      `Expected ${MIN_ROSTERED_PLAYERS} to ${MAX_ROSTERED_PLAYERS} rostered players, got ${players.size}`
    );
  }
  return { players: [...players.values()], duplicates };
}

async function upsertTeams(prisma: NbaIngestPrisma, teams: NbaProviderTeam[]) {
  const ids = new Map<string, string>();
  for (const team of teams) {
    const row = await prisma.nbaTeam.upsert({
      where: { code: team.code },
      create: { code: team.code, name: team.name },
      update: { name: team.name },
      select: { id: true },
    });
    ids.set(team.code, row.id);
  }
  return ids;
}

export async function syncNbaPlayers(
  options: NbaIngestJobOptions
): Promise<NbaIngestResult<NbaPlayersSummary>> {
  const { prisma, provider } = options;
  return recordNbaIngestRun('PLAYERS', options, async () => {
    const teams = await fetchThirtyTeams(provider);
    const { players, duplicates } = await fetchRosteredPlayers(provider, teams);

    // Every check has passed; writes start here. They are idempotent, so a crash part-way is
    // repaired by the next run. ponytail: teams, updates and releases are not one transaction with
    // the creates; add one if a reader ever needs the roster set to change atomically.
    const teamIds = await upsertTeams(prisma, teams);
    const known = await prisma.nbaPlayerIdentity.findMany({
      where: { provider: provider.id },
      select: {
        externalId: true,
        player: {
          select: {
            id: true,
            fullName: true,
            firstName: true,
            lastName: true,
            positions: true,
            teamId: true,
            birthDate: true,
            active: true,
          },
        },
      },
    });
    const knownByExternalId = new Map(
      known.map((identity) => [identity.externalId, identity.player])
    );

    const toCreate: Array<{
      player: Prisma.NbaPlayerCreateManyInput & { id: string };
      externalId: string;
    }> = [];
    let updated = 0;
    for (const player of players) {
      const data = {
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        positions: player.positions,
        teamId: teamIds.get(player.teamCode) ?? null,
        birthDate: player.birthDate ? stringToDateOnly(player.birthDate) : null,
        active: true,
      };
      const existing = knownByExternalId.get(player.externalId);
      if (!existing) {
        toCreate.push({ player: { id: randomUUID(), ...data }, externalId: player.externalId });
        continue;
      }
      const unchanged =
        existing.fullName === data.fullName &&
        existing.firstName === data.firstName &&
        existing.lastName === data.lastName &&
        existing.positions.join() === data.positions.join() &&
        existing.teamId === data.teamId &&
        (existing.birthDate ? dateOnlyToString(existing.birthDate) : null) === player.birthDate &&
        existing.active;
      if (!unchanged) {
        await prisma.nbaPlayer.update({ where: { id: existing.id }, data });
        updated += 1;
      }
    }

    // New players (about 530 on the first run) go in with their identities in one transaction, a
    // few statements per chunk, so no player is ever left without its provider identity.
    if (toCreate.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          for (let index = 0; index < toCreate.length; index += CREATE_CHUNK) {
            const chunk = toCreate.slice(index, index + CREATE_CHUNK);
            await tx.nbaPlayer.createMany({ data: chunk.map(({ player }) => player) });
            await tx.nbaPlayerIdentity.createMany({
              data: chunk.map(({ player, externalId }) => ({
                playerId: player.id,
                provider: provider.id,
                externalId,
              })),
            });
          }
        },
        { timeout: 60_000 }
      );
    }

    const rostered = new Set(players.map((player) => player.externalId));
    const released = known
      .filter((identity) => identity.player.active && !rostered.has(identity.externalId))
      .map((identity) => identity.player.id);
    if (released.length > 0) {
      await prisma.nbaPlayer.updateMany({
        where: { id: { in: released } },
        data: { active: false, teamId: null },
      });
    }

    return {
      teams: teams.length,
      players: players.length,
      created: toCreate.length,
      updated,
      deactivated: released.length,
      duplicates,
    };
  });
}
