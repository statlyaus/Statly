import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
  createLocalAflTradePublicReadEnvironment,
} from '@/server/aflTradeIntelligence/development/localOutcomesRuntime';
import { createLocalAflTradeArchiveFixture } from '@/server/aflTradeIntelligence/development/localSourceArchiveFixture';
import { parseAflTradePublicReadConfig } from '@/server/aflTradeIntelligence/runtime/publicReadConfig';

describe('local AFL trade outcomes runtime', () => {
  it('builds an explicit test-fixture PostgreSQL public-read configuration', () => {
    const environment = createLocalAflTradePublicReadEnvironment({
      artifactRootDirectory: '/tmp/statly-local-afl-trade-artifacts',
    });
    const config = parseAflTradePublicReadConfig(environment);

    expect(config).toMatchObject({
      mode: 'postgres',
      environment: 'test_fixture',
      databaseUrl: AFL_TRADE_LOCAL_OUTCOMES_DATABASE_URL,
      artifactStorage: {
        kind: 'local_filesystem',
        rootDirectory: '/tmp/statly-local-afl-trade-artifacts',
      },
    });
    expect(environment).not.toHaveProperty('AFL_TRADE_WORKBOOK_PATH');
    expect(environment).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS');
    expect(environment).not.toHaveProperty('AFL_TRADE_OBJECT_BUCKET');
    expect(environment).not.toHaveProperty('AFL_TRADE_OBJECT_KMS_KEY_ID');
    expect(environment).not.toHaveProperty('AWS_REGION');
  });

  it('provides 783 deterministic local trades across 1988-2025 without workbook data', () => {
    const fixture = createLocalAflTradeArchiveFixture();

    expect(fixture.environment).toBe('test_fixture');
    expect(fixture.provider).toBe('statly_local_fixture');
    expect(fixture.trades).toHaveLength(783);
    expect(
      [...new Set(fixture.trades.map(({ seasonYear }) => seasonYear))].sort((a, b) => a - b)
    ).toEqual(Array.from({ length: 38 }, (_, index) => 1988 + index));
    expect(fixture.trades).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-trade-2025-gws-western-bulldogs',
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
        expect.objectContaining({
          id: 'local-synthetic-trade-1988-001',
          seasonYear: 1988,
          title: 'Synthetic local trade 1988-001',
          assets: [
            expect.objectContaining({
              kind: 'player',
              selectedPlayer: 'Synthetic Player 1988-001',
            }),
          ],
        }),
      ])
    );
    expect(new Set(fixture.trades.map(({ id }) => id)).size).toBe(783);
    expect(
      fixture.trades.filter(({ title }) => title.startsWith('Synthetic local trade'))
    ).toHaveLength(782);
    expect(JSON.stringify(fixture)).not.toMatch(
      /draftguru|official_afl|workbook|legacy expected|legacy actual/i
    );
  });
});
