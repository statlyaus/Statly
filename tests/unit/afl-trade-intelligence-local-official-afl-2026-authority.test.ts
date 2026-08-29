import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA,
  createLocalAflTradeOfficialAfl2026Authority,
} from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';

describe('local official AFL 2026 authority', () => {
  it('binds the exact reviewed official schema and request-scoped season', () => {
    const authority = createLocalAflTradeOfficialAfl2026Authority();
    const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);

    expect(LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA).toHaveLength(95);
    expect(LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'providerId',
        'utcStartTime',
        'status',
        'player.playerId',
        'player.givenName',
        'player.surname',
        'teamId',
        'team.name',
        'goals',
      ])
    );
    expect(LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA.map(({ name }) => name)).not.toContain(
      'extendedStats'
    );
    expect(authority.capture.captureRequest).toMatchObject({
      capabilityId: 'official-afl-player-stats',
      competition: 'AFLM',
      authorizationSeason: 2026,
      parameters: { season: 2026, roundNumber: null },
    });
    expect(authority.capture.sourceRights).toMatchObject({
      content: {
        provider: 'official_afl',
        scope: { seasonRanges: [{ from: 2026, to: 2026 }] },
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
          rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
          cache: { permitted: true, maximumSeconds: 3_600 },
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
      expect.arrayContaining([{ sourceField: 'goals', use: 'archive_fact' }])
    );
    expect(authority.capture.gateRequest.fieldUses).toHaveLength(95);
    expect(authority.fieldMap).toMatchObject({
      capabilityId: 'official-afl-player-stats',
      validFromSeason: 2026,
      validThroughSeason: 2026,
      invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
      seasonField: null,
      naturalKeyFields: ['providerId', 'player.playerId'],
      identity: {
        nativeId: { sourceField: 'player.playerId', required: true },
        recordedName: { sourceField: 'player.givenName', required: true },
        recordedSurname: { sourceField: 'player.surname', required: true },
        recordedClubNativeId: { sourceField: 'teamId', required: true },
        recordedClubName: { sourceField: 'team.name', required: true },
      },
      match: {
        nativeMatchId: { sourceField: 'providerId', required: true },
        season: { sourceField: 'compSeason.shortName', required: true },
        roundLabel: { sourceField: 'round.name', required: true },
        matchDate: { sourceField: 'utcStartTime', required: true },
        homeClubName: { sourceField: 'home.team.name', required: true },
        awayClubName: { sourceField: 'away.team.name', required: true },
        status: { sourceField: 'status', required: true },
      },
      metrics: [
        {
          metricCode: 'goals',
          sourceField: 'goals',
          zeroSemantics: 'measured_zero',
        },
      ],
    });
  });

  it('admits the exact internal-evaluation capture through Gate 0A', () => {
    const authority = createLocalAflTradeOfficialAfl2026Authority();

    expect(
      evaluateAflTradeGate0A(authority.capture.ledger, authority.capture.sourceRights, {
        ...authority.capture.gateRequest,
        evaluatedAt: '2026-08-26T00:00:00.000Z',
      })
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
  });
});
