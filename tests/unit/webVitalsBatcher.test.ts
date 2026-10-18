import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: {} }));

import {
  createWebVitalsBatcher,
  type WebVitalRecord,
  type WebVitalsWriter,
} from '@/services/webVitalsPersistence';

function record(id: string): WebVitalRecord {
  return {
    name: 'LCP',
    value: 1,
    rating: 'good',
    id,
    sessionId: 'session',
    timestamp: 1,
    url: '/',
    sessionIdHash: 'hash',
  } as WebVitalRecord;
}

describe('web vitals batcher', () => {
  beforeEach(() => {
    vi.stubEnv('METRICS_BATCH_SIZE', '2');
    vi.stubEnv('METRICS_BATCH_INTERVAL_MS', '60000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes records that are still buffered when flush is called', async () => {
    const writer = { writeMany: vi.fn().mockResolvedValue(undefined), write: vi.fn() };
    const batcher = createWebVitalsBatcher(writer as unknown as WebVitalsWriter);

    await batcher.add(record('a'));
    expect(writer.writeMany).not.toHaveBeenCalled();

    await batcher.flush();

    expect(writer.writeMany).toHaveBeenCalledOnce();
    expect(writer.writeMany.mock.calls[0][0].map((r: WebVitalRecord) => r.id)).toEqual(['a']);
  });

  it('waits for a write already in flight and then writes records added during it', async () => {
    const writes: string[][] = [];
    let releaseFirstWrite: () => void = () => {};
    const writer = {
      writeMany: vi.fn((records: WebVitalRecord[]) => {
        writes.push(records.map((r) => r.id));
        if (writes.length === 1) {
          return new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
          });
        }
        return Promise.resolve();
      }),
      write: vi.fn(),
    };
    const batcher = createWebVitalsBatcher(writer as unknown as WebVitalsWriter);

    await batcher.add(record('a'));
    const fullBatch = batcher.add(record('b'));
    await batcher.add(record('c'));
    const flushed = batcher.flush();
    releaseFirstWrite();
    await Promise.all([fullBatch, flushed]);

    expect(writes).toEqual([['a', 'b'], ['c']]);
  });
});
