/*
  Prune LobbyActivity rows older than retention window.
  Usage:
    LOBBY_ACTIVITY_RETENTION_DAYS=30 tsx Scripts/prune-lobby-activity.ts
*/
import { prisma } from '@/lib/prisma';

async function main() {
  const rawDays = Number.parseInt(process.env.LOBBY_ACTIVITY_RETENTION_DAYS ?? '', 10);
  const days = Number.isFinite(rawDays) && rawDays >= 0 ? Math.min(rawDays, 3650) : 30; // cap at ~10 years
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const dryRun = String(process.env.DRY_RUN || 'false') === 'true';

  if (dryRun) {
    const count = await prisma.lobbyActivity.count({ where: { timestamp: { lt: cutoff } } });
    console.log(
      `[DRY RUN] Would delete ${count} LobbyActivity rows older than ${cutoff.toISOString()}`
    );
    return;
  }

  const res = await prisma.lobbyActivity.deleteMany({ where: { timestamp: { lt: cutoff } } });
  console.log(`Deleted ${res.count} LobbyActivity rows older than ${cutoff.toISOString()}`);
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
