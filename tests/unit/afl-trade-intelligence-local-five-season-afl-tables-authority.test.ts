import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA,
  LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA,
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';

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
          derived_feature_creation: 'allowed',
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

  it('admits the exact internal-evaluation capture through Gate 0A', () => {
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(2021);

    expect(
      evaluateAflTradeGate0A(authority.capture.ledger, authority.capture.sourceRights, {
        ...authority.capture.gateRequest,
        evaluatedAt: '2026-08-26T00:00:00.000Z',
      })
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
  });

  it('binds current-season completed results to their exact offline-inspected fitzRoy schema', () => {
    const authority = createLocalAflTradeAflTablesResultsAuthority(2026);
    const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);

    expect(LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA.map(({ name }) => name)).toEqual([
      'Game',
      'Date',
      'Round',
      'Home.Team',
      'Home.Goals',
      'Home.Behinds',
      'Home.Points',
      'Away.Team',
      'Away.Goals',
      'Away.Behinds',
      'Away.Points',
      'Venue',
      'Margin',
      'Season',
      'Round.Type',
      'Round.Number',
    ]);
    expect(LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA.find(({ name }) => name === 'Season')).toEqual({
      name: 'Season',
      storageType: 'double',
      classes: ['numeric'],
      levels: null,
      timezone: null,
    });
    expect(authority.capture.captureRequest).toMatchObject({
      capabilityId: 'afl-tables-results',
      authorizationSeason: 2026,
      parameters: { season: 2026, roundNumber: null },
    });
    expect(authority.capture.sourceRights.content.acquisition.capabilities).toEqual([
      {
        capabilityId: 'afl-tables-results',
        provider: 'afl_tables',
        directFunction: 'fetch_results_afltables',
      },
    ]);
    expect(authority.capture.ledger.decisions[0]?.content).toMatchObject({
      state: 'approved',
      authorityKind: 'external_human_record',
    });
    expect(authority.fieldMap).toMatchObject({
      mapId: 'afl-tables-results-local-2026-v2',
      capabilityId: 'afl-tables-results',
      observationKind: 'match_universe',
      approvalDecisionId: 'local-afl-tables-results-field-map-review-2026-v2',
      invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
      match: {
        nativeMatchId: { sourceField: 'Game', required: true },
        homeClubName: { sourceField: 'Home.Team', required: true },
        awayClubName: { sourceField: 'Away.Team', required: true },
      },
    });
  });

  it('rejects seasons outside the approved five-season local load', () => {
    expect(() => createLocalAflTradeFiveSeasonAflTablesAuthority(2027)).toThrow(
      '2021 through 2026'
    );
  });
});
