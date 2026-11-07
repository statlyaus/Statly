import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries = vi.hoisted(() => ({ filters: [] as Array<[string, string, unknown]> }));

vi.mock('@/lib/firebaseAdmin', () => {
  const query = {
    where(field: string, op: string, value: unknown) {
      queries.filters.push([field, op, value]);
      return query;
    },
    get: async () => ({ docs: [{ data: () => ({ player_name: 'Test Player', round: 7 }) }] }),
  };
  return { adminDb: { collection: () => query } };
});

import { getRoundPlayerStatsResult } from './etlRoundData';

describe('getRoundPlayerStatsResult', () => {
  beforeEach(() => {
    queries.filters = [];
  });

  it('filters player_match_stats on the round field the ETL writes', async () => {
    const writer = readFileSync(path.join(process.cwd(), 'etl', 'processFootywireData.ts'), 'utf8');
    expect(writer).toContain('round: row.round,');

    const result = await getRoundPlayerStatsResult(2026, 7);

    expect(queries.filters).toEqual([
      ['season', '==', 2026],
      ['round', '==', 7],
    ]);
    expect(result).toEqual({ ok: true, stats: [{ player_name: 'Test Player', round: 7 }] });
  });
});
