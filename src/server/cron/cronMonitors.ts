import * as Sentry from '@sentry/nextjs';

// Sentry Crons monitors for the scheduled jobs (see docs/runbooks/monitoring-and-alerts.md).
// Each slug is the name of the netlify/functions/<slug>.mts scheduled function that calls the route;
// the check-in upserts the monitor, so no monitor has to be created by hand. Schedules are UTC, like
// Netlify's. A missed check-in (scheduler or site down) or an error check-in opens a Sentry issue.
interface CronMonitor {
  schedule: { type: 'crontab'; value: string };
  /** Minutes after the scheduled time before a run that never started counts as missed. */
  checkinMargin: number;
  /** Minutes a run may stay in progress before it counts as timed out. */
  maxRuntime: number;
  /** Consecutive failed or missed runs before Sentry opens an issue. */
  failureIssueThreshold: number;
  /** Consecutive good runs before Sentry resolves it. */
  recoveryThreshold: number;
  timezone: 'UTC';
}

function monitor(
  schedule: string,
  { checkinMargin, failureIssueThreshold }: { checkinMargin: number; failureIssueThreshold: number }
): CronMonitor {
  return {
    schedule: { type: 'crontab', value: schedule },
    checkinMargin,
    maxRuntime: 10,
    failureIssueThreshold,
    recoveryThreshold: 1,
    timezone: 'UTC',
  };
}

export const CRON_MONITORS = {
  // Fantasy league jobs: one failed run is a missed waiver day or stale scores, so alert at once.
  'cron-waivers': monitor('0 * * * *', { checkinMargin: 10, failureIssueThreshold: 1 }),
  'cron-scoring': monitor('0 * * * *', { checkinMargin: 10, failureIssueThreshold: 1 }),
  // Bloodsucker bite deadlines and window closes (NFR-6). It runs every 5 minutes, so two failed or
  // missed runs in a row (10 minutes) open an issue; one blip is retried by the next run.
  'cron-bloodsucker': monitor('*/5 * * * *', { checkinMargin: 5, failureIssueThreshold: 2 }),
  // NBA box scores read ESPN, which fails now and then; the next run repairs a single miss. The
  // other NBA jobs (injuries, players, schedule) are not monitored: each extra monitor is billed.
  'cron-nba-boxscores': monitor('7,37 * * * *', { checkinMargin: 10, failureIssueThreshold: 2 }),
} as const satisfies Record<string, CronMonitor>;

export type CronMonitorSlug = keyof typeof CRON_MONITORS;

export function isCronMonitorSlug(value: string): value is CronMonitorSlug {
  return Object.hasOwn(CRON_MONITORS, value);
}

// Wraps one authorised cron run. Any answer of 400 or more (a failed league, a rejected ingest) or a
// thrown error checks in as error; the response is returned unchanged. Call it after the auth check
// so unauthorised calls never check in. A no-op when Sentry is not initialised (tests, local dev).
export async function monitorCronRun(
  slug: CronMonitorSlug,
  run: () => Promise<Response>
): Promise<Response> {
  const startedAt = Date.now();
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: slug, status: 'in_progress' },
    CRON_MONITORS[slug]
  );
  const finish = async (status: 'ok' | 'error') => {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: slug,
      status,
      duration: (Date.now() - startedAt) / 1000,
    });
    // Serverless functions can freeze once the response is sent; send the check-in first.
    await Sentry.flush(2000).catch(() => false);
  };

  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await finish('error');
    throw error;
  }
  await finish(response.status >= 400 ? 'error' : 'ok');
  return response;
}
