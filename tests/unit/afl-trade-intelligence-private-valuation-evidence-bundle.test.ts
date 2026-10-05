// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradePrivateValuationEvidenceBundle,
  aflTradePrivateValuationEvidenceBundleSchema,
} from '@/server/aflTradeIntelligence/valuation/privateValuationEvidenceBundle';
import {
  aflTradePrivateValuationTradeEvidenceCorrespondenceSchema,
  createAflTradePrivateValuationTradeEvidenceCorrespondence,
} from '@/server/aflTradeIntelligence/valuation/privateValuationTradeEvidenceCorrespondence';

const digest = (character: string) => character.repeat(64);
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;
const artifact = (name: string, createdAt = '2026-08-18T01:00:00.000Z') =>
  createAflTradeCanonicalJsonArtifactRef({ name }, createdAt);

function createBundle() {
  return createAflTradePrivateValuationEvidenceBundle({
    valuationScopeKey: 'aflm-private-trade-evidence',
    tradeId: 'workbook-trade:sam-flanders',
    createdAt: '2026-08-18T02:00:00.000Z',
    knowledgeCutoffAt: '2026-08-18T00:00:00.000Z',
    factualRoot: {
      releaseId: id('outcome-release', '1'),
      candidateId: id('factual-release-candidate', '2'),
      corpusToCandidateLineageId: id('corpus-factual-lineage', '3'),
      sourceQualificationReportId: id('valuation-source-qualification', '4'),
      privateEvaluationDecisionId: id('private-valuation-evaluation-decision', '5'),
      memberSetSha256: digest('6'),
    },
    evaluatedTradeCorrespondenceArtifact: artifact('trade-correspondence'),
    expectedAssetVersionIds: ['asset-version:pick', 'asset-version:player'],
    assets: [
      {
        assetId: 'asset:pick',
        assetVersionId: 'asset-version:pick',
        assetKind: 'pick',
        receivingClubId: 'club:stk',
        evidenceKind: 'custody_aware_conserved_frontier',
        evidenceArtifact: artifact('pick-attribution'),
        dependencyArtifacts: [artifact('pick-release-readback')],
      },
      {
        assetId: 'asset:player',
        assetVersionId: 'asset-version:player',
        assetKind: 'player',
        receivingClubId: 'club:stk',
        evidenceKind: 'exhaustive_acquisition_spell_horizons',
        evidenceArtifact: artifact('player-admission'),
        dependencyArtifacts: [artifact('hpn-2025'), artifact('hpn-2026')].sort((left, right) =>
          left.artifactId.localeCompare(right.artifactId)
        ),
      },
    ],
  });
}

