import {
  CANONICAL_STAT_KEYS,
  type CanonicalStatKey,
} from '@/lib/stats/statColumns';

export type WarehouseSqlParams = {
  schemaName: string;
};

export type RequiredColumnValidationSqlParams = WarehouseSqlParams & {
  tableName: string;
  requiredColumns: string[];
};

export type MergeCanonicalPlayerMatchesSqlParams = WarehouseSqlParams & {
  stagingTableName: string;
};

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type ColumnMapping = {
  sourceColumn: string;
  targetColumn: string;
};

const CANONICAL_PLAYER_MATCH_SCALAR_COLUMN_MAPPINGS: ColumnMapping[] = [
  { sourceColumn: 'firestoreDocId', targetColumn: 'firestore_doc_id' },
  { sourceColumn: 'contractVersion', targetColumn: 'contract_version' },
  { sourceColumn: 'matchId', targetColumn: 'match_id' },
  { sourceColumn: 'playerId', targetColumn: 'player_id' },
  { sourceColumn: 'season', targetColumn: 'season' },
  { sourceColumn: 'roundNumber', targetColumn: 'round_number' },
  { sourceColumn: 'playerName', targetColumn: 'player_name' },
  { sourceColumn: 'playerClub', targetColumn: 'player_club' },
  { sourceColumn: 'opponent', targetColumn: 'opponent' },
  { sourceColumn: 'matchDate', targetColumn: 'match_date' },
  { sourceColumn: 'startTimeUtc', targetColumn: 'start_time_utc' },
  { sourceColumn: 'venue', targetColumn: 'venue' },
  { sourceColumn: 'matchStatus', targetColumn: 'match_status' },
  { sourceColumn: 'dataSource', targetColumn: 'data_source' },
  { sourceColumn: 'rawChecksum', targetColumn: 'raw_checksum' },
  { sourceColumn: 'statsJson', targetColumn: 'stats_json' },
  { sourceColumn: 'availabilityJson', targetColumn: 'availability_json' },
  { sourceColumn: 'provenanceJson', targetColumn: 'provenance_json' },
] as const;

function assertSafeIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return identifier;
}

function toSnakeCase(key: CanonicalStatKey): string {
  return key
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/([a-z])([0-9])/g, '$1_$2');
}

function buildCanonicalStatColumnMappings(): ColumnMapping[] {
  return CANONICAL_STAT_KEYS.flatMap((key) => {
    const targetColumn = toSnakeCase(key);

    return [
      { sourceColumn: key, targetColumn },
      {
        sourceColumn: `${key}Present`,
        targetColumn: `${targetColumn}_present`,
      },
      {
        sourceColumn: `${key}Provenance`,
        targetColumn: `${targetColumn}_provenance`,
      },
    ];
  });
}

function buildCanonicalStatColumnDefinitions(): string[] {
  return CANONICAL_STAT_KEYS.flatMap((key) => {
    const columnName = toSnakeCase(key);

    return [
      `${columnName} DOUBLE NOT NULL`,
      `${columnName}_present BOOLEAN NOT NULL`,
      `${columnName}_provenance VARCHAR`,
    ];
  });
}

function buildCanonicalPlayerMatchColumnDefinitions(): string[] {
  return [
    'firestore_doc_id VARCHAR NOT NULL',
    'contract_version INTEGER NOT NULL',
    'match_id VARCHAR NOT NULL',
    'player_id VARCHAR NOT NULL',
    'season INTEGER NOT NULL',
    'round_number INTEGER NOT NULL',
    'player_name VARCHAR NOT NULL',
    'player_club VARCHAR NOT NULL',
    'opponent VARCHAR NOT NULL',
    'match_date VARCHAR NOT NULL',
    'start_time_utc VARCHAR',
    'venue VARCHAR',
    'match_status VARCHAR',
    'data_source VARCHAR',
    'raw_checksum VARCHAR',
    'stats_json JSON NOT NULL',
    'availability_json JSON NOT NULL',
    'provenance_json JSON NOT NULL',
    ...buildCanonicalStatColumnDefinitions(),
    'load_id VARCHAR',
    'loaded_at TIMESTAMP NOT NULL DEFAULT now()',
    'PRIMARY KEY (firestore_doc_id)',
  ];
}

