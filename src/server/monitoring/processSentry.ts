import * as Sentry from '@sentry/nextjs';

import { privateSentryDataCollection } from '@/lib/sentry/dataCollection';

// Sentry for the processes that run outside Next.js: the Socket.IO server and the BullMQ workers
// (see docs/runbooks/monitoring-and-alerts.md). Errors only, with the same private data collection
// as the web app (#1158). Sentry's default Node integrations report uncaught exceptions and unhandled
// rejections, and `logger.error` forwards to Sentry once this has run.

export type MonitoredService = 'socket-server' | 'draft-worker' | 'web-vitals-worker';

export function initProcessSentry(service: MonitoredService): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.SENTRY_DISABLED === 'true') return false;

  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    debug: false,
    dataCollection: privateSentryDataCollection,
    initialScope: { tags: { service } },
  });
  return true;
}

interface FailedJob {
  id?: string | null;
  name?: string;
  attemptsMade?: number;
  data?: unknown;
}

// Job data can hold personal data, so only these ids are read from it, as tags.
const JOB_DATA_TAGS = [
  ['leagueId', 'league_id'],
  ['seasonId', 'season_id'],
  ['draftId', 'draft_id'],
] as const;

export function reportJobFailure(queue: string, job: FailedJob | undefined, error: Error): void {
  Sentry.withScope((scope) => {
    scope.setTag('queue', queue);
    if (job) {
      if (job.name) scope.setTag('job_name', job.name);
      const data = (job.data ?? {}) as Record<string, unknown>;
      for (const [field, tag] of JOB_DATA_TAGS) {
        const value = data[field];
        if (typeof value === 'string' && value) scope.setTag(tag, value);
      }
      scope.setContext('job', { id: job.id ?? null, attemptsMade: job.attemptsMade ?? 0 });
    }
    Sentry.captureException(error);
  });
}

// Gives queued events a moment to send before a crashing process exits.
export async function flushProcessSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.flush(timeoutMs).catch(() => false);
}
