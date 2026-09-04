import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_AFLCA_COACHES_VOTES_FIELD_SCHEMA,
  createLocalAflTradeAflcaCoachesVotesAuthority,
} from '@/server/aflTradeIntelligence/development/localAflcaCoachesVotesAuthority';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';

describe('local AFLCA coaches-votes authority', () => {
  it('binds the inspected six-field season capture to private model-training authority', () => {
    const authority = createLocalAflTradeAflcaCoachesVotesAuthority(2025);
    const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);

    expect(LOCAL_AFLCA_COACHES_VOTES_FIELD_SCHEMA).toEqual([
      {
        name: 'Season',
        storageType: 'integer',
        classes: ['integer'],
        levels: null,
        timezone: null,
      },
      { name: 'Round', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
      {
        name: 'Home.Team',
        storageType: 'character',
        classes: ['character'],
        levels: null,
        timezone: null,
      },
      {
        name: 'Away.Team',
        storageType: 'character',
        classes: ['character'],
        levels: null,
        timezone: null,
      },
      {
        name: 'Player.Name',
        storageType: 'character',
        classes: ['character'],
        levels: null,
        timezone: null,
      },
      {
        name: 'Coaches.Votes',
        storageType: 'character',
        classes: ['character'],
        levels: null,
        timezone: null,
      },
    ]);
    expect(authority.capture.captureRequest).toMatchObject({
      capabilityId: 'aflca-coaches-votes',
      competition: 'AFLM',
      authorizationSeason: 2025,
      parameters: { season: 2025, roundNumber: null, team: null },
    });
    expect(authority.capture.sourceRights.content).toMatchObject({
      provider: 'afl_coaches_association',
      operations: {
        model_training: 'allowed',
        derived_feature_creation: 'allowed',
        public_derived_output: 'blocked',
        public_fact_display: 'blocked',
        raw_field_redistribution: 'blocked',
      },
      redistribution: {
        rawFieldsPermitted: false,
        publicDerivedOutputPermitted: false,
      },
      restrictions: {
        commercial: ['internal-evaluation'],
        audience: ['internal'],
      },
    });
    expect(authority.capture.gateRequest.operations).not.toContain('model_training');
    expect(authority.capture.gateRequest.fieldUses).not.toContainEqual({
      sourceField: 'Coaches.Votes',
      use: 'model_training',
    });
    expect(authority.fieldMap).toMatchObject({
      mapId: 'aflca-coaches-votes-local-2025-v2',
      capabilityId: 'aflca-coaches-votes',
      invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
      naturalKeyFields: ['Season', 'Round', 'Home.Team', 'Away.Team', 'Player.Name'],
      identity: {
        nativeId: null,
        recordedName: { sourceField: 'Player.Name', required: true },
        recordedClubNativeId: null,
        recordedClubName: null,
      },
      metrics: [
        {
          metricCode: 'coaches_votes',
          sourceField: 'Coaches.Votes',
          definitionVersion: 'coaches-votes/v1',
          unit: 'votes',
          zeroSemantics: 'measured_zero',
          sourceRepresentation: 'integer_text',
        },
      ],
    });
  });

  it('admits only the exact internal non-production request and rejects out-of-window seasons', () => {
    const authority = createLocalAflTradeAflcaCoachesVotesAuthority(2021);

    expect(
      evaluateAflTradeGate0A(authority.capture.ledger, authority.capture.sourceRights, {
        ...authority.capture.gateRequest,
        evaluatedAt: '2026-09-02T01:00:00.000Z',
      })
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    expect(() => createLocalAflTradeAflcaCoachesVotesAuthority(2020)).toThrow(/2021 through 2025/);
  });
});
