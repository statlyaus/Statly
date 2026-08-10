import { describe, expect, it } from 'vitest';

import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import {
  AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_SCHEMA_VERSION,
  createAflTradePromotionBackedFactualLineage,
  parseAflTradePromotionBackedFactualLineage,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';

const sha = (value: string) => value.repeat(64);
const promotionId = `external-canonical-promotion:${sha('a')}`;
const canonicalRecordId = `event-version:${sha('b')}`;

function bundle() {
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
  });
}

describe('promotion-backed factual lineage contracts', () => {
  it('seals the exact private corpus, release, candidate, source, and canonical roots', () => {
    const factual = bundle();
    const lineage = createAflTradePromotionBackedFactualLineage({
      corpus: factual.corpus,
      release: factual.release,
      candidate: factual.candidate,
      createdAt: '2026-08-10T00:00:04.000Z',
    });

    expect(parseAflTradePromotionBackedFactualLineage(lineage)).toEqual(lineage);
    expect(lineage.content.schemaVersion).toBe(
      AFL_TRADE_PROMOTION_BACKED_FACTUAL_LINEAGE_SCHEMA_VERSION
    );
    expect(lineage.content.publicationEligible).toBe(false);
    expect(lineage.content.corpusId).toBe(factual.corpus.corpusId);
    expect(lineage.content.factualReleaseId).toBe(factual.release.releaseId);
    expect(lineage.content.factualCandidateId).toBe(factual.candidate.candidateId);
    expect([lineage.content.validFromSeason, lineage.content.validThroughSeason]).toEqual([
      2025, 2025,
    ]);
    expect(lineage.content.sourceMemberSetSha256).toBe(
      factual.candidate.content.sourceMemberSetSha256
    );
    expect(lineage.content.canonicalMemberSetSha256).toBe(
      factual.candidate.content.canonicalMemberSetSha256
    );
    expect(lineage.content.sourceCaptures).toEqual(factual.release.content.sourceCaptures);
    expect(lineage.content.canonicalMembers).toEqual(factual.release.content.canonicalMembers);
    expect(lineage.lineageId).toMatch(/^corpus-factual-lineage:[a-f0-9]{64}$/);
  });

  it('is deterministic and does not require a future Gate decision in its hash', () => {
    const factual = bundle();
    const input = {
      corpus: factual.corpus,
      release: factual.release,
      candidate: factual.candidate,
      createdAt: '2026-08-10T00:00:04.000Z',
    };

    expect(createAflTradePromotionBackedFactualLineage(input)).toEqual(
      createAflTradePromotionBackedFactualLineage(input)
    );
    expect(JSON.stringify(createAflTradePromotionBackedFactualLineage(input))).not.toContain(
      'gate2DecisionId'
    );
  });

  it('rejects mixed release and candidate ancestry', () => {
    const factual = bundle();
    const other = createAflTradePromotionBackedFactualRelease({
      corpus: factual.corpus,
      scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025:other',
      createdAt: '2026-08-10T00:00:03.000Z',
      effectiveThrough: factual.corpus.content.knowledgeCutoffAt,
      sourceCaptures: factual.release.content.sourceCaptures,
      promotionSources: factual.release.content.promotionSources,
      canonicalMembers: factual.release.content.canonicalMembers.map(
        ({ recordKind, canonicalRecordId, canonicalRecordSha256 }) => ({
          recordKind,
          canonicalRecordId,
          canonicalRecordSha256,
        })
      ),
    });

    expect(() =>
      createAflTradePromotionBackedFactualLineage({
        corpus: factual.corpus,
        release: factual.release,
        candidate: other.candidate,
        createdAt: '2026-08-10T00:00:04.000Z',
      })
    ).toThrow(/candidate|release/i);
  });

  it('rejects pre-finalization chronology and content substitution', () => {
    const factual = bundle();
    expect(() =>
      createAflTradePromotionBackedFactualLineage({
        corpus: factual.corpus,
        release: factual.release,
        candidate: factual.candidate,
        createdAt: '2026-08-10T00:00:02.999Z',
      })
    ).toThrow(/chronology/i);

    const lineage = createAflTradePromotionBackedFactualLineage({
      corpus: factual.corpus,
      release: factual.release,
      candidate: factual.candidate,
      createdAt: '2026-08-10T00:00:04.000Z',
    });
    expect(() =>
      parseAflTradePromotionBackedFactualLineage({
        ...lineage,
        content: { ...lineage.content, canonicalMemberSetSha256: sha('9') },
      })
    ).toThrow(/content address|canonical/i);
  });
});
