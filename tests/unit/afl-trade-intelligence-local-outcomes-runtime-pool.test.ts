import { describe, expect, it, vi } from 'vitest';

import { createLocalOutcomesRuntimePoolProvider } from '@/server/aflTradeIntelligence/development/localOutcomesRuntimePool';

describe('local outcomes runtime pool provider', () => {
  it('reuses one bounded PostgreSQL pool for the admitted runtime', () => {
    const end = vi.fn().mockResolvedValue(undefined);
    const pool = { end };
    const createPool = vi.fn().mockReturnValue(pool);
    const provider = createLocalOutcomesRuntimePoolProvider(createPool as never);
    const connectionString =
      'postgresql://postgres:postgres@127.0.0.1:32887/statly_outcomes_test';

    expect(provider.get(connectionString)).toBe(pool);
    expect(provider.get(connectionString)).toBe(pool);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({
      allowExitOnIdle: true,
      application_name: 'statly-private-workbook-runtime',
      connectionString,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 30_000,
      max: 4,
    });
    expect(end).not.toHaveBeenCalled();
  });

  it('fails closed if a running process is asked to switch database authority', () => {
    const createPool = vi.fn().mockReturnValue({ end: vi.fn() });
    const provider = createLocalOutcomesRuntimePoolProvider(createPool as never);

    provider.get('postgresql://postgres:postgres@127.0.0.1:32887/statly_outcomes_test');

    expect(() =>
      provider.get('postgresql://postgres:postgres@127.0.0.1:32888/statly_outcomes_test')
    ).toThrow('The admitted local outcomes runtime changed; restart the development server.');
    expect(createPool).toHaveBeenCalledTimes(1);
  });
});
