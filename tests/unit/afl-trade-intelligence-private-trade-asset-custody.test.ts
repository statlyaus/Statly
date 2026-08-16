import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeWorkbookTransactionReviewDecision,
  type AflTradeWorkbookTransactionReviewDecision,
} from '@/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import type { AflTradeWorkbookTransactionReviewSet } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewSet';
import { createAflTradePrivateTradeAssetCustody } from '@/server/aflTradeIntelligence/valuation/privateTradeAssetCustody';

const decidedAt = '2026-08-16T04:00:00.000Z';
const sha = (character: string) => character.repeat(64);
const ref = (name: string) => createAflTradeCanonicalJsonArtifactRef({ name }, decidedAt);

function reviewSet(): AflTradeWorkbookTransactionReviewSet {
  const parties = [
    {
      stagingRowId: `workbook-row:${sha('1')}`,
      rowSha256: sha('2'),
      sourceLocator: 'Trades!R11',
      sourceOrdinal: 11,
      clubLabel: 'St Kilda',
      assetText: 'Sam Flanders',
    },
    {
      stagingRowId: `workbook-row:${sha('3')}`,
      rowSha256: sha('4'),
      sourceLocator: 'Trades!R12',
      sourceOrdinal: 12,
      clubLabel: 'Gold Coast',
      assetText: 'Pick 8',
    },
  ];
  const stagingPackageId = `workbook-import:${sha('5')}`;
  const sourceGroupId = `workbook-source-group:${sha('6')}`;
  const transactionRowId = `workbook-row:${sha('7')}`;
  const transactionRowSha256 = sha('8');
  const partySetSha256 = sha256AflTradeCanonicalJson(parties);
  const subjectAddress = {
    stagingPackageId,
    sourceGroupId,
    transactionRowId,
    transactionRowSha256,
    partySetSha256,
  };
  const transaction = {
    reviewSubjectId: createAflTradeContentAddress(
      'workbook-transaction-review-subject',
      subjectAddress
    ),
    sourceGroupId,
    transactionRowId,
    transactionRowSha256,
    sourceLocator: 'Trades!R10',
    sourceOrdinal: 10,
    seasonYear: 2025,
    sourceTitle: 'Flanders / Pick 8',
    parties,
    partySetSha256,
    reviewState: 'pending' as const,
  };
  const content = {
    schemaVersion: 'afl-trade-workbook-transaction-review-set/v1' as const,
    stagingPackageId,
    sourceArtifactId: `artifact:${sha('9')}`,
    sourceArtifactSha256: sha('9'),
    rawEvidenceSha256: sha('a'),
    authority: 'private_workbook_migration_oracle_review' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    transactions: [transaction],
    transactionCount: 1,
    transactionSetSha256: sha256AflTradeCanonicalJson([transaction]),
    pendingReviewCount: 1,
  };
  return {
    reviewSetId: createAflTradeContentAddress('workbook-transaction-review-set', content),
    content,
  };
}

function decision(set: AflTradeWorkbookTransactionReviewSet) {
  return createAflTradeWorkbookTransactionReviewDecision({
    reviewSet: set,
    reviewSubjectId: set.content.transactions[0]!.reviewSubjectId,
    outcome: 'approved',
    canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
    transferDirection: 'listed_club_received_assets',
    revision: 1,
    supersedesDecisionId: null,
    reviewerId: 'local-reviewer:robert',
    rationale: 'Exact local identity and direction review.',
    decidedAt,
  });
}

function input() {
  const set = reviewSet();
  const currentDecision = decision(set);
  return {
    reviewSet: set,
    currentDecision,
    reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(set, decidedAt),
    reviewDecisionArtifact: createAflTradeCanonicalJsonArtifactRef(currentDecision, decidedAt),
    reviewSubjectId: set.content.transactions[0]!.reviewSubjectId,
    assets: [
      {
        sourcePartyRowId: set.content.transactions[0]!.parties[0]!.stagingRowId,
        sendingClubId: 'afl-club:gold-coast',
        receivingClubId: 'afl-club:st-kilda',
        state: 'resolved' as const,
        identity: {
          kind: 'player' as const,
          playerId: 'afl-player:sam-flanders',
          acquisitionSpellVersionId: `acquisition-spell-version:${sha('b')}`,
          identityEvidenceRefs: [ref('flanders-identity')],
          acquisitionSpellEvidenceRefs: [ref('flanders-st-kilda-spell')],
        },
      },
      {
        sourcePartyRowId: set.content.transactions[0]!.parties[1]!.stagingRowId,
        sendingClubId: 'afl-club:st-kilda',
        receivingClubId: 'afl-club:gold-coast',
        state: 'resolved' as const,
        identity: {
          kind: 'pick' as const,
          selectionId: 'afl-selection:2025:8',
          selectedPlayerId: 'afl-player:pick-8-player',
          acquisitionSpellVersionId: `acquisition-spell-version:${sha('c')}`,
          selectionLineageArtifact: ref('pick-8-lineage'),
          identityEvidenceRefs: [ref('pick-8-identity')],
        },
      },
    ],
    classifiedAt: decidedAt,
  };
}

