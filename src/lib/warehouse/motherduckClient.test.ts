import { describe, expect, it } from 'vitest';

import {
  createMotherDuckClient,
  type WarehouseQueryRunner,
} from './motherduckClient';

describe('createMotherDuckClient', () => {
  it('runs schema setup, validation, and merge statements through the injected runner', async () => {
    const statements: string[] = [];
    const runner: WarehouseQueryRunner = {
      query: async (sql) => {
        statements.push(sql);
        return [];
      },
    };
    const client = createMotherDuckClient({
      runner,
      schemaName: 'statly_warehouse',
    });

    await client.ensureSchema();
    await client.validateRequiredColumns('canonical_player_match', [
      'firestore_doc_id',
    ]);
    await client.mergeCanonicalPlayerMatches('staging_load_1');

    expect(statements[0]).toContain(
      'CREATE SCHEMA IF NOT EXISTS statly_warehouse'
    );
    expect(statements[1]).toContain('information_schema.columns');
    expect(statements[2]).toContain(
      'MERGE INTO statly_warehouse.canonical_player_match'
    );
  });

  it('throws when required column validation returns missing columns', async () => {
    const runner: WarehouseQueryRunner = {
      query: async <T>() => [{ column_name: 'player_id' }] as T[],
    };
    const client = createMotherDuckClient({
      runner,
      schemaName: 'statly_warehouse',
    });

    await expect(
      client.validateRequiredColumns('canonical_player_match', ['player_id'])
    ).rejects.toThrow(
      'MotherDuck table statly_warehouse.canonical_player_match is missing columns: player_id'
    );
  });
});
