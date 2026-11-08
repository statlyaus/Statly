/**
 * Reviewed Footywire identity links (docs/runbooks/player-identity.md, "Footywire stats identity").
 *
 *   --propose --season <year>   print a proposal from the season's ETL stats and Statly players
 *   --manifest <file>           show what a reviewed manifest would create, keep and refuse
 *   --manifest <file> --apply   write the reviewed links (refused if anything conflicts)
 *
 * Add --production to target production; without it the database must be a disposable
 * statly_verify_player_* database, as for player identity consolidation.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  applyFootywireIdentityManifest,
  FOOTYWIRE_STATS_PROVIDER,
  planFootywireIdentityManifest,
  proposeFootywireIdentityManifest,
  type FootywireEtlPlayer,
} from '@/server/players/footywireIdentity';
import {
  validateDisposablePlayerIdentityDatabase,
  validatePlayerIdentityFirestoreProject,
  validateProductionPlayerIdentityDatabase,
} from '@/server/players/playerIdentityConsolidationCli';

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function readEtlPlayers(season: number): Promise<FootywireEtlPlayer[]> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  validatePlayerIdentityFirestoreProject({
    expectedProjectId: process.env.STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT ?? '',
    actualProjectId: (adminDb as unknown as { projectId?: string }).projectId,
  });
  const snapshot = await adminDb
    .collection('player_match_stats')
    .where('season', '==', season)
    .get();

  // A player's club for the proposal is the one from his latest round this season.
  const latest = new Map<string, FootywireEtlPlayer & { round: number }>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const externalId = String(data.player_uid ?? '');
    const round = Number(data.round ?? data.round_number ?? 0);
    if (!externalId) continue;
    const current = latest.get(externalId);
    if (!current || round >= current.round) {
      latest.set(externalId, {
        externalId,
        name: String(data.player_name ?? ''),
        club: String(data.team ?? ''),
        round,
      });
    }
  }
  return [...latest.values()].map(({ round: _round, ...player }) => player);
}

async function main() {
  const argv = process.argv.slice(2);
  const propose = argv.includes('--propose');
  const apply = argv.includes('--apply');
  const manifestPath = argValue(argv, '--manifest');
  const seasonValue = argValue(argv, '--season');
  if (propose === Boolean(manifestPath)) {
    throw new Error('Use either --propose --season <year> or --manifest <file> [--apply]');
  }
  if (apply && !manifestPath) throw new Error('--apply needs --manifest <file>');

  const databaseUrl = argv.includes('--production')
    ? validateProductionPlayerIdentityDatabase({
        databaseUrl: process.env.DATABASE_URL ?? '',
        expectedUrl: process.env.STATLY_PLAYER_IDENTITY_PRODUCTION_DB ?? '',
        requireBackup: false,
      })
    : validateDisposablePlayerIdentityDatabase({
        databaseUrl: process.env.DATABASE_URL ?? '',
        expectedUrl: process.env.STATLY_VERIFY_DB ?? '',
      });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    // The guard above makes --propose and --manifest exclusive, so no manifest means a proposal.
    if (!manifestPath) {
      const season = Number(seasonValue);
      if (!Number.isInteger(season)) throw new Error('--propose needs --season <year>');
      const [etlPlayers, players, existingIdentities] = await Promise.all([
        readEtlPlayers(season),
        prisma.player.findMany({ select: { id: true, name: true, club: true } }),
        prisma.playerExternalIdentity.findMany({
          where: { provider: FOOTYWIRE_STATS_PROVIDER },
          select: { externalId: true, playerId: true },
        }),
      ]);
      const proposal = proposeFootywireIdentityManifest({
        etlPlayers,
        players,
        existingIdentities,
      });
      console.log(JSON.stringify(proposal, null, 2));
      console.error(
        `Proposed ${proposal.mappings.length}, unmatched ${proposal.unmatched.length}, ` +
          `already linked ${proposal.alreadyMapped}. Review before using it.`
      );
      return;
    }

    const manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8')) as unknown;
    if (apply) {
      console.log(JSON.stringify(await applyFootywireIdentityManifest(prisma, manifest)));
      return;
    }
    const plan = await planFootywireIdentityManifest(prisma, manifest);
    console.log(JSON.stringify(plan, null, 2));
    if (plan.blockers.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
