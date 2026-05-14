import { describe, expect, it } from 'vitest';

import {
  CANONICAL_PLAYER_MATCH_WAREHOUSE_COLUMNS,
  buildCreateWarehouseSchemaSql,
  buildMergeCanonicalPlayerMatchesSql,
  buildRequiredColumnValidationSql,
} from './motherduckSql';

describe('MotherDuck warehouse SQL builders', () => {
  it('creates curated canonical player match and load manifest tables', () => {
    const sql = buildCreateWarehouseSchemaSql({
      schemaName: 'statly_warehouse',
    });

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS statly_warehouse');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS statly_warehouse.canonical_player_match'
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS statly_warehouse.load_manifest'
    );
    expect(sql).toContain('PRIMARY KEY (firestore_doc_id)');
    expect(sql).toContain('disposals DOUBLE');
    expect(sql).toContain('disposals_present BOOLEAN');
    expect(sql).toContain('inside_50s DOUBLE');
    expect(sql).toContain('provenance_json JSON');
  });

  it('merges staging rows by Firestore document id', () => {
    const sql = buildMergeCanonicalPlayerMatchesSql({
      schemaName: 'statly_warehouse',
      stagingTableName: 'staging_canonical_player_match_20260514',
    });

    expect(sql).toContain(
      'MERGE INTO statly_warehouse.canonical_player_match AS target'
    );
    expect(sql).toContain(
      'FROM statly_warehouse.staging_canonical_player_match_20260514'
    );
    expect(sql).toContain('firestoreDocId AS firestore_doc_id');
    expect(sql).toContain('roundNumber AS round_number');
    expect(sql).toContain('statsJson AS stats_json');
    expect(sql).toContain('disposalsPresent AS disposals_present');
    expect(sql).toContain('disposalsProvenance AS disposals_provenance');
    expect(sql).toContain('inside50s AS inside_50s');
    expect(sql).toContain('inside50sPresent AS inside_50s_present');
    expect(sql).toContain(
      'inside50sProvenance AS inside_50s_provenance'
    );
    expect(sql).toContain('CAST(NULL AS VARCHAR) AS load_id');
    expect(sql).toContain(
      'USING ('
    );
    expect(sql).toContain(
      'ON target.firestore_doc_id = source.firestore_doc_id'
    );
    expect(sql).toContain('disposals_present = source.disposals_present');
    expect(sql).toContain('WHEN MATCHED THEN UPDATE');
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
    expect(sql).not.toContain('loadId AS load_id');
    expect(sql).not.toContain('source.loadId');
  });

  it('validates required columns through information_schema', () => {
    const sql = buildRequiredColumnValidationSql({
      schemaName: 'statly_warehouse',
      tableName: 'canonical_player_match',
      requiredColumns: ['firestore_doc_id', 'player_id', 'season'],
    });

    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain("table_schema = 'statly_warehouse'");
    expect(sql).toContain("table_name = 'canonical_player_match'");
    expect(sql).toContain("'firestore_doc_id'");
    expect(sql).toContain("'player_id'");
    expect(sql).toContain("'season'");
  });

  it('exports the full canonical player match warehouse column list', () => {
    expect(CANONICAL_PLAYER_MATCH_WAREHOUSE_COLUMNS).toEqual(
      expect.arrayContaining([
        'contract_version',
        'start_time_utc',
        'inside_50s',
        'inside_50s_present',
        'inside_50s_provenance',
        'load_id',
      ])
    );
  });

  it('rejects unsafe identifiers before interpolating SQL', () => {
    expect(() =>
      buildCreateWarehouseSchemaSql({
        schemaName: 'statly_warehouse; DROP TABLE players',
      })
    ).toThrow('Unsafe SQL identifier');
    expect(() =>
      buildMergeCanonicalPlayerMatchesSql({
        schemaName: 'statly_warehouse',
        stagingTableName: 'staging-canonical-player-match',
      })
    ).toThrow('Unsafe SQL identifier');
  });
});
