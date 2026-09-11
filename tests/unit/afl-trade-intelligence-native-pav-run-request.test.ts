import { describe, expect, it } from 'vitest';

import { createAflTradePlayerPavModelProtocol } from '@/server/aflTradeIntelligence/artifacts/modelProtocol';
import { createAflTradeModelRunIntent } from '@/server/aflTradeIntelligence/artifacts/modelRunManifest';
import {
  AflTradeAdmittedModelRunAuthorityService,
  AflTradeAdmittedModelRunner,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradeAdmittedPlayerContributionExecutor } from '@/server/aflTradeIntelligence/modeling/admittedPlayerContributionCandidate';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';

describe('native PAV run request dispatch', () => {
  it('does not execute native work when its authorization cannot be consumed', async () => {
    const fixture = await admittedPavModelRunFixture();
    const clock = { now: async () => fixture.startedAt };
    const authorizationStore = {
      issueOnceForIntent: async () => true,
      consumeIntentOnce: async () => false,
    };
    const authority = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => fixture.evidence },
      clock,
      authorizationStore,
    });
    const runner = new AflTradeAdmittedModelRunner(
      authority,
      {
        execute: async () => {
          throw new Error('Unconsumed native work must not execute.');
        },
      },
      authorizationStore,
      clock,
      {
        persistCompletedRun: async () => {
          throw new Error('No native run completed.');
        },
      },
      {
        recordExecutionFailure: async () => {
          throw new Error('No native execution started.');
        },
      }
    );
    expect(await runner.run({ intent: fixture.intent, protocol: fixture.protocol })).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'authorization_not_consumable' }],
    });
  });

  it('cannot route an authorized native pair through the scalar executor', async () => {
    const fixture = await admittedPavModelRunFixture();
    const authority = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => fixture.evidence },
      clock: { now: async () => fixture.startedAt },
      authorizationStore: {
        issueOnceForIntent: async () => true,
        consumeIntentOnce: async () => false,
      },
    });
    const authorized = await authority.authorize({
      intent: fixture.intent,
      protocol: fixture.protocol,
    });
    if (authorized.status !== 'authorized') throw new Error(JSON.stringify(authorized));
    const executor = createAflTradeAdmittedPlayerContributionExecutor({
      artifactRepository: createAflTradeFixtureArtifactRepository(),
      maximumArtifactBytes: 1_000_000,
      now: () => fixture.startedAt,
    });
    await expect(executor.execute(authorized)).rejects.toThrow(/cannot execute through the scalar/);
  });

  it('requires authoritative evidence for a valid native protocol rather than treating it as scalar', async () => {
    const fixture = admittedRunFixture();
    const scalar = fixture.protocol.content;
    const artifact = scalar.valueUnit.definitionArtifact;
    const protocol = createAflTradePlayerPavModelProtocol({
      schemaVersion: 'afl-trade-model-protocol/v3',
      environment: 'test_fixture',
      protocolKey: 'fixture-native-request-no-evidence',
      version: 1,
      modelKind: scalar.modelKind,
      datasetId: scalar.datasetId,
      datasetAdmission: scalar.datasetAdmission,
      preparedAt: scalar.preparedAt,
      preparedBy: scalar.preparedBy,
      proposalOrigin: scalar.proposalOrigin,
      publicIdentityBoundary: scalar.publicIdentityBoundary,
      observationGrain: scalar.observationGrain,
      sourceObservationSet: {
        observationSetId: `player-pav-observation-set:${'a'.repeat(64)}`,
        artifact,
      },
      pavPolicy: { policyId: `player-pav-policy:${'b'.repeat(64)}`, artifact },
      hpnMethod: { methodId: `hpn-pav-method:${'c'.repeat(64)}`, artifact },
      target: {
        fixedHorizonSeasons: 3,
        annualValueUnit: 'season_pav',
        aggregation: 'sum',
        valueUnit: 'fixed_horizon_pav',
      },
      featureDefinitionArtifact: artifact,
      featurePolicy: scalar.featurePolicy,
      windows: scalar.windows,
      modelSelectionPolicy: scalar.modelSelectionPolicy,
      validationPlan: scalar.validationPlan,
      limitations: ['Synthetic request shape only; no native observations or approval.'],
    });
    const intent = createAflTradeModelRunIntent({
      ...fixture.intent.content,
      modelProtocolId: protocol.protocolId,
    });
    const authority = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: {
        authenticate: async () => {
          throw new Error('No retained native evidence exists for this request.');
        },
      },
      clock: { now: async () => intent.content.startedAt },
      authorizationStore: {
        issueOnceForIntent: async () => {
          throw new Error('Must not issue authority without native evidence.');
        },
        consumeIntentOnce: async () => false,
      },
    });
    expect(await authority.authorize({ intent, protocol })).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'evidence_unavailable' }],
    });
  });
});