describe('private confirmed trade asset custody', () => {
  it('seals exact direction, canonical kind, identity, selection lineage, and acquisition spell', () => {
    const first = createAflTradePrivateTradeAssetCustody(input());
    const secondInput = input();
    const second = createAflTradePrivateTradeAssetCustody({
      ...secondInput,
      assets: [...secondInput.assets].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.custodyId).toMatch(/^private-trade-asset-custody:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      state: 'ready',
      counts: { totalAssets: 2, resolvedAssets: 2, unavailableAssets: 0 },
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(first.content.assets).toEqual([
      expect.objectContaining({
        assetId: expect.stringMatching(/^private-confirmed-trade-asset:[a-f0-9]{64}$/),
        sourceAssetText: 'Sam Flanders',
        sendingClubId: 'afl-club:gold-coast',
        receivingClubId: 'afl-club:st-kilda',
        identity: expect.objectContaining({ kind: 'player' }),
      }),
      expect.objectContaining({
        sourceAssetText: 'Pick 8',
        sendingClubId: 'afl-club:st-kilda',
        receivingClubId: 'afl-club:gold-coast',
        identity: expect.objectContaining({ kind: 'pick' }),
      }),
    ]);
  });

  it('rejects omitted, duplicated, or directionally inconsistent source assets', () => {
    const valid = input();
    expect(() =>
      createAflTradePrivateTradeAssetCustody({ ...valid, assets: valid.assets.slice(0, 1) })
    ).toThrow(/every source party row/i);
    expect(() =>
      createAflTradePrivateTradeAssetCustody({
        ...valid,
        assets: [valid.assets[0]!, valid.assets[0]!],
      })
    ).toThrow(/every source party row/i);
    expect(() =>
      createAflTradePrivateTradeAssetCustody({
        ...valid,
        assets: [
          { ...valid.assets[0]!, receivingClubId: 'afl-club:gold-coast' },
          valid.assets[1]!,
        ],
      })
    ).toThrow(/receiving club/i);
  });

  it('retains unresolved identity as unavailable instead of inventing an asset', () => {
    const valid = input();
    const custody = createAflTradePrivateTradeAssetCustody({
      ...valid,
      assets: [
        valid.assets[0]!,
        {
          sourcePartyRowId: valid.reviewSet.content.transactions[0]!.parties[1]!.stagingRowId,
          sendingClubId: 'afl-club:st-kilda',
          receivingClubId: 'afl-club:gold-coast',
          state: 'unavailable',
          assertedKind: 'pick',
          reasons: ['selection_lineage_unresolved'],
          evidenceRefs: [ref('pick-8-unresolved')],
        },
      ],
    });

    expect(custody.content).toMatchObject({
      state: 'blocked',
      counts: { totalAssets: 2, resolvedAssets: 1, unavailableAssets: 1 },
    });
    expect(custody.content.assets[1]).toMatchObject({
      state: 'unavailable',
      assertedKind: 'pick',
      reasons: ['selection_lineage_unresolved'],
    });
  });

  it('rejects a rejected or unauthenticated transaction-review parent', () => {
    const valid = input();
    const rejected = {
      ...valid.currentDecision,
      content: { ...valid.currentDecision.content, outcome: 'rejected' },
    } as AflTradeWorkbookTransactionReviewDecision;
    expect(() =>
      createAflTradePrivateTradeAssetCustody({ ...valid, currentDecision: rejected })
    ).toThrow();
    expect(() =>
      createAflTradePrivateTradeAssetCustody({
        ...valid,
        reviewDecisionArtifact: ref('wrong-decision'),
      })
    ).toThrow(/exact immutable review decision/i);
  });
});
