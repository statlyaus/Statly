import { describe, expect, it } from 'vitest';

import {
  createAflTradePromotionBackedCorpus,
  type AflTradePromotionBackedCorpus,
} from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_PROMOTION_BACKED_FACTUAL_RELEASE_SCHEMA_VERSION,
  createAflTradePromotionBackedFactualRelease,
  parseAflTradePromotionBackedFactualCandidate,
  parseAflTradePromotionBackedFactualRelease,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';

const sha = (value: string) => value.repeat(64);
const promotion2024 = `external-canonical-promotion:${sha('a')}`;
const promotion2025 = `external-canonical-promotion:${sha('b')}`;

function corpus(): AflTradePromotionBackedCorpus {
  return createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:04.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:03.000Z',
    promotions: [
      {
        promotionId: promotion2024,
        promotionSha256: sha('a'),
        anchorSeasonYear: 2024,
        finalizedAt: '2026-08-10T00:00:01.000Z',
        promotionRecordCount: 1,
      },
      {
        promotionId: promotion2025,
        promotionSha256: sha('b'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:02.000Z',
        promotionRecordCount: 2,
      },
    ],
    members: [
      {
        promotionId: promotion2024,
        recordKind: 'transaction',
        sourceRecordId: 'trade:2024:101',
        canonicalRecordId: `event-version:${sha('1')}`,
        recordSha256: sha('1'),
      },
      {
        promotionId: promotion2025,
        recordKind: 'draft_selection',
        sourceRecordId: 'selection:2025:national:14',
        canonicalRecordId: `draft-selection:${sha('2')}`,
        recordSha256: sha('2'),
      },
      {
        promotionId: promotion2025,
        recordKind: 'pick_realization',
        sourceRecordId: 'pick:2025:national:14',
        canonicalRecordId: `pick-realization:${sha('3')}`,
        recordSha256: sha('3'),
      },
    ],
  });
}

const captures = [
  {
    captureId: 'capture:draftguru-trade-2024',
    sourceSnapshotId: `source-snapshot:${sha('4')}`,
    rightsArtifactId: `source-rights:${sha('5')}`,
    gateDecisionId: `gate-decision:${sha('6')}`,
    recordSha256: sha('7'),
    recordedAt: '2026-08-10T00:00:01.000Z',
  },
  {
    captureId: 'capture:draftguru-year-2025',
    sourceSnapshotId: `source-snapshot:${sha('8')}`,
    rightsArtifactId: `source-rights:${sha('9')}`,
    gateDecisionId: `gate-decision:${sha('c')}`,
    recordSha256: sha('d'),
    recordedAt: '2026-08-10T00:00:02.000Z',
  },
] as const;

const promotionSources = [
  { promotionId: promotion2024, captureIds: [captures[0].captureId] },
  { promotionId: promotion2025, captureIds: [captures[1].captureId] },
] as const;

const canonicalMembers = [
  {
    recordKind: 'transaction' as const,
    canonicalRecordId: `event-version:${sha('1')}`,
    canonicalRecordSha256: sha('e'),
  },
  {
    recordKind: 'draft_selection' as const,
    canonicalRecordId: `draft-selection:${sha('2')}`,
    canonicalRecordSha256: sha('f'),
  },
  {
    recordKind: 'pick_realization' as const,
    canonicalRecordId: `pick-realization:${sha('3')}`,
    canonicalRecordSha256: sha('0'),
  },
] as const;

function create(overrides: Record<string, unknown> = {}) {
  return createAflTradePromotionBackedFactualRelease({
    corpus: corpus(),
    scopeKey: 'afl-draft-trade-public-outcomes',
    createdAt: '2026-08-10T00:00:05.000Z',
    effectiveThrough: '2026-08-10T00:00:03.000Z',
    sourceCaptures: captures,
    promotionSources: promotionSources.map((source) => ({
      ...source,
      captureIds: [...source.captureIds],
    })),
    canonicalMembers,
    ...overrides,
  });
}

