import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress as address } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createRetainedFitzRoyDerivedUseSuccessor } from '@/server/aflTradeIntelligence/source/retainedFitzRoyDerivedUseSuccessor';
import { assessRetainedCameron2020HpnPrivateCalculationSourceUse } from '@/server/aflTradeIntelligence/modeling/retainedHpnPrivateCalculationSourceUse';

const effectiveAt = '2026-09-20T00:00:00.000Z';
const ownerApprovalBytes = Buffer.from(
  JSON.stringify({
    decision: 'approved',
    approvedBy: 'statly-product-owner',
    approvedAt: '2026-09-19T00:00:00.000Z',
    ownerAuthorization: {
      approvedUses: [
        'valuation and grading',
        'retained source evidence as a basis for other documented methods',
      ],
    },
  })
);

function assessmentInput() {
  const fixture = createLocalAflTradeFitzRoyFactualRehearsalFixture({
    profile: 'completed_match_result',
  });
  const original = fixture.command.capture;
  const rightsContent = structuredClone(original.sourceRights.content);
  rightsContent.operations.derived_feature_creation = 'blocked';
  rightsContent.operations.model_training = 'blocked';
  rightsContent.operations.public_derived_output = 'blocked';
  rightsContent.operations.public_fact_display = 'blocked';
  rightsContent.fields = rightsContent.fields.map((field) => ({
    ...field,
    uses: {
      ...field.uses,
      derived_feature: 'blocked' as const,
      model_training: 'blocked' as const,
      public_display: 'blocked' as const,
    },
  }));
  const sourceRights = {
    rightsArtifactId: address('source-rights', rightsContent),
    content: rightsContent,
  };
  const proposalContent = structuredClone(original.ledger.proposals[0]!.content);
  proposalContent.accountableOwner = 'statly-product-owner';
  proposalContent.scope.dimensions = proposalContent.scope.dimensions.map((dimension) => {
    if (dimension.name === 'source_rights_artifact')
      return { ...dimension, values: [sourceRights.rightsArtifactId] };
    if (dimension.name === 'operation')
      return {
        ...dimension,
        values: dimension.values.filter(
          (value) => sourceRights.content.operations[value as never] === 'allowed'
        ),
      };
    if (dimension.name === 'commercial_context')
      return { ...dimension, values: ['internal-evaluation'] };
    if (dimension.name === 'audience') return { ...dimension, values: ['internal'] };
    return dimension;
  });
  proposalContent.affectedArtifacts = [
    { kind: 'source_rights', artifactId: sourceRights.rightsArtifactId },
  ];
  const proposal = {
    proposalId: address('gate-proposal', proposalContent),
    content: proposalContent,
  };
  const decisionContent = {
    ...structuredClone(original.ledger.decisions[0]!.content),
    proposalId: proposal.proposalId,
    scope: proposal.content.scope,
    accountableOwner: 'statly-product-owner',
    affectedArtifacts: proposal.content.affectedArtifacts,
  };
  const decision = {
    decisionId: address('gate-decision', decisionContent),
    content: decisionContent,
  };
  const captureId = `source-capture:${'a'.repeat(64)}`;
  const candidateContent = {
    schemaVersion: 'statly-cameron-2020-hpn-retained-source-use-method/v1',
    environment: 'non_production',
    competition: 'AFLM',
    seasonYear: 2020,
    valuationScopeKey: 'cameron-2020-private-pilot',
    operation: 'derived_feature_creation',
    hpnPavMethodId: `hpn-pav-method:${'c'.repeat(64)}`,
    ownerApprovalSha256: createHash('sha256').update(ownerApprovalBytes).digest('hex'),
    captureUses: [captureId, `source-capture:${'b'.repeat(64)}`].map((id) => ({
      capabilityId: 'footywire-player-stats',
      captureId: id,
      originalGateDecisionId: decision.decisionId,
      originalRightsArtifactId: sourceRights.rightsArtifactId,
      sourceFields: ['away_points', 'home_points'],
    })),
    restrictions: {
      originalAcquisitionProvenanceImmutable: true,
      rawFieldRedistributionPermitted: false,
      publicOutputAuthorizedByThisCandidate: false,
      externalLicenseAsserted: false,
    },
    state: 'candidate_requires_durable_source_use_admission',
  };
  const methodUseCandidate = {
    methodUseId: address('cameron-2020-hpn-method-use', candidateContent),
    content: candidateContent,
  };
  const successor = createRetainedFitzRoyDerivedUseSuccessor({
    sourceRights,
    proposal,
    decision,
    methodUseCandidate,
    ownerApprovalBytes,
    captureId,
    effectiveAt,
    accountableOwner: 'statly-product-owner',
    reviewer: {
      id: 'source-reviewer',
      role: 'source-control-review',
      evidenceId: `artifact:${'d'.repeat(64)}`,
    },
  });
  const input = {
    original: { sourceRights, proposal, decision },
    originalRightsArtifact: createAflTradeCanonicalJsonArtifactRef(sourceRights, effectiveAt),
    successor,
    methodUseCandidate,
    ownerApprovalBytes,
    source: {
      captureId,
      sourceSnapshotId: `source-snapshot:${'1'.repeat(64)}`,
      sourceArtifact: createAflTradeCanonicalJsonArtifactRef(
        { synthetic: 'raw source' },
        effectiveAt
      ),
      normalizationRunId: `provider-normalization-run:${'2'.repeat(64)}`,
      normalizationFinalizationSha256: '3'.repeat(64),
      providerDecodeMapId: `provider-field-map:${'4'.repeat(64)}`,
      providerDecodeMapSha256: '5'.repeat(64),
      sourceSchemaSha256: '6'.repeat(64),
      gateDecisionId: decision.decisionId,
      gateProposalId: proposal.proposalId,
      gateDecisionKey: decision.content.decisionKey,
    },
    sourceFields: ['away_points', 'home_points'],
    evaluatedAt: effectiveAt,
  };
  return input;
}