function buildCanonicalPlayerMatchColumnNames(): string[] {
  return [
    ...buildCanonicalPlayerMatchColumnMappings().map(
      (mapping) => mapping.targetColumn
    ),
    'load_id',
    'loaded_at',
  ];
}

export const CANONICAL_PLAYER_MATCH_WAREHOUSE_COLUMNS =
  buildCanonicalPlayerMatchColumnNames();

function buildCanonicalPlayerMatchColumnMappings(): ColumnMapping[] {
  return [
    ...CANONICAL_PLAYER_MATCH_SCALAR_COLUMN_MAPPINGS,
    ...buildCanonicalStatColumnMappings(),
  ];
}

function buildStagingProjectionSql(): string {
  const aliasedColumns = buildCanonicalPlayerMatchColumnMappings().map(
    ({ sourceColumn, targetColumn }) =>
      sourceColumn === targetColumn
        ? `    ${sourceColumn}`
        : `    ${sourceColumn} AS ${targetColumn}`
  );

  return [
    ...aliasedColumns,
    '    CAST(NULL AS VARCHAR) AS load_id',
    '    now() AS loaded_at',
  ].join(',\n');
}

export function buildCreateWarehouseSchemaSql(
  params: WarehouseSqlParams
): string {
  const schemaName = assertSafeIdentifier(params.schemaName);
  const canonicalPlayerMatchColumns =
    buildCanonicalPlayerMatchColumnDefinitions()
      .map((column) => `  ${column}`)
      .join(',\n');

  return `CREATE SCHEMA IF NOT EXISTS ${schemaName};

CREATE TABLE IF NOT EXISTS ${schemaName}.canonical_player_match (
${canonicalPlayerMatchColumns}
);

CREATE TABLE IF NOT EXISTS ${schemaName}.load_manifest (
  load_id VARCHAR NOT NULL,
  source_system VARCHAR NOT NULL,
  source_collection VARCHAR NOT NULL,
  season INTEGER,
  rounds_json JSON,
  exported_rows BIGINT NOT NULL,
  loaded_rows BIGINT NOT NULL DEFAULT 0,
  rejected_rows BIGINT NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL,
  artifact_path VARCHAR,
  artifact_sha256 VARCHAR,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  error_json JSON,
  PRIMARY KEY (load_id)
);`;
}

export function buildRequiredColumnValidationSql(
  params: RequiredColumnValidationSqlParams
): string {
  const schemaName = assertSafeIdentifier(params.schemaName);
  const tableName = assertSafeIdentifier(params.tableName);
  const requiredColumns = params.requiredColumns.map(assertSafeIdentifier);

  if (requiredColumns.length === 0) {
    throw new Error('At least one required column is required');
  }

  const requiredColumnRows = requiredColumns
    .map((columnName) => `('${columnName}')`)
    .join(', ');

  return `WITH required(column_name) AS (
  VALUES ${requiredColumnRows}
)
SELECT required.column_name
FROM required
LEFT JOIN information_schema.columns actual
  ON actual.table_schema = '${schemaName}'
 AND actual.table_name = '${tableName}'
 AND actual.column_name = required.column_name
WHERE actual.column_name IS NULL
ORDER BY required.column_name;`;
}

export function buildMergeCanonicalPlayerMatchesSql(
  params: MergeCanonicalPlayerMatchesSqlParams
): string {
  const schemaName = assertSafeIdentifier(params.schemaName);
  const stagingTableName = assertSafeIdentifier(params.stagingTableName);
  const updateAssignments = buildCanonicalPlayerMatchColumnNames()
    .filter((columnName) => columnName !== 'firestore_doc_id')
    .map((columnName) =>
      columnName === 'loaded_at'
        ? '  loaded_at = now()'
        : `  ${columnName} = source.${columnName}`
    )
    .join(',\n');

  return `MERGE INTO ${schemaName}.canonical_player_match AS target
USING (
  SELECT
${buildStagingProjectionSql()}
  FROM ${schemaName}.${stagingTableName}
) AS source
ON target.firestore_doc_id = source.firestore_doc_id
WHEN MATCHED THEN UPDATE SET
${updateAssignments}
WHEN NOT MATCHED THEN INSERT BY NAME;`;
}
