/*
  Prune LobbyActivity rows older than the retention window (default 30 days, across every league).
  Counts only unless --apply is given. The same logic backs /api/cron/prune-lobby.
  Usage:
    LOBBY_ACTIVITY_RETENTION_DAYS=30 tsx Scripts/prune-lobby-activity.ts [--apply]
*/
import { prisma } from '@/lib/prisma';
import { parseRetentionDays, pruneLobbyActivity } from '@/server/draft/lobbyActivityRetention';

async function main() {
  const days = parseRetentionDays(process.env.LOBBY_ACTIVITY_RETENTION_DAYS);
  if (days === null) {
    console.error('LOBBY_ACTIVITY_RETENTION_DAYS must be a whole number from 1 to 3650');
    process.exitCode = 2;
    return;
  }
  const apply = process.argv.includes('--apply');
  const { count, cutoff } = await pruneLobbyActivity(days, { dryRun: !apply });
  console.log(
    apply
      ? `Deleted ${count} LobbyActivity rows older than ${cutoff.toISOString()}`
      : `[DRY RUN] Would delete ${count} LobbyActivity rows older than ${cutoff.toISOString()} (pass --apply to delete)`
  );
}

main()
  .catch((e) => {
    console.error('Prune failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error('Failed to disconnect Prisma:', disconnectError);
    }
  });
