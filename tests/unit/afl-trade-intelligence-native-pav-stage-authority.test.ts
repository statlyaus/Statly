import { beforeAll, describe, expect, it } from 'vitest';
import {
  authenticateAflTradeNativePavStageEvidence,
  createAflTradePrivateValuationModelRunOperationalAuthorization,
} from '@/server/aflTradeIntelligence/modeling/admittedModelRunAuthority';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePlayerPavObservationSet } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  appendAflTradeGateDecision,
  type AflTradeGateDecisionLedger,
} from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import { nativePavModelRunSqlFixture } from '../testUtils/nativePavModelRunSqlFixture';

describe('native PAV stage evidence authentication', () => {
  let native: Awaited<ReturnType<typeof nativePavModelRunSqlFixture>>;
  beforeAll(async () => {
    native = await nativePavModelRunSqlFixture();
  }, 30_000);

  it('refuses fixture/human authority at the private non-production stage boundary', () => {
    const fixture = native.template;
    expect(() =>
      authenticateAflTradeNativePavStageEvidence({
        intent: fixture.intent,
        evidence: fixture.evidence,
        evaluatedAt: fixture.startedAt,
      })
    ).toThrow('Native PAV stage requires an exact private root intent');
  });

  const later = (seconds: number) =>
    new Date(Date.parse(native.startedAt) + seconds * 1000).toISOString();
  function authenticate(evidence = native.evidence, evaluatedAt = later(10)) {
    return authenticateAflTradeNativePavStageEvidence({
      intent: native.intent,
      evidence,
      evaluatedAt,
    });
  }

  it('authenticates exact private evidence after the initial five-second start window', () => {
    expect(authenticate()).toMatchObject({
      registeredProtocol: native.protocol,
      observationSet: native.observationSet,
      operationalAuthorization: native.operationalAuthorization,
    });
  });

  it('does not treat a consumed start-authorization lifetime as the operational receipt lifetime', () => {
    const receipt = native.operationalAuthorization.content;
    if (
      receipt.authorityBoundary !==
      'policy_owned_local_private_valuation_for_one_exact_model_run_intent'
    ) {
      throw new Error('Expected the shared fixture private operational receipt.');
    }
    const operationalAuthorization = createAflTradePrivateValuationModelRunOperationalAuthorization(
      {
        ...receipt,
        validThrough: later(60),
      }
    );
    expect(
      authenticate({ ...native.evidence, operationalAuthorization }, later(40))
    ).toHaveProperty('operationalAuthorization', operationalAuthorization);
  });

  it('rejects an expired immutable operational receipt', () => {
    expect(() =>
      authenticate(native.evidence, native.operationalAuthorization.content.validThrough)
    ).toThrow('current exact operational authorization');
  });

  it.each(['not-a-time', '2026-09-02T00:21:59.999Z'])(
    'rejects invalid stage time %s',
    (evaluatedAt) => {
      expect(() => authenticate(native.evidence, evaluatedAt)).toThrow(
        'valid current evaluation time'
      );
    }
  );

  it('rejects substituted executable bytes', () => {
    expect(() =>
      authenticate({
        ...native.evidence,
        executableArtifacts: native.evidence.executableArtifacts.map((artifact, index) =>
          index === 0 ? { ...artifact, bytes: new TextEncoder().encode('substitution') } : artifact
        ),
      })
    ).toThrow('exact executable artifact bytes');
  });

  it('rejects a re-addressed original PAV set behind the admitted projection', () => {
    const pavObservationSet = createAflTradePlayerPavObservationSet({
      ...native.evidence.pavObservationSet.content,
      createdAt: later(1),
    });
    expect(() => authenticate({ ...native.evidence, pavObservationSet })).toThrow(
      'exact admitted observation ancestry'
    );
  });

  function revoke(ledger: AflTradeGateDecisionLedger) {
    const original = ledger.decisions[0]!;
    const parent = ledger.proposals.find(
      ({ proposalId }) => proposalId === original.content.proposalId
    )!;
    const proposalContent = {
      ...parent.content,
      version: parent.content.version + 1,
      proposedAt: later(1),
    };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const content = {
      ...original.content,
      proposalId: proposal.proposalId,
      version: original.content.version + 1,
      state: 'blocked',
      decidedAt: later(2),
      effectiveAt: later(2),
      supersedesDecisionId: original.decisionId,
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', content),
      content,
    });
    return appendAflTradeGateDecision(ledger, proposal, decision);
  }

  it('rejects current Gate 2 revocation after the original start', () => {
    expect(() =>
      authenticate({ ...native.evidence, gate2Ledger: revoke(native.evidence.gate2Ledger) })
    ).toThrow('current Gate 2 authority');
  });
  it('rejects current source-training revocation after the original start', () => {
    expect(() =>
      authenticate({
        ...native.evidence,
        gateDecisionLedger: revoke(native.evidence.gateDecisionLedger),
      })
    ).toThrow('current model-training rights');
  });
});
