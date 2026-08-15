import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';

describe('local five-season AFL Tables authority', () => {
  it('binds one exact reviewed 81-field source contract to each season capture', () => {
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(2025);
    const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);

    expect(LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA).toHaveLength(81);
    expect(LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'Season',
        'Round',
        'Date',
        'ID',
        'Player',
        'Playing.for',
        'Home.team',
        'Away.team',
        'Goals',
      ])
    );
    expect(authority.capture.captureRequest).toMatchObject({
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      authorizationSeason: 2025,
      parameters: { season: 2025, rescrape: false, rescrapeStartSeason: null },
    });
    expect(authority.capture.sourceRights).toMatchObject({
      content: {
        provider: 'afl_tables',
        operations: {
          internal_quality_evaluation: 'allowed',
          model_training: 'blocked',
          derived_feature_creation: 'blocked',
          public_derived_output: 'blocked',
          public_fact_display: 'blocked',
        },
        redistribution: { publicDerivedOutputPermitted: false },
        restrictions: {
          commercial: ['internal-evaluation'],
          audience: ['internal'],
        },
        automatedAccess: {
          rateLimit: { requests: 1, perSeconds: 2, burst: 1 },
          cache: { permitted: true, maximumSeconds: 86_400 },
        },
      },
    });
    expect(authority.capture.gateRequest).toMatchObject({
      commercialContext: 'internal-evaluation',
      audience: 'internal',
      operations: [
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
      ],
    });
    expect(authority.capture.gateRequest.fieldUses).toEqual(
      expect.arrayContaining([{ sourceField: 'Goals', use: 'archive_fact' }])
    );
    expect(authority.capture.gateRequest.fieldUses).toHaveLength(81);
    expect(authority.fieldMap).toMatchObject({
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      validFromSeason: 2025,
      validThroughSeason: 2025,
      invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
      identity: {
        nativeId: { sourceField: 'ID', required: true },
        recordedName: { sourceField: 'Player', required: true },
        recordedClubNativeId: null,
        recordedClubName: { sourceField: 'Playing.for', required: true },
      },
      match: {
        nativeMatchId: null,
        season: { sourceField: 'Season', required: true },
        roundLabel: { sourceField: 'Round', required: true },
        matchDate: { sourceField: 'Date', required: true },
        homeClubNativeId: null,
        homeClubName: { sourceField: 'Home.team', required: true },
        awayClubNativeId: null,
        awayClubName: { sourceField: 'Away.team', required: true },
        status: null,
      },
      metrics: [
        {
          metricCode: 'goals',
          sourceField: 'Goals',
          definitionVersion: 'goals/v1',
          unit: 'goals',
          zeroSemantics: 'provider_zero_may_mean_missing',
        },
      ],
    });
  });

  it('keeps the earliest completed season independently authorized without broad rescraping', () => {
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(2021);

    expect(authority.capture.captureRequest.parameters).toEqual({
      season: 2021,
      rescrape: false,
      rescrapeStartSeason: null,
    });
    expect(authority.fieldMap.validFromSeason).toBe(2021);
    expect(authority.fieldMap.validThroughSeason).toBe(2021);
  });

  it('rejects seasons outside the approved five-season local load', () => {
    expect(() => createLocalAflTradeFiveSeasonAflTablesAuthority(2026)).toThrow(
      '2021 through 2025'
    );
  });
});
