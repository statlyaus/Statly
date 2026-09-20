import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress as address } from '../artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '../development/localFitzRoyFactualRehearsalFixture';
import { createRetainedFitzRoyDerivedUseSuccessor } from './retainedFitzRoyDerivedUseSuccessor';

const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
  profile: 'completed_match_result',
});
const firstCapture = `source-capture:${'a'.repeat(64)}`;
const otherCapture = `source-capture:${'b'.repeat(64)}`;
const effectiveAt = '2026-09-20T00:00:00.000Z';
const ownerApprovalBytes = Buffer.from(JSON.stringify({
  decision: 'approved', approvedBy: 'statly-product-owner',
  approvedAt: '2026-09-19T00:00:00.000Z',
  ownerAuthorization: { approvedUses: [
    'valuation and grading', 'retained source evidence as a basis for other documented methods',
  ] },
}));

function input() {
  const original = fixture.command.capture;
  const rightsContent = structuredClone(original.sourceRights.content);
  rightsContent.operations.derived_feature_creation = 'blocked';
  rightsContent.operations.model_training = 'blocked';
  rightsContent.operations.public_derived_output = 'blocked';
  rightsContent.operations.public_fact_display = 'blocked';
  rightsContent.fields = rightsContent.fields.map((field) => ({ ...field,
    uses: { ...field.uses, derived_feature: 'blocked' as const,
      model_training: 'blocked' as const, public_display: 'blocked' as const },
  }));
  const sourceRights = { rightsArtifactId: address('source-rights', rightsContent), content: rightsContent };
  const proposalContent = structuredClone(original.ledger.proposals[0]!.content);
  proposalContent.accountableOwner = 'statly-product-owner';
  proposalContent.scope.dimensions = proposalContent.scope.dimensions.map((dimension) => {
    if (dimension.name === 'source_rights_artifact') return { ...dimension, values: [sourceRights.rightsArtifactId] };
    if (dimension.name === 'operation') return { ...dimension, values: dimension.values.filter(
      (value) => sourceRights.content.operations[value as keyof typeof rightsContent.operations] === 'allowed') };
    if (dimension.name === 'commercial_context') return { ...dimension, values: ['internal-evaluation'] };
    if (dimension.name === 'audience') return { ...dimension, values: ['internal'] };
    return dimension;
  });
  proposalContent.affectedArtifacts = [{ kind: 'source_rights', artifactId: sourceRights.rightsArtifactId }];
  const proposal = { proposalId: address('gate-proposal', proposalContent), content: proposalContent };
  const decisionContent = { ...structuredClone(original.ledger.decisions[0]!.content),
    proposalId: proposal.proposalId, scope: proposal.content.scope,
    accountableOwner: 'statly-product-owner',
    affectedArtifacts: proposal.content.affectedArtifacts,
  };
  const decision = { decisionId: address('gate-decision', decisionContent), content: decisionContent };
  const candidateContent = {
    schemaVersion: 'statly-cameron-2020-hpn-retained-source-use-method/v1',
    environment: 'non_production', competition: 'AFLM', seasonYear: 2020,
    valuationScopeKey: 'cameron-2020-private-pilot', operation: 'derived_feature_creation',
    hpnPavMethodId: `hpn-pav-method:${'c'.repeat(64)}`,
    ownerApprovalSha256: createHash('sha256').update(ownerApprovalBytes).digest('hex'),
    captureUses: [firstCapture, otherCapture].map((captureId) => ({
      capabilityId: 'footywire-player-stats', captureId,
      originalGateDecisionId: decision.decisionId,
      originalRightsArtifactId: sourceRights.rightsArtifactId,
      sourceFields: ['away_points', 'home_points'],
    })),
    restrictions: { originalAcquisitionProvenanceImmutable: true,
      rawFieldRedistributionPermitted: false, publicOutputAuthorizedByThisCandidate: false,
      externalLicenseAsserted: false },
    state: 'candidate_requires_durable_source_use_admission',
  };
  const methodUseCandidate = {
    methodUseId: address('cameron-2020-hpn-method-use', candidateContent), content: candidateContent,
  };
  return { sourceRights, proposal, decision, methodUseCandidate, ownerApprovalBytes,
    captureId: firstCapture, effectiveAt, accountableOwner: 'statly-product-owner',
    reviewer: { id: 'source-reviewer', role: 'source-control-review',
      evidenceId: `artifact:${'d'.repeat(64)}` },
  };
}

describe('retained 2020 private derived-use successor', () => {
  it('binds one capture and only its documented fields without changing acquisition provenance', () => {
    const original = input();
    const next = createRetainedFitzRoyDerivedUseSuccessor(original);
    expect(next.decision.content.supersedesDecisionId).toBe(original.decision.decisionId);
    expect(next.proposal.content.scope.dimensions).toContainEqual({
      name: 'retained_method_use', values: [original.methodUseCandidate.methodUseId],
    });
    expect(next.sourceRights.content.fields.filter((field) => field.uses.derived_feature === 'allowed')
      .map((field) => field.sourceField)).toEqual(expect.arrayContaining(['away_points', 'home_points']));
    expect(next.sourceRights.content.fields.filter((field) => field.uses.derived_feature === 'allowed')).toHaveLength(2);
    expect(next.sourceRights.content.operations.model_training).toBe('blocked');
    expect(next.sourceRights.content.operations.public_derived_output).toBe('blocked');
    expect(next.sourceRights.content.operations.public_fact_display).toBe('blocked');
    expect(original.sourceRights.content.operations.derived_feature_creation).toBe('blocked');
  });

  it('refuses another capture, altered method bytes and out-of-scope fields', () => {
    const original = input();
    expect(() => createRetainedFitzRoyDerivedUseSuccessor({ ...original,
      captureId: `source-capture:${'f'.repeat(64)}` })).toThrow();
    expect(() => createRetainedFitzRoyDerivedUseSuccessor({ ...original,
      methodUseCandidate: { ...original.methodUseCandidate,
        content: { ...original.methodUseCandidate.content, hpnPavMethodId: `hpn-pav-method:${'e'.repeat(64)}` } },
    })).toThrow();
    const content = structuredClone(original.methodUseCandidate.content);
    content.captureUses[0]!.sourceFields = ['unregistered_field'];
    expect(() => createRetainedFitzRoyDerivedUseSuccessor({ ...original,
      methodUseCandidate: { methodUseId: address('cameron-2020-hpn-method-use', content), content },
    })).toThrow();
  });
});
