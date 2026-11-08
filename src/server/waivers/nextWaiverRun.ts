import { isWaiverRunHour } from './waiverSchedule';

const HOUR_MS = 60 * 60 * 1000;

/**
 * When a claim due at `dueAt` is actually processed: the first daily run (6 am Melbourne, on the
 * hour) at or after it. Melbourne's offset is a whole number of hours, so its hours start on UTC
 * hours; the run is found within 25 hours, across daylight-saving changes.
 */
export function nextWaiverRunAt(dueAt: Date): Date {
  const candidate = new Date(Math.ceil(dueAt.getTime() / HOUR_MS) * HOUR_MS);
  while (!isWaiverRunHour(candidate)) {
    candidate.setTime(candidate.getTime() + HOUR_MS);
  }
  return candidate;
}

/** The latest daily run (6 am Melbourne, on the hour) at or before `now`. */
export function previousWaiverRunAt(now: Date): Date {
  const candidate = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  while (!isWaiverRunHour(candidate)) {
    candidate.setTime(candidate.getTime() - HOUR_MS);
  }
  return candidate;
}