describe('private valuation evidence bundle', () => {
  it('seals one exact trade and asset mapping across separated factual roots', () => {
    const correspondence = createAflTradePrivateValuationTradeEvidenceCorrespondence({
      valuationScopeKey: 'aflm-private-trade-v3',
      tradeId: 'trade:fixture',
      createdAt: '2026-08-18T01:30:00.000Z',
      evaluatedTrade: {
        factualReleaseId: id('outcome-release', '1'),
        factualCandidateId: id('factual-release-candidate', '2'),
        transactionEventVersionId: 'event-version:trade',
        canonicalMemberSetSha256: digest('3'),
        assetVersionIds: ['asset-version:one', 'asset-version:two'],
      },
      evaluationEvidence: {
        factualReleaseId: id('outcome-release', '4'),
        factualCandidateId: id('factual-release-candidate', '5'),
        corpusToCandidateLineageId: id('corpus-factual-lineage', '6'),
        transactionEventVersionId: 'event-version:trade',
        memberSetSha256: digest('7'),
        assetVersionIds: ['asset-version:one', 'asset-version:two'],
      },
      assetMappings: [
        {
          assetId: 'asset:one',
          evaluatedAssetVersionId: 'asset-version:one',
          evaluationEvidenceAssetVersionId: 'asset-version:one',
        },
        {
          assetId: 'asset:two',
          evaluatedAssetVersionId: 'asset-version:two',
          evaluationEvidenceAssetVersionId: 'asset-version:two',
        },
      ],
    });

    expect(
      aflTradePrivateValuationTradeEvidenceCorrespondenceSchema.parse(correspondence)
    ).toEqual(correspondence);
    expect(correspondence.content.assetMappings).toHaveLength(2);
  });

  it('rejects incomplete or value-bearing correspondence', () => {
    const baseline = {
      valuationScopeKey: 'aflm-private-trade-v3',
      tradeId: 'trade:fixture',
      createdAt: '2026-08-18T01:30:00.000Z',
      evaluatedTrade: {
        factualReleaseId: id('outcome-release', '1'),
        factualCandidateId: id('factual-release-candidate', '2'),
        transactionEventVersionId: 'event-version:trade',
        canonicalMemberSetSha256: digest('3'),
        assetVersionIds: ['asset-version:one', 'asset-version:two'],
      },
      evaluationEvidence: {
        factualReleaseId: id('outcome-release', '4'),
        factualCandidateId: id('factual-release-candidate', '5'),
        corpusToCandidateLineageId: id('corpus-factual-lineage', '6'),
        transactionEventVersionId: 'event-version:trade',
        memberSetSha256: digest('7'),
        assetVersionIds: ['asset-version:one', 'asset-version:two'],
      },
      assetMappings: [
        {
          assetId: 'asset:one',
          evaluatedAssetVersionId: 'asset-version:one',
          evaluationEvidenceAssetVersionId: 'asset-version:one',
        },
      ],
    } as const;
    expect(() => createAflTradePrivateValuationTradeEvidenceCorrespondence(baseline)).toThrow(
      /exactly cover/i
    );

    const complete = createAflTradePrivateValuationTradeEvidenceCorrespondence({
      ...baseline,
      assetMappings: [
        baseline.assetMappings[0],
        {
          assetId: 'asset:two',
          evaluatedAssetVersionId: 'asset-version:two',
          evaluationEvidenceAssetVersionId: 'asset-version:two',
        },
      ],
    });
    expect(() =>
      aflTradePrivateValuationTradeEvidenceCorrespondenceSchema.parse({
        ...complete,
        content: { ...complete.content, score: 10 },
      })
    ).toThrow();
  });

  it('seals complete per-asset factual evidence without scores or grades', () => {
    const bundle = createBundle();

    expect(bundle.content.expectedAssetVersionIds).toEqual([
      'asset-version:pick',
      'asset-version:player',
    ]);
    expect(bundle.content.assets.map(({ evidenceKind }) => evidenceKind)).toEqual([
      'custody_aware_conserved_frontier',
      'exhaustive_acquisition_spell_horizons',
    ]);
    expect(JSON.stringify(bundle)).not.toMatch(/"(?:score|grade|value)"/i);
    expect(aflTradePrivateValuationEvidenceBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it('rejects missing, duplicate, and future evidence', () => {
    const baseline = createBundle();
    const content = structuredClone(baseline.content);

    content.assets.pop();
    expect(() =>
      aflTradePrivateValuationEvidenceBundleSchema.parse({
        evidenceBundleId: baseline.evidenceBundleId,
        content,
      })
    ).toThrow(/asset universe/i);

    expect(() =>
      createAflTradePrivateValuationEvidenceBundle({
        ...baseline.content,
        assets: [baseline.content.assets[0]!, baseline.content.assets[0]!],
      })
    ).toThrow(/unique/i);

    expect(() =>
      createAflTradePrivateValuationEvidenceBundle({
        ...baseline.content,
        assets: baseline.content.assets.map((asset, index) =>
          index === 0
            ? {
                ...asset,
                evidenceArtifact: artifact('future', '2026-08-18T03:00:00.000Z'),
              }
            : asset
        ),
      })
    ).toThrow(/predate bundle creation/i);
  });

  it('rejects calculation output injection and post-address mutation', () => {
    const injected = structuredClone(createBundle()) as unknown as {
      evidenceBundleId: string;
      content: Record<string, unknown> & { score?: number };
    };
    injected.content.score = 0;
    expect(() => aflTradePrivateValuationEvidenceBundleSchema.parse(injected)).toThrow();

    const mutated = structuredClone(createBundle());
    mutated.content.knowledgeCutoffAt = '2026-08-17T00:00:00.000Z';
    expect(() => aflTradePrivateValuationEvidenceBundleSchema.parse(mutated)).toThrow(
      /content address/i
    );
  });
});
