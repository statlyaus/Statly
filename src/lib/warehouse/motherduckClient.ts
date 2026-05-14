import {
  buildCreateWarehouseSchemaSql,
  buildMergeCanonicalPlayerMatchesSql,
  buildRequiredColumnValidationSql,
} from './motherduckSql';

export type WarehouseQueryRunner = {
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
};

export type MotherDuckClient = {
  ensureSchema(): Promise<void>;
  validateRequiredColumns(
    tableName: string,
    requiredColumns: string[]
  ): Promise<void>;
  mergeCanonicalPlayerMatches(stagingTableName: string): Promise<void>;
};

export function createMotherDuckClient(params: {
  runner: WarehouseQueryRunner;
  schemaName: string;
}): MotherDuckClient {
  return {
    async ensureSchema() {
      await params.runner.query(
        buildCreateWarehouseSchemaSql({ schemaName: params.schemaName })
      );
    },
    async validateRequiredColumns(tableName, requiredColumns) {
      const missing = await params.runner.query<{ column_name: string }>(
        buildRequiredColumnValidationSql({
          schemaName: params.schemaName,
          tableName,
          requiredColumns,
        })
      );

      if (missing.length > 0) {
        throw new Error(
          `MotherDuck table ${params.schemaName}.${tableName} is missing columns: ${missing
            .map((row) => row.column_name)
            .join(', ')}`
        );
      }
    },
    async mergeCanonicalPlayerMatches(stagingTableName) {
      await params.runner.query(
        buildMergeCanonicalPlayerMatchesSql({
          schemaName: params.schemaName,
          stagingTableName,
        })
      );
    },
  };
}
