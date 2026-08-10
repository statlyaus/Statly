import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
  createLocalAflTradePublicReadEnvironment,
} from '@/server/aflTradeIntelligence/development/localOutcomesRuntime';
import { createLocalAflTradeArchiveFixture } from '@/server/aflTradeIntelligence/development/localSourceArchiveFixture';
import { parseAflTradePublicReadConfig } from '@/server/aflTradeIntelligence/runtime/publicReadConfig';

describe('local AFL trade outcomes runtime', () => {
  it('builds an explicit test-fixture PostgreSQL public-read configuration', () => {
    const environment = createLocalAflTradePublicReadEnvironment();
    const config = parseAflTradePublicReadConfig(environment);

    expect(config).toMatchObject({
      mode: 'postgres',
      environment: 'test_fixture',
      databaseUrl: AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
      objectStorage: {
        bucket: 'statly-local-afl-trade-projections',
        keyPrefix: 'test-fixture',
        repositoryId: 'statly-local-afl-trade-projections',
      },
    });
    expect(environment).not.toHaveProperty('AFL_TRADE_WORKBOOK_PATH');
    expect(environment).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
  });

  it('provides source-native trades, exercised selections, and future picks without workbook data', () => {
    const fixture = createLocalAflTradeArchiveFixture();

    expect(fixture.environment).toBe('test_fixture');
    expect(fixture.provider).toBe('draftguru');
    expect(fixture.trades).toEqual([
      expect.objectContaining({
        seasonYear: 2025,
        parties: ['gws', 'western-bulldogs'],
        assets: expect.arrayContaining([
          expect.objectContaining({
            kind: 'current_pick',
            nominalPick: 14,
            selectionNumber: 14,
            selectedPlayer: 'Harry Kyle',
          }),
          expect.objectContaining({
            kind: 'future_pick',
            draftSeasonYear: 2026,
            nominalRound: 2,
          }),
        ]),
      }),
    ]);
    expect(JSON.stringify(fixture)).not.toMatch(/workbook|legacy expected|legacy actual/i);
  });
});
