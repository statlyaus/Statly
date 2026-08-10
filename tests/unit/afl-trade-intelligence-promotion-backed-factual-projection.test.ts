import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  createAflTradePromotionBackedFactualProjection,
  parseAflTradePromotionBackedFactualProjection,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualProjectionContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';
import { createAflTradePromotionBackedPublicArchive } from '@/server/aflTradeIntelligence/outcomes/promotionBackedPublicArchiveContracts';

const sha = (value: string) => value.repeat(64);

function candidate() {
  const promotionId = `external-canonical-promotion:${sha('a')}`;
  const canonicalRecordId = `event-version:${sha('b')}`;
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:02.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:01.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: sha('a'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:00.000Z',
        promotionRecordCount: 1,
      },
    ],
    members: [
      {
        promotionId,
        recordKind: 'transaction',
        sourceRecordId: 'trade:2025:1',
        canonicalRecordId,
        recordSha256: sha('c'),
      },
    ],
  });
  return createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
    createdAt: '2026-08-10T00:00:03.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:draftguru-trade-1',
        sourceSnapshotId: `source-snapshot:${sha('d')}`,
        rightsArtifactId: `source-rights:${sha('e')}`,
        gateDecisionId: `gate-decision:${sha('f')}`,
        recordSha256: sha('0'),
        recordedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:draftguru-trade-1'] }],
    canonicalMembers: [
      {
        recordKind: 'transaction',
        canonicalRecordId,
        canonicalRecordSha256: sha('1'),
      },
    ],
  }).candidate;
}

function publicArchive(parent = candidate()) {
  return createAflTradePromotionBackedPublicArchive({
    candidate: parent,
    createdAt: '2026-08-10T00:00:04.000Z',
    records: [
      {
        recordKind: 'transaction',
        recordId:
          parent.content.targetReleaseManifest.content.canonicalMembers[0]!.canonicalRecordId,
        eventId: 'trade:2025:1',
        eventVersionId:
          parent.content.targetReleaseManifest.content.canonicalMembers[0]!.canonicalRecordId,
        seasonYear: 2025,
        occurredOn: '2025-10-15',
        officialName: 'Fixture trade',
        transactionType: 'trade',
        parties: [
          {
            club: { clubId: 'club:carlton', name: 'Carlton', abbreviation: 'CARL' },
            role: 'party',
            ordinal: 1,
          },
          {
            club: { clubId: 'club:fremantle', name: 'Fremantle', abbreviation: 'FRE' },
            role: 'party',
            ordinal: 2,
          },
        ],
      },
    ],
  });
}

function create() {
  const parent = candidate();
  return createAflTradePromotionBackedFactualProjection({
    candidate: parent,
    archive: publicArchive(parent),
    createdAt: '2026-08-10T00:00:05.000Z',
    parityReport: {
      artifact: createAflTradeCanonicalJsonArtifactRef(
        { status: 'passed' },
        '2026-08-10T00:00:04.000Z'
      ),
      status: 'passed',
      checkCount: 5,
      failureCount: 0,
      checkedCanonicalRecordCount: 1,
      checkedPublicRecordCount: 1,
    },
  });
}

describe('promotion-backed factual projection contracts', () => {
  it('seals one deterministic public factual projection without valuation authority', () => {
    const projection = create();
    expect(parseAflTradePromotionBackedFactualProjection(projection)).toEqual(projection);
    expect(create()).toEqual(projection);
    expect(projection.content.authorityBoundary).toContain('no_valuation_grade');
    expect(projection.content.publicRecordCount).toBe(1);
    expect(projection.content.publicArchiveId).toMatch(/^public-factual-archive:/);
  });

  it('binds exact corpus, release, candidate, private roots and public root', () => {
    const projection = create();
    const parent = candidate();
    expect(projection.content.releaseId).toBe(parent.content.targetReleaseId);
    expect(projection.content.factualCandidateId).toBe(parent.candidateId);
    expect(projection.content.corpusId).toBe(parent.content.corpusId);
    expect(projection.content.sourceMemberSetSha256).toBe(parent.content.sourceMemberSetSha256);
    expect(projection.content.canonicalMemberSetSha256).toBe(
      parent.content.canonicalMemberSetSha256
    );
    expect(projection.content.publicRecordSetSha256).toBe(
      publicArchive(parent).content.recordSetSha256
    );
  });

  it('rejects count, derivation and content-address substitutions', () => {
    const projection = create();
    for (const content of [
      { ...projection.content, publicRecordCount: 2 },
      { ...projection.content, derivationSha256: sha('9') },
      { ...projection.content, publicRecordSetSha256: sha('8') },
    ]) {
      expect(() =>
        parseAflTradePromotionBackedFactualProjection({ ...projection, content })
      ).toThrow();
    }
  });

  it('rejects projection and parity evidence that predate their parent chronology', () => {
    const parent = candidate();
    expect(() =>
      createAflTradePromotionBackedFactualProjection({
        candidate: parent,
        archive: publicArchive(parent),
        createdAt: '2026-08-10T00:00:02.999Z',
        parityReport: {
          artifact: createAflTradeCanonicalJsonArtifactRef(
            { status: 'passed' },
            '2026-08-10T00:00:04.000Z'
          ),
          status: 'passed',
          checkCount: 1,
          failureCount: 0,
          checkedCanonicalRecordCount: 1,
          checkedPublicRecordCount: 1,
        },
      })
    ).toThrow(/predate/i);
  });
});
