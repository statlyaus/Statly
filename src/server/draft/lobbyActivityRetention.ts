import { prisma } from '@/lib/prisma';

// LobbyActivity has no league or season column, and retention is age-based for every draft, so this
// prune is deliberately global across leagues and seasons.

export const DEFAULT_LOBBY_ACTIVITY_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Unset means the default; anything but a whole number from 1 to 3650 is invalid (null). */
export function parseRetentionDays(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return DEFAULT_LOBBY_ACTIVITY_RETENTION_DAYS;
  if (!/^\d+$/.test(raw.trim())) return null;
  const days = Number(raw.trim());
  return days >= 1 && days <= MAX_RETENTION_DAYS ? days : null;
}

/** Deletes (or, on a dry run, counts) LobbyActivity rows older than the retention window. */
export async function pruneLobbyActivity(
  retentionDays: number,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<{ count: number; cutoff: Date }> {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  const where = { timestamp: { lt: cutoff } };
  const count = dryRun
    ? await prisma.lobbyActivity.count({ where })
    : (await prisma.lobbyActivity.deleteMany({ where })).count;
  return { count, cutoff };
}
