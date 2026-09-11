import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AflTradeAdmittedModelRunAuthorityService,
  type AflTradeNativePavModelRunEvidence,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradePlayerPavObservationSet } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { admittedPavModelRunFixture } from '../testUtils/admittedPavModelRunFixture';
import { admittedRunFixture } from '../testUtils/admittedPlayerModelRunFixture';

describe('native PAV admitted run-start authority', () => {
  let fixture: Awaited<ReturnType<typeof admittedPavModelRunFixture>>;
  beforeAll(async () => {
    fixture = await admittedPavModelRunFixture();
  });
  async function authorize(evidence: AflTradeNativePavModelRunEvidence) {
    const issueOnceForIntent = vi.fn(async () => true);
    const service = new AflTradeAdmittedModelRunAuthorityService({
      authenticator: { authenticate: async () => evidence },
      clock: { now: async () => fixture.startedAt },
      authorizationStore: { issueOnceForIntent, consumeIntentOnce: async () => false },
    });
    return {
      result: await service.authorize({ intent: fixture.intent, protocol: fixture.protocol }),
      issueOnceForIntent,
    };
  }
  it('authorizes the exact native pair through the existing authority service', async () => {
    const { result, issueOnceForIntent } = await authorize(fixture.evidence);
    expect(result.status, JSON.stringify(result)).toBe('authorized');
    if (result.status === 'authorized') {
      expect(result.modelFamily).toBe('native_pav');
      expect(result).toHaveProperty('datasetCandidate', fixture.evidence.datasetCandidate);
    }
    expect(issueOnceForIntent).toHaveBeenCalledOnce();
  });
  it('rejects a valid scalar envelope mixed with the native protocol before issuance', async () => {
    // Deliberately violate the authenticator boundary; both documents are valid separately.
    const mixed = {
      ...fixture.evidence,
      observationSet: admittedRunFixture().observationSet,
    } as unknown as AflTradeNativePavModelRunEvidence;
    const { result, issueOnceForIntent } = await authorize(mixed);
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual([expect.objectContaining({ code: 'invalid_evidence' })]);
    expect(issueOnceForIntent).not.toHaveBeenCalled();
  });
  it('rejects a valid readdressed original set substituted behind the admitted parent', async () => {
    const substituted = createAflTradePlayerPavObservationSet({
      ...fixture.evidence.pavObservationSet.content,
      createdAt: '2026-10-01T00:19:59.000Z',
    });
    expect(substituted.observationSetId).not.toBe(
      fixture.evidence.pavObservationSet.observationSetId
    );
    const { result, issueOnceForIntent } = await authorize({
      ...fixture.evidence,
      pavObservationSet: substituted,
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'observation_set_mismatch' }),
    ]);
    expect(issueOnceForIntent).not.toHaveBeenCalled();
  });
  it('rejects changed retained HPN source bytes before issuance', async () => {
    const { result, issueOnceForIntent } = await authorize({
      ...fixture.evidence,
      executableArtifacts: fixture.evidence.executableArtifacts.map((artifact) =>
        artifact.artifactId === fixture.evidence.hpnMethod.content.sourceArtifact.artifactId
          ? { ...artifact, bytes: new TextEncoder().encode('substituted HPN method source') }
          : artifact
      ),
    });
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'execution_artifact_mismatch' }),
    ]);
    expect(issueOnceForIntent).not.toHaveBeenCalled();
  });
});
