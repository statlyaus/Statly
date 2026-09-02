import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_FITZROY_CAPABILITIES,
  AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_PINNED_VERSION,
  listAflTradeFitzRoyCapabilities,
} from '@/server/aflTradeIntelligence/source/fitzRoyProviderCapabilities';

describe('fitzRoy provider capability contract', () => {
  it('pins one reviewed package version and unique direct-function capabilities', () => {
    const forbiddenGenericWrappers = new Set<string>([
      'fetch_player_stats',
      'fetch_player_details',
      'fetch_results',
      'fetch_awards',
    ]);
    expect(AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION).toBe('afl-trade-fitzroy-capabilities/v1');
    expect(AFL_TRADE_FITZROY_PINNED_VERSION).toBe('1.7.0');

    expect(
      new Set(AFL_TRADE_FITZROY_CAPABILITIES.map(({ capabilityId }) => capabilityId)).size
    ).toBe(AFL_TRADE_FITZROY_CAPABILITIES.length);
    expect(
      AFL_TRADE_FITZROY_CAPABILITIES.every(
        ({ directFunction, fitzRoyVersion }) =>
          fitzRoyVersion === AFL_TRADE_FITZROY_PINNED_VERSION &&
          !forbiddenGenericWrappers.has(directFunction)
      )
    ).toBe(true);
  });

  it('models season-returning round behaviour for the three player-stat providers that ignore it', () => {
    expect(
      AFL_TRADE_FITZROY_CAPABILITIES.filter(
        ({ roundBehaviour }) => roundBehaviour === 'ignored_returns_season'
      ).map(({ directFunction }) => directFunction)
    ).toEqual([
      'fetch_player_stats_afltables',
      'fetch_player_stats_footywire',
      'fetch_player_stats_fryzigg',
    ]);
  });

  it('does not offer FootyWire player stats before 2010 or AFLCA votes before 2006', () => {
    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'advanced_player_stats',
        season: 2009,
      }).some(({ directFunction }) => directFunction === 'fetch_player_stats_footywire')
    ).toBe(false);
    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'advanced_player_stats',
        season: 2010,
      }).some(({ directFunction }) => directFunction === 'fetch_player_stats_footywire')
    ).toBe(true);

    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'coaches_votes',
        season: 2005,
      })
    ).toEqual([]);
    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'coaches_votes',
        season: 2006,
      }).map(({ directFunction }) => directFunction)
    ).toEqual(['fetch_coaches_votes']);
  });

  it('keeps AFLW support provider-specific instead of inheriting wrapper claims', () => {
    const aflWStats = listAflTradeFitzRoyCapabilities({
      competition: 'AFLW',
      metric: 'goals',
      season: 2024,
    });

    expect(aflWStats.map(({ directFunction }) => directFunction)).toEqual([
      'fetch_player_stats_afl',
      'fetch_player_stats_fryzigg',
    ]);
    expect(aflWStats.some(({ provider }) => provider === 'footywire')).toBe(false);
  });

  it('returns candidates without pretending there is one global provider priority', () => {
    const appearanceCandidates = listAflTradeFitzRoyCapabilities({
      competition: 'AFLM',
      metric: 'match_appearance',
      season: 2015,
    });

    expect(appearanceCandidates.map(({ provider }) => provider)).toEqual([
      'official_afl',
      'afl_tables',
      'footywire',
      'fryzigg',
    ]);
    expect(new Set(appearanceCandidates.map(({ intendedRole }) => intendedRole))).toEqual(
      new Set(['candidate_primary', 'candidate_secondary', 'reconciliation_only'])
    );
  });

  it('makes source-shape and missing-value risks explicit before capture', () => {
    const aflTables = AFL_TRADE_FITZROY_CAPABILITIES.find(
      ({ capabilityId }) => capabilityId === 'afl-tables-player-stats'
    );
    const coaches = AFL_TRADE_FITZROY_CAPABILITIES.find(
      ({ capabilityId }) => capabilityId === 'aflca-coaches-votes'
    );

    expect(aflTables?.knownCautions.join(' ')).toContain(
      'returned zero is not automatically a measured zero'
    );
    expect(coaches?.knownCautions.join(' ')).toContain('silently removes per-round scrape errors');
    expect(coaches?.knownCautions.join(' ')).toContain(
      'drops the finals discriminator from returned rows'
    );
    expect(coaches?.requiredCaptureChecks.join(' ')).toContain(
      'explicit award-scope discriminator'
    );
    expect(
      AFL_TRADE_FITZROY_CAPABILITIES.every(
        ({ knownCautions, requiredCaptureChecks }) =>
          knownCautions.length > 0 && requiredCaptureChecks.length > 0
      )
    ).toBe(true);
  });

  it('keeps fantasy scores, contracts, and invented exposure outside the outcome capability set', () => {
    const serialized = JSON.stringify(AFL_TRADE_FITZROY_CAPABILITIES);

    expect(serialized).not.toContain('fetch_fantasy_scores');
    expect(serialized).not.toContain('fetch_outofcontract');
    expect(serialized).not.toContain('minutes_played');
    expect(serialized).not.toContain('time_on_ground');
  });

  it('rejects invalid or pre-competition season requests', () => {
    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'goals',
        season: 1896,
      })
    ).toEqual([]);
    expect(
      listAflTradeFitzRoyCapabilities({
        competition: 'AFLM',
        metric: 'goals',
        season: 2024.5,
      })
    ).toEqual([]);
  });
});
