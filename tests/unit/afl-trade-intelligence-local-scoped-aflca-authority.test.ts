import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  LOCAL_SCOPED_AFLCA_COACHES_VOTES_FIELD_SCHEMA,
  LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME,
  createLocalAflTradeScopedAflcaCoachesVotesAuthority,
} from '@/server/aflTradeIntelligence/development/localScopedAflcaCoachesVotesAuthority';
import { resolveLocalScopedAflcaGateRevision } from '@/server/aflTradeIntelligence/development/localScopedAflcaCoachesVotesStaging';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/gate0aEvaluation';

describe('local scoped AFLCA coaches-votes authority', () => {
  it('binds explicit home-and-away rounds and patched runtime to training authority', () => {
    const authority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(2025, [1, 2, 23, 24]);
    const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);

    expect(LOCAL_SCOPED_AFLCA_FITZROY_RUNTIME).toEqual({
      rVersion: '4.5.1',
      dependencyLockSha256: '061c2ff232be7bd262ae64b29100a773d437748471fb96936f2c768d0ab9c24a',
      imageDigest: 'sha256:72f3e6cb0ac3d1619c41455c957608063f75211a6a9892e8aa2ff307bd70bf88',
    });
    expect(LOCAL_SCOPED_AFLCA_COACHES_VOTES_FIELD_SCHEMA.map(({ name }) => name)).toEqual([
      'Season',
      'Round',
      'Award.Scope',
      'Home.Team',
      'Away.Team',
      'Player.Name',
      'Coaches.Votes',
    ]);
    expect(authority.capture.captureRequest).toMatchObject({
      capabilityId: 'aflca-coaches-votes-scoped',
      competition: 'AFLM',
      authorizationSeason: 2025,
      parameters: {
        season: 2025,
        roundNumbers: [1, 2, 23, 24],
        awardScope: 'home_and_away',
        team: null,
      },
    });
    expect(authority.capture.gateRequest.operations).toContain('model_training');
    expect(authority.capture.gateRequest.operations).toContain('derived_feature_creation');
    expect(authority.capture.gateRequest.fieldUses).toContainEqual({
      sourceField: 'Coaches.Votes',
      use: 'derived_feature',
    });
    expect(authority.capture.gateRequest.fieldUses).toContainEqual({
      sourceField: 'Coaches.Votes',
      use: 'model_training',
    });
    expect(authority.capture.sourceRights.content).toMatchObject({
      datasetVersion: expect.stringContaining('72f3e6cb0ac3'),
      operations: {
        model_training: 'allowed',
        derived_feature_creation: 'allowed',
        public_derived_output: 'blocked',
        public_fact_display: 'blocked',
        raw_field_redistribution: 'blocked',
      },
      conditions: expect.arrayContaining([
        expect.objectContaining({ conditionId: 'exact-patched-runtime' }),
        expect.objectContaining({ conditionId: 'complete-home-and-away-match-coverage' }),
      ]),
    });
    expect(authority.fieldMap).toMatchObject({
      mapId: 'aflca-coaches-votes-scoped-local-2025-v1',
      capabilityId: 'aflca-coaches-votes-scoped',
      invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
      exactOrderedFields: [
        'Season',
        'Round',
        'Award.Scope',
        'Home.Team',
        'Away.Team',
        'Player.Name',
        'Coaches.Votes',
      ],
      naturalKeyFields: ['Season', 'Round', 'Award.Scope', 'Home.Team', 'Away.Team', 'Player.Name'],
    });
  });

  it('admits the exact private training request and rejects unsafe round sets', () => {
    const authority = createLocalAflTradeScopedAflcaCoachesVotesAuthority(2021, [1, 2, 3]);

    expect(
      evaluateAflTradeGate0A(authority.capture.ledger, authority.capture.sourceRights, {
        ...authority.capture.gateRequest,
        evaluatedAt: '2026-09-02T01:00:00.000Z',
      })
    ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    expect(() => createLocalAflTradeScopedAflcaCoachesVotesAuthority(2025, [1, 24, 24])).toThrow(
      /strictly increasing and unique/
    );
    expect(() => createLocalAflTradeScopedAflcaCoachesVotesAuthority(2020, [1])).toThrow(
      /2021 through 2025/
    );
  });

  it('reuses an already-current successor decision instead of rotating authority on retry', () => {
    const first = createLocalAflTradeScopedAflcaCoachesVotesAuthority(2021, [1, 2, 3]);
    const successor = createLocalAflTradeScopedAflcaCoachesVotesAuthority(2021, [1, 2, 3], {
      version: 2,
      supersedesDecisionId: first.gateDecisionId,
    });
    const decision = successor.capture.ledger.decisions[0];

    expect(
      resolveLocalScopedAflcaGateRevision(
        decision,
        successor.capture.sourceRights.rightsArtifactId
      )
    ).toEqual({ version: 2, supersedesDecisionId: first.gateDecisionId });
  });
});
