import { describe, expect, it, vi } from 'vitest';

import { prepareAflTradePromotionBackedFactualPublication } from '@/server/aflTradeIntelligence/outcomes/preparePromotionBackedFactualPublication';

const hash = (value: string) => value.repeat(64);

describe('promotion-backed factual publication preparation', () => {
  it('builds release, lineage, and archive once and stops at Gate 2 review', async () => {
    const calls: string[] = [];
    const release = {
      corpusId: `corpus:${hash('a')}`,
      releaseId: `outcome-release:${hash('b')}`,
      candidateId: `factual-release-candidate:${hash('c')}`,
      sourceMemberSetSha256: hash('d'),
      canonicalMemberSetSha256: hash('e'),
      canonicalMemberCount: 3,
      status: 'finalized' as const,
      idempotentReplay: false,
    };
    const stage = {
      lineageId: `corpus-factual-lineage:${hash('f')}`,
      decisionKey: `gate2:corpus-factual-lineage:${hash('f')}`,
      affectedArtifacts: [
        { kind: 'corpus_manifest', artifactId: release.corpusId },
        { kind: 'factual_release', artifactId: release.releaseId },
        { kind: 'factual_release_candidate', artifactId: release.candidateId },
        {
          kind: 'corpus_factual_lineage',
          artifactId: `corpus-factual-lineage:${hash('f')}`,
        },
      ],
      status: 'staged' as const,
      idempotentReplay: false,
    };
    const archive = {
      archive: {
        archiveId: `public-factual-archive:${hash('1')}`,
        content: {
          releaseId: release.releaseId,
          factualCandidateId: release.candidateId,
          corpusId: release.corpusId,
          recordCount: 3,
        },
      },
      projection: {
        projectionId: `outcome-projection:${hash('2')}`,
        content: {
          releaseId: release.releaseId,
          factualCandidateId: release.candidateId,
          publicArchiveId: `public-factual-archive:${hash('1')}`,
        },
      },
      idempotentReplay: false,
    };
    const result = await prepareAflTradePromotionBackedFactualPublication(
      {
        corpusId: release.corpusId,
        scopeKey: 'public-afl-draft-trade-outcomes',
        releaseCreatedAt: '2026-08-10T01:00:00.000Z',
        lineageCreatedAt: '2026-08-10T01:01:00.000Z',
        archiveCreatedAt: '2026-08-10T01:02:00.000Z',
      },
      {
        releaseRepository: {
          build: vi.fn(async () => {
            calls.push('release');
            return release;
          }),
        },
        gate2Repository: {
          stage: vi.fn(async () => {
            calls.push('lineage');
            return stage;
          }),
        },
        archiveRepository: {
          build: vi.fn(async () => {
            calls.push('archive');
            return archive;
          }),
        },
      }
    );

    expect(calls).toEqual(['release', 'lineage', 'archive']);
    expect(result.gate2AffectedArtifacts).toEqual(stage.affectedArtifacts);
    expect(result).toEqual({
      status: 'awaiting_gate_2_review',
      publicationEligible: false,
      corpusId: release.corpusId,
      releaseId: release.releaseId,
      factualCandidateId: release.candidateId,
      lineageId: stage.lineageId,
      publicArchiveId: archive.archive.archiveId,
      projectionId: archive.projection.projectionId,
      gate2DecisionKey: stage.decisionKey,
      gate2AffectedArtifacts: stage.affectedArtifacts,
      canonicalMemberCount: 3,
      publicRecordCount: 3,
      idempotentReplay: false,
    });
  });

  it('rejects noncausal preparation chronology before calling repositories', async () => {
    const build = vi.fn();
    await expect(
      prepareAflTradePromotionBackedFactualPublication(
        {
          corpusId: `corpus:${hash('a')}`,
          scopeKey: 'public-afl-draft-trade-outcomes',
          releaseCreatedAt: '2026-08-10T01:02:00.000Z',
          lineageCreatedAt: '2026-08-10T01:01:00.000Z',
          archiveCreatedAt: '2026-08-10T01:03:00.000Z',
        },
        {
          releaseRepository: { build },
          gate2Repository: { stage: build },
          archiveRepository: { build },
        }
      )
    ).rejects.toThrow(/chronology/i);
    expect(build).not.toHaveBeenCalled();
  });
});
