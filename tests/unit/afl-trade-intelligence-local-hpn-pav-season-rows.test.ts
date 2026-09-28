import { describe, expect, it } from 'vitest';

import {
  loadLocalHpnPavSeasonRows,
  type LocalHpnPavQueryClient,
} from '@/server/aflTradeIntelligence/development/localHpnPavSeasonRows';

function client(runs: string[]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const fake: LocalHpnPavQueryClient = {
    async query<Row extends Record<string, unknown>>(sql: string, params: readonly unknown[]) {
      calls.push({ sql, params });
      if (sql.includes('outcome_provider_normalization_run')) {
        return { rows: runs.map((id) => ({ normalization_run_id: id })) as unknown as Row[] };
      }
      return { rows: [{ nativeEntityId: '1', player: 'A' }] as unknown as Row[] };
    },
  };
  return { fake, calls };
}

describe('loadLocalHpnPavSeasonRows', () => {
  it('reads every row of the latest finalized run when no run is named', async () => {
    const { fake, calls } = client(['run:latest']);
    const result = await loadLocalHpnPavSeasonRows(fake, { season: 2025, captureId: 'capture:1' });

    expect(result.normalizationRunId).toBe('run:latest');
    expect(calls[0]!.sql).toMatch(/finalized_at IS NOT NULL[\s\S]*ORDER BY finalized_at DESC/);
    expect(calls[0]!.params).toEqual(['capture:1', null]);
    expect(calls[1]!.params).toEqual([2025, 'capture:1', 'run:latest']);
    // Review status never filters the run's rows.
    expect(calls[1]!.sql).not.toMatch(/row_status/);
  });

  it('passes a named run through and fails closed when no finalized run matches', async () => {
    const named = client(['run:named']);
    await loadLocalHpnPavSeasonRows(named.fake, {
      season: 2025,
      captureId: 'capture:1',
      normalizationRunId: 'run:named',
    });
    expect(named.calls[0]!.params).toEqual(['capture:1', 'run:named']);

    await expect(
      loadLocalHpnPavSeasonRows(client([]).fake, { season: 2025, captureId: 'capture:1' })
    ).rejects.toThrow(/No finalized normalization run/);
  });
});
