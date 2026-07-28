import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('logger transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'debug');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('writes structured records without starting a timer or network transport', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const interval = vi.spyOn(globalThis, 'setInterval');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { logger } = await import('@/lib/logger');
    logger.info('Draft ready', { draftId: 'draft-1' });

    expect(interval).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
      level: 'info',
      message: 'Draft ready',
      context: { draftId: 'draft-1' },
    });
  });

  it('retains only the newest 100 entries for local inspection', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { logger } = await import('@/lib/logger');

    for (let index = 0; index < 105; index += 1) {
      logger.info(`entry-${index}`);
    }

    const logs = logger.getLogs();
    expect(logs).toHaveLength(100);
    expect(logs[0].message).toBe('entry-5');
    expect(logs[99].message).toBe('entry-104');
  });

  it('does not contain the removed custom transport or misspelled flush API', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/logger.ts'), 'utf8');

    expect(source).not.toContain('/api/logs');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('flushLogs');
    expect(source).not.toContain('forceFLush');
    expect(source).toContain('JSON.stringify(entry)');
  });
});
