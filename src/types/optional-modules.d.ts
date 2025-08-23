// Ambient module declarations for optional runtime dependencies used behind feature flags.
declare module 'pg' {
  export class Pool {
    constructor(options?: unknown);
    query(text: string, params?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }
}

declare module '@clickhouse/client' {
  export type ClickHouseInsertParams = { table: string; values: unknown[] | unknown; format?: string };
  export type ClickHouseClient = { insert(args: ClickHouseInsertParams): Promise<unknown> };
  export function createClient(config: { host: string; username?: string; password?: string }): ClickHouseClient;
}
