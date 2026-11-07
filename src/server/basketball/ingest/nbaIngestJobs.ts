import { toEasternDate } from '@/lib/basketball/fantasyWeeks';

import { syncNbaBoxScores } from './syncNbaBoxScores';
import { syncNbaInjuries } from './syncNbaInjuries';
import { syncNbaPlayers } from './syncNbaPlayers';
import { syncNbaSchedule } from './syncNbaSchedule';

/** The four jobs by the name the cron route (`?job=`) and `npm run nba:sync -- --job` take. */
export const NBA_INGEST_JOBS = {
  boxscores: syncNbaBoxScores,
  schedule: syncNbaSchedule,
  players: syncNbaPlayers,
  injuries: syncNbaInjuries,
} as const;

export type NbaIngestJobName = keyof typeof NBA_INGEST_JOBS;

export function isNbaIngestJobName(value: unknown): value is NbaIngestJobName {
  return typeof value === 'string' && Object.hasOwn(NBA_INGEST_JOBS, value);
}

/**
 * The NBA season an instant belongs to, named by the year it ends. The Finals end in June, so from
 * 1 July (US Eastern) the next season is current: 8 November 2026 is in 2027 (2026-27).
 */
export function nbaSeasonForDate(now: Date): number {
  const [year, month] = toEasternDate(now).split('-').map(Number);
  return month >= 7 ? year + 1 : year;
}
