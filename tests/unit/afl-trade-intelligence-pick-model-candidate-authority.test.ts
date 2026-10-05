// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradePickPavModelRunAuthorization,
  createAflTradePickPavModelRunIntent,
  createAflTradePickPavObservationAdmission,
} from '@/server/aflTradeIntelligence/modeling/pickPavModelCandidateAuthority';

const digest = (character: string) => character.repeat(64);
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;
const artifact = (name: string, createdAt = '2026-08-18T00:00:00.000Z') =>
  createAflTradeCanonicalJsonArtifactRef({ name }, createdAt);

function authorityChain() {
  const admission = createAflTradePickPavObservationAdmission({
    observationSetId: id('pick-pav-observation-set', '1'),
    observationSetSha256: digest('2'),
    releaseId: id('outcome-release', '3'),
    policyId: id('pick-pav-policy', '4'),
    sourceQualificationReportId: id('valuation-source-qualification', '5'),
    gate2DecisionId: id('gate-decision', '6'),
    sourceQualificationArtifact: artifact('source-qualification'),
    gate2DecisionArtifact: artifact('gate-2'),
    admittedAt: '2026-08-18T00:30:00.000Z',
  });
  const intent = createAflTradePickPavModelRunIntent({
    admission,
    modelId: 'pick-pav-distribution',
    modelVersion: 'candidate-v1',
    codeCommitSha: '1'.repeat(40),
    cleanWorktree: true,
    seed: 42,
    sourceCodeArtifact: artifact('source'),
    dependencyLockArtifact: artifact('lock'),
    runtimeArtifact: artifact('runtime'),
    configurationArtifact: artifact('configuration'),
    startedAt: '2026-08-18T01:00:00.000Z',
  });
  const authorization = createAflTradePickPavModelRunAuthorization({
    admission,
    intent,
    modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', '7')],
    operationalPrincipalAuthorityId: id('operational-principal-authority', '8'),
    gateLedgerRevision: 12,
    authorizedAt: '2026-08-18T01:05:00.000Z',
    validThrough: '2026-08-18T02:00:00.000Z',
  });
  return { admission, intent, authorization };
}

describe('pick model candidate authority chain', () => {
  it('separates evidence admission, execution intent, and time-bounded authorization', () => {
    const chain = authorityChain();

    expect(chain.admission.content.environment).toBe('non_production');
    expect(chain.admission.content.tradeScoringAuthority).toBe('not_granted');
    expect(chain.intent.content.candidateOutputs).toBe('not_yet_created');
    expect(chain.authorization.content.consumption).toBe('exactly_once');
    expect(chain.authorization.content.gate3Authority).toBe('not_granted');
    expect(chain.authorization.content.publicationEligible).toBe(false);
  });

  it('rejects ancestry drift and invalid authorization chronology', () => {
    const { admission, intent } = authorityChain();
    const otherAdmission = createAflTradePickPavObservationAdmission({
      ...admission.content,
      observationSetId: id('pick-pav-observation-set', 'f'),
      observationSetSha256: digest('f'),
    });
    expect(() =>
      createAflTradePickPavModelRunAuthorization({
        admission: otherAdmission,
        intent,
        modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', '7')],
        operationalPrincipalAuthorityId: id('operational-principal-authority', '8'),
        gateLedgerRevision: 12,
        authorizedAt: '2026-08-18T02:00:00.000Z',
        validThrough: '2026-08-18T01:00:00.000Z',
      })
    ).toThrow(/exact intent.admission ancestry/i);
    expect(() =>
      createAflTradePickPavModelRunAuthorization({
        admission,
        intent,
        modelTrainingEvaluationReceiptIds: [id('gate0a-evaluation', '7')],
        operationalPrincipalAuthorityId: id('operational-principal-authority', '8'),
        gateLedgerRevision: 12,
        authorizedAt: '2026-08-18T02:00:00.000Z',
        validThrough: '2026-08-18T01:00:00.000Z',
      })
    ).toThrow(/valid through/i);
  });

  it('rejects duplicate or non-canonical evaluation receipts', () => {
    const { admission, intent } = authorityChain();
    const receipt = id('gate0a-evaluation', '7');
    expect(() =>
      createAflTradePickPavModelRunAuthorization({
        admission,
        intent,
        modelTrainingEvaluationReceiptIds: [receipt, receipt],
        operationalPrincipalAuthorityId: id('operational-principal-authority', '8'),
        gateLedgerRevision: 12,
        authorizedAt: '2026-08-18T01:05:00.000Z',
        validThrough: '2026-08-18T02:00:00.000Z',
      })
    ).toThrow(/unique and canonically ordered/i);
  });
});
