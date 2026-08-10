import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradePromotionBackedAuthority } from '@/server/aflTradeIntelligence/development/localPromotionBackedAuthority';
import { createLocalAflTradePromotionBackedEvidence } from '@/server/aflTradeIntelligence/development/localPromotionBackedEvidenceFixture';
import { deriveAflTradeExternalCanonicalPromotionProposal } from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';

const hash = (character: string) => character.repeat(64);

function input() {
  const source = createLocalAflTradePromotionBackedEvidence();
  const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate: source.candidate,
    proposedAt: '2026-08-09T09:00:01.000Z',
    draftEvents: [
      {
        draftYear: 2025,
        draftType: 'national',
        eventDate: '2025-11-19',
        officialName: '2025 AFL National Draft',
      },
    ],
  });
  return {
    proposal,
    scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2026,
    corpusId: `corpus:${hash('1')}`,
    factualCandidateId: `factual-release-candidate:${hash('2')}`,
    lineageId: `corpus-factual-lineage:${hash('3')}`,
    releaseId: `outcome-release:${hash('4')}`,
    projectionId: `outcome-projection:${hash('5')}`,
    parityReportArtifactId: `artifact:${hash('6')}`,
    expectedActivationRegistryRevision: 3,
  };
}

describe('local promotion-backed authority', () => {
  it('binds every review and gate to the exact dynamic ancestry', () => {
    const authority = createLocalAflTradePromotionBackedAuthority(input());

    expect(authority.promotion.authorityId).toMatch(/^reviewer-authority-evidence:[a-f0-9]{64}$/);
    expect(authority.promotion.authoritySha256).toBe(
      sha256AflTradeCanonicalJson(authority.promotion.authorityPayload)
    );
    expect(authority.promotion.decision.content).toMatchObject({
      candidateId: input().proposal.content.candidateId,
      proposalId: input().proposal.proposalId,
      authorityEvidenceId: authority.promotion.authorityId,
      decision: 'approved',
    });
    expect(authority.gate2.decision.content.affectedArtifacts).toEqual([
      { kind: 'corpus_manifest', artifactId: input().corpusId },
      { kind: 'factual_release', artifactId: input().releaseId },
      { kind: 'factual_release_candidate', artifactId: input().factualCandidateId },
      { kind: 'corpus_factual_lineage', artifactId: input().lineageId },
    ]);
    for (const gate of [authority.review, authority.operation]) {
      expect(gate.decision.content.affectedArtifacts).toEqual([
        { kind: 'factual_release', artifactId: input().releaseId },
        { kind: 'factual_projection', artifactId: input().projectionId },
      ]);
    }
    expect(authority.activation.content).toMatchObject({
      environment: 'test_fixture',
      scopeKey: input().scopeKey,
      releaseId: input().releaseId,
      projectionId: input().projectionId,
      expectedRegistryRevision: 3,
      parityReportArtifactId: input().parityReportArtifactId,
      writeBarrier: 'engaged',
    });
  });

  it('is byte-stable for an exact reviewed publication package', () => {
    expect(createLocalAflTradePromotionBackedAuthority(input())).toEqual(
      createLocalAflTradePromotionBackedAuthority(input())
    );
  });
});
