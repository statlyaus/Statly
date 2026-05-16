/**
 * Web vitals metrics writer configuration (env-derived, no I/O).
 * Kept separate from webVitalsPersistence so Vitest can cover it without Firebase.
 */

export function metricsBackend(env: NodeJS.ProcessEnv = process.env): string {
  return (env.METRICS_BACKEND || 'firestore').toLowerCase();
}

/** Default batch size: larger for ClickHouse to limit tiny parts; override with METRICS_BATCH_SIZE. */
export function defaultMetricsBatchSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.METRICS_BATCH_SIZE;
  if (raw !== undefined && raw !== '') {
    return Number(raw);
  }
  return metricsBackend(env) === 'clickhouse' ? 5000 : 50;
}

/**
 * Session settings for the ClickHouse client. Async insert buffers small flushes server-side
 * (per insert-async-small-batches) with durability wait (per same rule, wait_for_async_insert=1).
 */
export function buildClickHouseSessionSettings(
  timeZone: string,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | number | boolean> {
  const settings: Record<string, string | number | boolean> = {
    session_timezone: timeZone,
    async_insert: 1,
    wait_for_async_insert: 1,
  };
  const maxData = env.CLICKHOUSE_ASYNC_INSERT_MAX_DATA_SIZE;
  if (maxData !== undefined && maxData !== '') {
    const n = Number(maxData);
    if (Number.isFinite(n) && n > 0) {
      settings.async_insert_max_data_size = n;
    }
  }
  const busyMs = env.CLICKHOUSE_ASYNC_INSERT_BUSY_TIMEOUT_MS;
  if (busyMs !== undefined && busyMs !== '') {
    const n = Number(busyMs);
    if (Number.isFinite(n) && n > 0) {
      settings.async_insert_busy_timeout_ms = n;
    }
  }
  return settings;
}
