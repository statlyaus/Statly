/**
 * Fills Prisma `PlayerSeasonStat` for one season from the ETL's Footywire match stats
 * (docs/runbooks/player-identity.md, "Player season stat totals").
 *
 *   --season <year>            print what the fill would write, the rows it would replace, and
 *                              every unlinked or ambiguous ETL player
 *   --season <year> --apply    replace the season's rows in one transaction
 *
 * Add --production to target production; without it the database must be a disposable
 * statly_verify_player_* database, as for the Footywire identity links.
 */
import { PrismaClient } from '@prisma/client';

import { resolveFootywirePlayerIds } from '@/server/players/footywireIdentity';
import {
  validateDisposablePlayerIdentityDatabase,
  validatePlayerIdentityFirestoreProject,
  validateProductionPlayerIdentityDatabase,
} from '@/server/players/playerIdentityConsolidationCli';
import {
  aggregatePlayerSeasonStats,
  replacePlayerSeasonStats,
  toEtlSeasonStatRow,
  type EtlSeasonStatRow,
} from '@/server/players/playerSeasonStats';

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function readEtlSeasonRows(season: number): Promise<EtlSeasonStatRow[]> {
  const { adminDb } = await import('@/lib/firebaseAdmin');
  validatePlayerIdentityFirestoreProject({
    expectedProjectId: process.env.STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT ?? '',
    actualProjectId: (adminDb as unknown as { projectId?: string }).projectId,
  });
  const snapshot = await adminDb
    .collection('player_match_stats')
    .where('season', '==', season)
    .get();
  return snapshot.docs.map((doc) => toEtlSeasonStatRow(doc.id, doc.data()));
}

async function main() {
  const argv = process.argv.slice(2);
  const season = Number(argValue(argv, '--season'));
  if (!Number.isInteger(season)) throw new Error('Use --season <year> [--apply]');

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
    const etlRows = await readEtlSeasonRows(season);
    const [links, stored] = await Promise.all([
      resolveFootywirePlayerIds(
        etlRows.map((row) => row.playerUid),
        prisma
      ),
      prisma.playerSeasonStat.count({ where: { season } }),
    ]);
    const { rows, unlinked, ambiguous } = aggregatePlayerSeasonStats(season, etlRows, links);
    console.log(JSON.stringify({ season, players: rows.length, unlinked, ambiguous }, null, 2));
    console.error(
      `${etlRows.length} ETL rows: ${rows.length} linked players would replace ${stored} stored, ` +
        `${unlinked.length} unlinked (link them with player-identity:footywire, then fill again), ` +
        `${ambiguous.length} ambiguous (left out).`
    );
    if (!argv.includes('--apply')) return;
    console.log(JSON.stringify(await replacePlayerSeasonStats(prisma, season, rows)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