describe('promotion-backed factual release contracts', () => {
  it('seals one private candidate and reconstructable release over the exact corpus', () => {
    const bundle = create();

    expect(parseAflTradePromotionBackedFactualRelease(bundle.release)).toEqual(bundle.release);
    expect(parseAflTradePromotionBackedFactualCandidate(bundle.candidate)).toEqual(
      bundle.candidate
    );
    expect(bundle.release.content.schemaVersion).toBe(
      AFL_TRADE_PROMOTION_BACKED_FACTUAL_RELEASE_SCHEMA_VERSION
    );
    expect(bundle.candidate.content.schemaVersion).toBe(
      AFL_TRADE_PROMOTION_BACKED_FACTUAL_CANDIDATE_SCHEMA_VERSION
    );
    expect(bundle.candidate.content.publicationEligible).toBe(false);
    expect(bundle.candidate.content.corpusId).toBe(bundle.corpus.corpusId);
    expect(bundle.release.content.sourceMemberSetSha256).toBe(
      bundle.corpus.content.memberSetSha256
    );
    expect(bundle.release.content.sourceRecordCounts).toEqual(bundle.corpus.content.recordCounts);
    expect(bundle.release.content.canonicalMemberCount).toBe(3);
    expect(bundle.release.content.canonicalRecordCounts).toEqual(
      bundle.corpus.content.recordCounts
    );
    expect(bundle.candidate.content.canonicalMemberSetSha256).toBe(
      bundle.release.content.canonicalMemberSetSha256
    );
    expect(bundle.candidate.content.targetReleaseId).toBe(bundle.release.releaseId);
    expect(bundle.release.releaseId).toMatch(/^outcome-release:[a-f0-9]{64}$/);
    expect(bundle.candidate.candidateId).toMatch(/^factual-release-candidate:[a-f0-9]{64}$/);
  });

  it('is invariant to source-capture and promotion-source input order', () => {
    const expected = create();
    const reordered = create({
      sourceCaptures: [...captures].reverse(),
      promotionSources: [...promotionSources].reverse(),
      canonicalMembers: [...canonicalMembers].reverse(),
    });

    expect(reordered).toEqual(expected);
  });

  it('allows one immutable capture to support more than one reviewed promotion', () => {
    const shared = create({
      promotionSources: [
        { promotionId: promotion2024, captureIds: [captures[0].captureId] },
        {
          promotionId: promotion2025,
          captureIds: [captures[0].captureId, captures[1].captureId],
        },
      ],
    });

    expect(shared.release.content.sourceCaptures).toHaveLength(2);
    expect(shared.release.content.promotionSources[1]?.captureIds).toEqual([
      captures[0].captureId,
      captures[1].captureId,
    ]);
  });

  it('rejects omitted, duplicated, or foreign source ancestry', () => {
    expect(() =>
      create({
        promotionSources: [
          promotionSources[0],
          { promotionId: promotion2025, captureIds: [captures[0].captureId] },
        ],
      })
    ).toThrow(/source capture/i);
    expect(() => create({ canonicalMembers: canonicalMembers.slice(1) })).toThrow(
      /canonical member/i
    );
    expect(() =>
      create({
        canonicalMembers: [
          ...canonicalMembers,
          {
            recordKind: 'transfer',
            canonicalRecordId: `event-asset-version:${sha('a')}`,
            canonicalRecordSha256: sha('b'),
          },
        ],
      })
    ).toThrow(/canonical member/i);
    expect(() =>
      create({
        promotionSources: [
          ...promotionSources,
          {
            promotionId: `external-canonical-promotion:${sha('e')}`,
            captureIds: [captures[0].captureId],
          },
        ],
      })
    ).toThrow(/promotion/i);
    expect(() =>
      create({
        promotionSources: [
          promotionSources[0],
          { promotionId: promotion2025, captureIds: [captures[0].captureId] },
        ],
      })
    ).toThrow(/source capture/i);
  });

  it('rejects scope, chronology, and content-address substitutions', () => {
    expect(() => create({ effectiveThrough: '2026-08-10T00:00:03.001Z' })).toThrow(/cutoff/i);
    expect(() => create({ createdAt: '2026-08-09T23:59:59.000Z' })).toThrow(/chronology/i);

    const bundle = create();
    expect(() =>
      parseAflTradePromotionBackedFactualRelease({
        ...bundle.release,
        content: { ...bundle.release.content, competition: 'AFLW' },
      })
    ).toThrow(/content address/i);
    expect(() =>
      parseAflTradePromotionBackedFactualCandidate({
        ...bundle.candidate,
        content: { ...bundle.candidate.content, publicationEligible: true },
      })
    ).toThrow();
  });
});
