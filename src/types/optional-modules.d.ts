// Ambient module declarations for optional runtime dependencies used behind feature flags.
declare module 'pg' {
  export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
    rows: Row[];
    rowCount: number | null;
  }

  export interface PoolClient {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[]
    ): Promise<QueryResult<Row>>;
    release(): void;
  }

  export class Pool {
    constructor(options?: unknown);
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[]
    ): Promise<QueryResult<Row>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}

declare module '@clickhouse/client' {
  export type ClickHouseInsertParams = {
    table: string;
    values: unknown[] | unknown;
    format?: string;
  };
  export type ClickHouseClient = { insert(args: ClickHouseInsertParams): Promise<unknown> };
  export function createClient(config: {
    host: string;
    username?: string;
    password?: string;
  }): ClickHouseClient;
}
