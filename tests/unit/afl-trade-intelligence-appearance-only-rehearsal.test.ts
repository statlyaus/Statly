import {
  prepareLocalAflTradeFitzRoyAppearanceEvidence,
  prepareLocalAflTradeFitzRoyMatchEvidence,
} from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

it.each([prepareLocalAflTradeFitzRoyAppearanceEvidence, prepareLocalAflTradeFitzRoyMatchEvidence])(
  'refuses source fixture work outside the named disposable database before writes',
  async (prepare) => {
    const statements: string[] = [];
    const client: AflOutcomeSqlClient = {
      async query<Row>(sql: string) {
        statements.push(sql);
        return {
          rows: [{ database_name: 'shared_database', schema_name: 'public' }] as Row[],
          rowCount: 1,
        };
      },
      async transaction() {
        throw new Error('No write transaction is permitted.');
      },
    };
    await expect(prepare(client)).rejects.toThrow(/named disposable/);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^SELECT/);
  }
);
