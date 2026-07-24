#!/usr/bin/env tsx

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import {
  consolidatePlayerIdentities,
  PlayerIdentityConsolidationBlockedError,
} from '@/server/players/playerIdentityConsolidation';
import {
  createPlayerIdentitySourceFingerprint,
  parsePlayerIdentityCliArgs,
  validateDisposablePlayerIdentityDatabase,
  validateProductionPlayerIdentityDatabase,
  validateReviewedPlayerIdentityManifest,
  type ReviewedPlayerIdentityManifest,
} from '@/server/players/playerIdentityConsolidationCli';
import { planPlayerIdentityConsolidation } from '@/server/players/playerIdentityConsolidationPlanner';

async function readManifest(manifestPath: string): Promise<ReviewedPlayerIdentityManifest> {
  const absolutePath = path.resolve(manifestPath);
  return validateReviewedPlayerIdentityManifest(
    JSON.parse(await fs.readFile(absolutePath, 'utf8')) as unknown
  );
}

async function proposeManifest(prisma: PrismaClient) {
  const players = await prisma.player.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, club: true, position: true },
  });
  const groups = new Map<string, typeof players>();

  for (const player of players) {
    const key = `${buildCanonicalPlayerId(player.name)}|${buildCanonicalPlayerId(player.club)}`;
    groups.set(key, [...(groups.get(key) ?? []), player]);
  }

  const candidates = [...groups.entries()]
    .filter(([, aliases]) => aliases.length > 1)
    .map(([evidenceKey, aliases]) => {
      const ranked = [...aliases].sort((left, right) => {
        const expectedId = buildCanonicalPlayerId(left.name);
        const canonicalDifference =
          Number(right.id === expectedId) - Number(left.id === expectedId);
        if (canonicalDifference !== 0) return canonicalDifference;
        const positionDifference = Number(Boolean(right.position)) - Number(Boolean(left.position));
        if (positionDifference !== 0) return positionDifference;
        return left.id.localeCompare(right.id);
      });
      const canonicalPlayerId = ranked[0].id;
      return {
        evidenceKey,
        name: ranked[0].name,
        club: ranked[0].club,
        canonicalPlayerId,
        playerIds: ranked.map((player) => player.id),
        mappings: ranked.slice(1).map((player) => ({
          aliasId: player.id,
          canonicalPlayerId,
        })),
      };
    });

  return {
    schemaVersion: 1,
    reviewed: false,
    reviewedBy: '',
    reviewedAt: '',
    sourceFingerprint: createPlayerIdentitySourceFingerprint(players),
    warning:
      'Name and club are candidate evidence only. Review every group; do not apply this proposal directly.',
    candidateGroups: candidates,
    mappings: candidates.flatMap((candidate) => candidate.mappings),
  };
}

async function projectWaiverAvailability(prisma: PrismaClient) {
  const { WaiverAvailabilityProjectionService } = await import(
    '@/server/waivers/WaiverAvailabilityProjectionService'
  );
  const projector = new WaiverAvailabilityProjectionService(prisma);
  const leagues = await prisma.league.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const results = [];
  for (const league of leagues) {
    results.push({
      leagueId: league.id,
      ...(await projector.projectLeague({ leagueId: league.id })),
    });
  }
  return results;
}

async function main() {
  const args = parsePlayerIdentityCliArgs(process.argv.slice(2));
  const databaseUrl = args.production
    ? validateProductionPlayerIdentityDatabase({
        databaseUrl: process.env.DATABASE_URL ?? '',
        expectedPath: process.env.STATLY_PLAYER_IDENTITY_PRODUCTION_DB ?? '',
        backupPath: process.env.STATLY_PLAYER_IDENTITY_BACKUP,
        requireBackup: args.apply,
      })
    : validateDisposablePlayerIdentityDatabase({
        databaseUrl: process.env.DATABASE_URL ?? '',
        expectedPath: process.env.STATLY_VERIFY_DB ?? '',
      });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    if (args.projectWaivers) {
      process.stdout.write(
        `${JSON.stringify({ status: 'projected', leagues: await projectWaiverAvailability(prisma) }, null, 2)}\n`
      );
      return;
    }
    if (args.propose) {
      process.stdout.write(`${JSON.stringify(await proposeManifest(prisma), null, 2)}\n`);
      return;
    }

    const manifest = await readManifest(args.manifestPath!);
    const currentPlayers = await prisma.player.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, club: true, position: true },
    });
    const currentFingerprint = createPlayerIdentitySourceFingerprint(currentPlayers);
    if (currentFingerprint !== manifest.sourceFingerprint) {
      throw new Error(
        'Player identity data changed after manifest proposal; generate and review a new manifest'
      );
    }
    const plan = await planPlayerIdentityConsolidation(prisma, manifest.mappings);

    if (!args.apply) {
      process.stdout.write(
        `${JSON.stringify({ manifestReviewed: manifest.reviewed, plan }, null, 2)}\n`
      );
      if (plan.status === 'blocked') process.exitCode = 1;
      return;
    }

    if (manifest.reviewed !== true) {
      throw new Error('Refusing to apply an identity manifest until reviewed is true');
    }

    const appliedPlan = await consolidatePlayerIdentities(prisma, manifest.mappings);
    const waiverProjectionResults = args.production ? await projectWaiverAvailability(prisma) : [];
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'applied',
          appliedMappings: appliedPlan.mappings.length,
          preservedOwnershipBoundary: 'leagueId + canonicalPlayerId',
          projectedLeagues: waiverProjectionResults.length,
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    if (error instanceof PlayerIdentityConsolidationBlockedError) {
      process.stderr.write(`${JSON.stringify(error.plan, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[player-identity-consolidation] Failed', error);
  process.exit(1);
});
