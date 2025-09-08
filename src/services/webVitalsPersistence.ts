import { logger } from '@/lib/logger';
import { adminDb } from '@/lib/firebaseAdmin';

// Lightweight interfaces to avoid explicit any and to support optional deps
type BulkWriterLike = { create: (ref: unknown, data: unknown) => void; close: () => Promise<void> };
type PgPoolLike = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type ClickHouseClientLike = {
  insert: (args: {
    table: string;
    values: unknown[] | unknown;
    format?: string;
  }) => Promise<unknown>;
};

export type WebVitalRecord = {
  name: 'CLS' | 'FID' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta?: number;
  id: string;
  navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  sessionId: string;
  timestamp: number; // epoch ms
  url: string; // sanitized origin + pathname
  userAgent: string;
};

export interface WebVitalsWriter {
  write: (record: WebVitalRecord) => Promise<void>;
  writeMany?: (records: WebVitalRecord[]) => Promise<void>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Type guard for Firestore BulkWriter support
function supportsBulkWriter(db: unknown): db is { bulkWriter: () => BulkWriterLike } {
  if (typeof db !== 'object' || db === null) return false;
  const maybe = db as { bulkWriter?: unknown };
  return typeof maybe.bulkWriter === 'function';
}

// Format Date to ClickHouse-friendly local time string without timezone suffix.
// Requires ClickHouse column to be DateTime/DateTime64 with the same timezone to avoid misinterpretation.
const CLICKHOUSE_TZ = process.env.CLICKHOUSE_TZ || 'Australia/Sydney';
function formatClickHouseLocalDateTime(ms: number, timeZone: string = CLICKHOUSE_TZ): string {
  const d = new Date(ms);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const msPart = String(ms % 1000).padStart(3, '0');
  // YYYY-MM-DD HH:mm:ss.mmm (no timezone)
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${msPart}`;
}

function createFirestoreWriter(): WebVitalsWriter {
  const collectionName = process.env.METRICS_COLLECTION || 'analytics_web_vitals';

  async function write(record: WebVitalRecord) {
    const day = new Date(record.timestamp).toISOString().slice(0, 10); // YYYY-MM-DD
    await adminDb.collection(collectionName).add({
      ...record,
      day,
      createdAt: new Date(),
    });
  }

  return {
    async write(record: WebVitalRecord) {
      // Simple retry with exponential backoff
      let attempt = 0;
      const maxAttempts = Number(process.env.METRICS_WRITE_RETRIES || 3);
      let lastErr: unknown;
      while (attempt < maxAttempts) {
        try {
          await write(record);
          return;
        } catch (err) {
          lastErr = err;
          attempt += 1;
          const backoff = Math.min(2000, 100 * 2 ** attempt);
          logger.warn('Firestore write failed, retrying', {
            attempt,
            backoff,
            error: err instanceof Error ? err.message : String(err),
          });
          await sleep(backoff);
        }
      }
      logger.error('Firestore write failed after retries', {
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
    async writeMany(records: WebVitalRecord[]) {
      if (records.length === 0) return;
      // If BulkWriter is available, use it; otherwise parallel writes
      const bulkWriter = supportsBulkWriter(adminDb) ? adminDb.bulkWriter() : null;
      if (bulkWriter) {
        for (const r of records) {
          const day = new Date(r.timestamp).toISOString().slice(0, 10);
          const ref = adminDb.collection(collectionName).doc();
          bulkWriter.create(ref, { ...r, day, createdAt: new Date() });
        }
        await bulkWriter.close();
        return;
      }
      await Promise.all(records.map((r) => write(r)));
    },
  };
}

function createTimescaleWriter(): WebVitalsWriter {
  let pool: PgPoolLike | undefined; // lazy
  const init = async () => {
    if (!pool) {
      const pgModuleName = 'pg';
      const mod = (await import(pgModuleName)) as unknown as {
        Pool: new (opts?: unknown) => PgPoolLike;
      };
      const { Pool } = mod;
      pool = new Pool({
        connectionString: process.env.TIMESCALE_URL || process.env.DATABASE_URL,
        max: Number(process.env.TIMESCALE_POOL_MAX || 10),
      });
    }
    return pool;
  };

  const singleSql =
    'INSERT INTO web_vitals (ts, name, value, rating, delta, id, nav_type, url, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)';

  return {
    async write(record: WebVitalRecord) {
      const p = await init();
      await p.query(singleSql, [
        new Date(record.timestamp),
        record.name,
        record.value,
        record.rating,
        record.delta ?? null,
        record.id,
        record.navigationType ?? null,
        record.url,
        record.userAgent,
      ]);
    },
    async writeMany(records: WebVitalRecord[]) {
      if (records.length === 0) return;
      const p = await init();
      const cols = [
        'ts',
        'name',
        'value',
        'rating',
        'delta',
        'id',
        'nav_type',
        'url',
        'user_agent',
      ];
      const values: unknown[] = [];
      const placeholders: string[] = [];
      records.forEach((r, i) => {
        const base = i * cols.length;
        placeholders.push(
          `(${Array.from({ length: cols.length }, (_, j) => `$${base + j + 1}`).join(',')})`
        );
        values.push(
          new Date(r.timestamp),
          r.name,
          r.value,
          r.rating,
          r.delta ?? null,
          r.id,
          r.navigationType ?? null,
          r.url,
          r.userAgent
        );
      });
      const sql = `INSERT INTO web_vitals (${cols.join(',')}) VALUES ${placeholders.join(',')}`;
      await p.query(sql, values);
    },
  };
}

function createClickHouseWriter(): WebVitalsWriter {
  let client: ClickHouseClientLike | undefined;
  const init = async () => {
    if (!client) {
      const clickhouseModuleName = '@clickhouse/client';
      const mod = (await import(clickhouseModuleName)) as unknown as {
        createClient: (cfg: {
          host: string;
          username?: string;
          password?: string;
          clickhouse_settings?: Record<string, string | number | boolean>;
        }) => ClickHouseClientLike;
      };
      client = mod.createClient({
        host: process.env.CLICKHOUSE_HOST!,
        username: process.env.CLICKHOUSE_USER || 'default',
        password: process.env.CLICKHOUSE_PASSWORD || '',
        clickhouse_settings: { session_timezone: CLICKHOUSE_TZ },
      });
    }
    return client;
  };

  return {
    async write(record: WebVitalRecord) {
      const ch = await init();
      await ch.insert({
        table: 'web_vitals',
        values: [
          {
            // Store local Australia/Sydney wall time; ensure ClickHouse column timezone matches CLICKHOUSE_TZ
            ts: formatClickHouseLocalDateTime(record.timestamp),
            name: record.name,
            value: record.value,
            rating: record.rating,
            delta: record.delta ?? null,
            id: record.id,
            nav_type: record.navigationType ?? null,
            url: record.url,
            user_agent: record.userAgent,
          },
        ],
        format: 'JSONEachRow',
      });
    },
    async writeMany(records: WebVitalRecord[]) {
      if (records.length === 0) return;
      const ch = await init();
      const values = records.map((r) => ({
        // Store local Australia/Sydney wall time; ensure ClickHouse column timezone matches CLICKHOUSE_TZ
        ts: formatClickHouseLocalDateTime(r.timestamp),
        name: r.name,
        value: r.value,
        rating: r.rating,
        delta: r.delta ?? null,
        id: r.id,
        nav_type: r.navigationType ?? null,
        url: r.url,
        user_agent: r.userAgent,
      }));
      await ch.insert({ table: 'web_vitals', values, format: 'JSONEachRow' });
    },
  };
}

export function getWebVitalsWriter(): WebVitalsWriter {
  const backend = (process.env.METRICS_BACKEND || 'firestore').toLowerCase();
  try {
    if (backend === 'timescale' || backend === 'timescaledb' || backend === 'postgres') {
      return createTimescaleWriter();
    }
    if (backend === 'clickhouse') {
      return createClickHouseWriter();
    }
    return createFirestoreWriter();
  } catch (err) {
    logger.error('Falling back to Firestore web-vitals writer', {
      backend,
      error: err instanceof Error ? err.message : String(err),
    });
    return createFirestoreWriter();
  }
}

export interface WebVitalsBatcher {
  add: (record: WebVitalRecord) => Promise<void>;
  flush: () => Promise<void>;
}

export function createWebVitalsBatcher(writer: WebVitalsWriter): WebVitalsBatcher {
  const batchSize = Number(process.env.METRICS_BATCH_SIZE || 50);
  const intervalMs = Number(process.env.METRICS_BATCH_INTERVAL_MS || 1000);
  const buffer: WebVitalRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let flushing = false;

  async function doFlush() {
    if (flushing) return;
    if (buffer.length === 0) return;
    flushing = true;
    const toWrite = buffer.splice(0, buffer.length);

    const writeBatch = async (records: WebVitalRecord[]) => {
      if (writer.writeMany) {
        await writer.writeMany(records);
      } else {
        await Promise.all(records.map((r) => writer.write(r)));
      }
    };

    try {
      await writeBatch(toWrite);
    } catch (err) {
      logger.error('Batch write failed', {
        error: err instanceof Error ? err.message : String(err),
        size: toWrite.length,
      });

      const maxRetries = Number(process.env.METRICS_BATCH_RETRIES ?? 3);
      const baseDelay = Number(process.env.METRICS_BATCH_RETRY_BASE_MS ?? 150);
      let success = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const backoff = Math.min(5000, baseDelay * 2 ** (attempt - 1));
        const jitter = Math.floor(Math.random() * 100);
        logger.warn('Retrying batch write', { attempt, backoff, jitter, size: toWrite.length });
        await sleep(backoff + jitter);
        try {
          await writeBatch(toWrite);
          success = true;
          break;
        } catch (err2) {
          logger.warn('Batch write retry failed', {
            attempt,
            error: err2 instanceof Error ? err2.message : String(err2),
          });
        }
      }

      if (!success) {
        logger.error('Batch write failed after retries; data may be lost', {
          attempts: maxRetries,
          size: toWrite.length,
        });
      }
    } finally {
      flushing = false;
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void doFlush();
    }, intervalMs);
  }

  return {
    async add(record: WebVitalRecord) {
      buffer.push(record);
      if (buffer.length >= batchSize) {
        await doFlush();
      } else {
        schedule();
      }
    },
    async flush() {
      await doFlush();
    },
  };
}
