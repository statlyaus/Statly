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
  planPlayerIdentityConsolidation,
  type PlayerAliasMapping,
} from '@/server/players/playerIdentityConsolidationPlanner';

type ReviewedManifest = {
  reviewed: boolean;
  mappings: PlayerAliasMapping[];
};

function parseArgs(argv: readonly string[]) {
  const apply = argv.includes('--apply');
  const propose = argv.includes('--propose');
  const manifestIndex = argv.indexOf('--manifest');
  const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : undefined;

  if (propose && (apply || manifestPath)) {
    throw new Error('--propose cannot be combined with --apply or --manifest');
  }
  if (!propose && !manifestPath) {
    throw new Error('Use --propose or provide --manifest <reviewed-manifest.json>');
  }

  return { apply, propose, manifestPath };
}

function validateDisposableDatabase(): string {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim();
  const expectedPath = (process.env.STATLY_VERIFY_DB ?? '').trim();

  if (!databaseUrl || !expectedPath) {
    throw new Error('DATABASE_URL and STATLY_VERIFY_DB are required');
  }

  const parsedUrl = new URL(databaseUrl);
  const databasePath = decodeURIComponent(parsedUrl.pathname);
  if (
    parsedUrl.protocol !== 'file:' ||
    databasePath !== expectedPath ||
    !expectedPath.startsWith('/tmp/statly-verify-player-') ||
    !expectedPath.endsWith('.db')
  ) {
    throw new Error(
      'Identity consolidation is restricted to matching file:/tmp/statly-verify-player-*.db URLs'
    );
  }

  return databaseUrl;
}

async function readManifest(manifestPath: string): Promise<ReviewedManifest> {
  const absolutePath = path.resolve(manifestPath);
  const manifest = JSON.parse(await fs.readFile(absolutePath, 'utf8')) as ReviewedManifest;
  if (!Array.isArray(manifest.mappings)) {
    throw new Error('Manifest mappings must be an array');
  }
  return manifest;
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
    reviewed: false,
    warning:
      'Name and club are candidate evidence only. Review every group; do not apply this proposal directly.',
    candidateGroups: candidates,
    mappings: candidates.flatMap((candidate) => candidate.mappings),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = validateDisposableDatabase();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    if (args.propose) {
      process.stdout.write(`${JSON.stringify(await proposeManifest(prisma), null, 2)}\n`);
      return;
    }

    const manifest = await readManifest(args.manifestPath!);
    const plan = await planPlayerIdentityConsolidation(prisma, manifest.mappings);

    if (!args.apply) {
      process.stdout.write(
        `${JSON.stringify({ manifestReviewed: manifest.reviewed, plan }, null, 2)}\n`
      );
      if (plan.status === 'blocked') process.exitCode = 1;
      return;
    }

    if (!manifest.reviewed) {
      throw new Error('Refusing to apply an identity manifest until reviewed is true');
    }

    const appliedPlan = await consolidatePlayerIdentities(prisma, manifest.mappings);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: 'applied',
          appliedMappings: appliedPlan.mappings.length,
          preservedOwnershipBoundary: 'leagueId + canonicalPlayerId',
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