describe('retained 2020 private calculation source use', () => {
  it('assesses exactly the successor-derived fields as permitted private calculation', () => {
    const input = assessmentInput();
    const assessment = assessRetainedCameron2020HpnPrivateCalculationSourceUse(input);
    expect(assessment.content.state).toBe('permitted_private_calculation');
    expect(assessment.content.seasonYear).toBe(2020);
    expect(assessment.content.valuationScopeKey).toBe('cameron-2020-private-pilot');
    expect(assessment.content.publicationEligible).toBe(false);
    expect(assessment.content.fields.map(({ sourceField }) => sourceField)).toEqual([
      'away_points',
      'home_points',
    ]);
    // The named rights must be the ones that permit the fields, not the archive-only original.
    expect(assessment.content.rightsArtifactId).toBe(input.successor.sourceRights.rightsArtifactId);
    expect(assessment.content.rightsArtifactId).not.toBe(
      input.original.sourceRights.rightsArtifactId
    );
  });

  it('rejects a successor whose authority is not current for the assessment instant', () => {
    const input = assessmentInput();
    const revalidateAt = input.successor.decision.content.revalidateAt;
    if (revalidateAt === null)
      throw new TypeError('The successor must carry a revalidation window.');
    expect(() =>
      assessRetainedCameron2020HpnPrivateCalculationSourceUse({
        ...input,
        evaluatedAt: revalidateAt,
      })
    ).toThrow();
    expect(() =>
      assessRetainedCameron2020HpnPrivateCalculationSourceUse({
        ...input,
        evaluatedAt: '2026-01-01T00:00:00.000Z',
      })
    ).toThrow();
  });

  it('rejects a tampered successor and any field outside the successor rights', () => {
    const input = assessmentInput();
    const limitations = [...input.successor.decision.content.limitations, 'Injected limitation.'];
    expect(() =>
      assessRetainedCameron2020HpnPrivateCalculationSourceUse({
        ...input,
        successor: {
          ...input.successor,
          decision: {
            ...input.successor.decision,
            content: { ...input.successor.decision.content, limitations },
          },
        },
      })
    ).toThrow();
    expect(() =>
      assessRetainedCameron2020HpnPrivateCalculationSourceUse({
        ...input,
        sourceFields: ['away_points', 'home_points', 'unregistered_field'],
      })
    ).toThrow();
  });
});
