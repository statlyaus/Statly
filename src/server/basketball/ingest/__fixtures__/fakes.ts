import type { NbaIngestPrisma } from '../nbaIngestRun';
import type { NbaStatsProvider } from '../nbaStatsProvider';

type TransactionHandler = (model: string, method: string, args: never) => unknown;

/**
 * A recording stand-in for the Prisma client in unit tests. `nbaIngestRun` writes are kept in
 * `runs`; every other write is recorded in `forbiddenWrites` and throws, so a test can prove a
 * rejected run wrote nothing but its run row. Reads answer from `reads`, else empty. A transaction
 * throws too, unless `transaction` is given: then each call inside it is recorded in
 * `transactionCalls` and answered by the handler.
 */
export function fakeIngestPrisma(
  reads: Record<string, Record<string, (...args: never[]) => unknown>> = {},
  { transaction }: { transaction?: TransactionHandler } = {}
) {
  const runs: Array<Record<string, unknown>> = [];
  const forbiddenWrites: string[] = [];
  const transactionCalls: Array<{ model: string; method: string; args: unknown }> = [];
  const isWrite = (method: string) =>
    /^(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(method);

  const runModel = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `run-${runs.length + 1}`, ...data };
      runs.push(row);
      return { id: row.id };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = runs.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no run ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    findMany: reads.nbaIngestRun?.findMany ?? (async () => []),
  };

  const transactionClient = new Proxy(
    {},
    {
      get(_target, model) {
        if (typeof model === 'symbol' || model === 'then') return undefined;
        return new Proxy(
          {},
          {
            get(_modelTarget, method) {
              if (typeof method === 'symbol' || method === 'then') return undefined;
              return async (args: never) => {
                transactionCalls.push({ model, method, args });
                return transaction?.(model, method, args);
              };
            },
          }
        );
      },
    }
  );

  const emptyRead = (method: string) => {
    if (method === 'findMany') return [];
    if (method === 'count') return 0;
    if (method === 'aggregate') return { _min: {}, _max: {} };
    return null;
  };

  const prisma = new Proxy(
    {},
    {
      get(_target, model) {
        if (typeof model === 'symbol' || model === 'then') return undefined;
        if (model === 'nbaIngestRun') return runModel;
        if (model === '$transaction') {
          return async (work: (client: unknown) => Promise<unknown>) => {
            if (!transaction) {
              forbiddenWrites.push('$transaction');
              throw new Error('unexpected transaction');
            }
            return work(transactionClient);
          };
        }
        return new Proxy(
          {},
          {
            get(_modelTarget, method) {
              if (typeof method === 'symbol' || method === 'then') return undefined;
              const read = reads[model]?.[method];
              if (read) return read;
              if (isWrite(method)) {
                return async () => {
                  forbiddenWrites.push(`${model}.${method}`);
                  throw new Error(`unexpected write ${model}.${method}`);
                };
              }
              return async () => emptyRead(method);
            },
          }
        );
      },
    }
  );

  return {
    prisma: prisma as unknown as NbaIngestPrisma,
    runs,
    forbiddenWrites,
    transactionCalls,
  };
}

/** A provider whose every method throws unless overridden. */
export function fakeProvider(overrides: Partial<NbaStatsProvider> = {}): NbaStatsProvider {
  const notStubbed = (name: string) => async () => {
    throw new Error(`fake provider: ${name} was not stubbed`);
  };
  return {
    id: 'fake',
    commercialUseLicensed: true,
    fetchTeams: notStubbed('fetchTeams'),
    fetchTeamRoster: notStubbed('fetchTeamRoster'),
    fetchTeamSchedule: notStubbed('fetchTeamSchedule'),
    fetchScoreboard: notStubbed('fetchScoreboard'),
    fetchBoxScore: notStubbed('fetchBoxScore'),
    fetchInjuries: notStubbed('fetchInjuries'),
    fetchSeasonTotals: notStubbed('fetchSeasonTotals'),
    ...overrides,
  };
}
