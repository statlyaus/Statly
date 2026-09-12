import { describe, expect, it, vi } from 'vitest';

import { inspectLocalAflPrivateValuationCommand } from '../../Scripts/dev/inspect-local-afl-private-valuation';

const nonce = 'a'.repeat(64);
const env = {
  AFL_OUTCOMES_DATABASE_URL: 'postgresql://localhost/statly_outcomes_test',
  STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: nonce,
};

describe('populated local valuation inventory command', () => {
  it.each([
    'postgresql://localhost/production',
    'postgresql://remote.example/statly_outcomes_test',
    'postgresql://localhost/statly_outcomes_test?host=remote.example',
    'postgresql://localhost/statly_outcomes_test?options=-c%20default_transaction_read_only=off',
  ])('rejects an unapproved connection before opening a pool: %s', async (databaseUrl) => {
    const createPool = vi.fn();
    await expect(
      inspectLocalAflPrivateValuationCommand({
        env: { AFL_OUTCOMES_DATABASE_URL: databaseUrl, STATLY_LOCAL_OUTCOMES_RUNTIME_NONCE: nonce },
        createPool,
      })
    ).rejects.toThrow('disposable loopback PostgreSQL');
    expect(createPool).not.toHaveBeenCalled();
  });

  it('rejects a different runtime without inventory output and closes the connection', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT runtime_nonce') ? [{ runtime_nonce: 'b'.repeat(64) }] : [],
    }));
    const end = vi.fn(async () => undefined);
    const writeOutput = vi.fn();
    await expect(
      inspectLocalAflPrivateValuationCommand({
        env,
        writeOutput,
        createPool: () => ({ query, end }),
      })
    ).rejects.toThrow('does not belong to this local stack');
    expect(writeOutput).not.toHaveBeenCalled();
    expect(query.mock.calls.map(([sql]) => sql)).not.toContainEqual(
      expect.stringContaining('WITH factual')
    );
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(end).toHaveBeenCalledOnce();
  });

  it('reports retained state as inventory only in a read-only snapshot', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT runtime_nonce')
        ? [{ runtime_nonce: nonce }]
        : sql.startsWith('WITH factual')
          ? [
              {
                private_factual_present: true,
                private_factual_revision: 2,
                qualified_model_present: false,
                qualified_model_revision: null,
                prepared_v3_present: false,
                prepared_v3_revision: null,
                private_batch_present: false,
                private_batch_revision: null,
                trade_count: null,
                ready_count: null,
                unavailable_count: null,
                cohort_admission_count: 1,
                cohort_trade_count: 783,
                current_registered_acquisition_spell_count: 296,
                finalized_hpn_input_set_count: 0,
                finalized_hpn_calculation_count: 0,
                max_finalized_hpn_corroborating_player_row_count: 0,
              },
            ]
          : [],
    }));
    const end = vi.fn(async () => undefined);
    const createPool = vi.fn(() => ({ query, end }));
    const writeOutput = vi.fn();
    const report = await inspectLocalAflPrivateValuationCommand({ env, createPool, writeOutput });
    expect(report).toMatchObject({
      purpose: 'existing_database_inventory',
      rehearsalExecuted: false,
      inventory: {
        state: 'blocked',
        authorityAssessment: 'inventory_only',
        publicationEligible: false,
        sourceAuthority: {
          genuineDraftTrade: 'not_inspected',
          genuineHpnCorroboration: 'not_inspected',
        },
        retainedSourceInventory: { cohortCandidates: { admissionCount: 1, tradeCount: 783 } },
      },
    });
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 1,
        options: '-c default_transaction_read_only=on -c statement_timeout=30000',
      })
    );
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(writeOutput).toHaveBeenCalledWith(JSON.stringify(report));
    expect(writeOutput.mock.calls[0]?.[0]).not.toContain(nonce);
    expect(end).toHaveBeenCalledOnce();

    writeOutput.mockClear();
    end.mockRejectedValueOnce(new Error('Connection shutdown failed.'));
    await expect(
      inspectLocalAflPrivateValuationCommand({ env, createPool, writeOutput })
    ).rejects.toThrow('Connection shutdown failed.');
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
