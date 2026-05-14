import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDuckDbMotherDuckRunner } from '../../../Scripts/warehouse/duckDbMotherDuckRunner';

const duckDbMock = vi.hoisted(() => ({
  closeConnectionError: null as Error | null,
  closeDatabaseError: null as Error | null,
  connectError: null as Error | null,
  closedConnections: 0,
  closedDatabases: 0,
  databaseUrls: [] as string[],
  statements: [] as string[],
}));

vi.mock('duckdb', () => ({
  Database: class {
    constructor(path: string) {
      duckDbMock.databaseUrls.push(path);
    }

    connect() {
      if (duckDbMock.connectError) {
        throw duckDbMock.connectError;
      }

      return {
        all: (
          sql: string,
          callback: (error: Error | null, rows: Record<string, unknown>[]) => void
        ) => {
          duckDbMock.statements.push(sql);
          callback(null, [{ ok: true }]);
        },
        close: (callback: (error: Error | null) => void) => {
          duckDbMock.closedConnections += 1;
          callback(duckDbMock.closeConnectionError);
        },
      };
    }

    close(callback: (error: Error | null) => void) {
      duckDbMock.closedDatabases += 1;
      callback(duckDbMock.closeDatabaseError);
    }
  },
}));

describe('createDuckDbMotherDuckRunner', () => {
  beforeEach(() => {
    duckDbMock.closeConnectionError = null;
    duckDbMock.closeDatabaseError = null;
    duckDbMock.connectError = null;
    duckDbMock.closedConnections = 0;
    duckDbMock.closedDatabases = 0;
    duckDbMock.databaseUrls = [];
    duckDbMock.statements = [];
  });

  it('adds the escaped token to the database URL before opening DuckDB', async () => {
    const runner = await createDuckDbMotherDuckRunner({
      databaseUrl: 'md:statly?custom=1',
      token: "tok'en & /?",
    });

    await runner.query('SELECT 1 AS ok');
    await runner.close();

    expect(duckDbMock.databaseUrls).toEqual([
      'md:statly?custom=1&motherduck_token=tok%27en+%26+%2F%3F',
    ]);
    expect(duckDbMock.statements).toEqual(['SELECT 1 AS ok']);
  });

  it('closes the database best-effort when setup fails after Database construction', async () => {
    duckDbMock.connectError = new Error('connect failed');

    await expect(
      createDuckDbMotherDuckRunner({ databaseUrl: 'md:', token: 'token' })
    ).rejects.toThrow('connect failed');

    expect(duckDbMock.closedConnections).toBe(0);
    expect(duckDbMock.closedDatabases).toBe(1);
  });

  it('attempts to close the database even when connection close fails', async () => {
    duckDbMock.closeConnectionError = new Error('connection close failed');
    const runner = await createDuckDbMotherDuckRunner({ databaseUrl: 'md:' });

    await expect(runner.close()).rejects.toThrow('connection close failed');

    expect(duckDbMock.closedConnections).toBe(1);
    expect(duckDbMock.closedDatabases).toBe(1);
  });
});
