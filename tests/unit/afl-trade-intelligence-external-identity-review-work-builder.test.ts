import { describe, expect, it } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { buildAflTradeExternalIdentityReviewPackage } from '@/server/aflTradeIntelligence/source/externalIdentityReviewWorkBuilder';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';

const sha = (character: string) => character.repeat(64);

function batch(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string,
  claims: AflTradeExternalEvidenceContent['claim'][]
) {
  const capture = {
    captureId: `source-capture:${sha(suffix)}`,
    artifactId: `artifact:${sha(suffix)}`,
    contentSha256: sha(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/${provider}/2025`,
    capturedAt: '2026-08-10T00:00:02.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: sha('f'),
  } as const;
  const evidence = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence,
    finalizedAt: '2026-08-10T00:00:03.000Z',
    publicationEligible: false,
  });
}

const draftguru = batch('draftguru', 'a', [
  {
    kind: 'transaction',
    nativeEventId: '2025-example-trade',
    seasonYear: 2025,
    occurredOn: '2025-10-15',
    transactionType: 'trade',
    title: 'Example trade',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-example-trade',
    nativePartyId: 'western-bulldogs',
    club: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-example-trade',
    nativeTransferId: 'player-14',
    fromClub: { nativeId: 'club-gws', recordedName: 'GWS' },
    toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
    asset: {
      kind: 'player',
      player: { nativeId: 'player-14', recordedName: 'Harry Kyle' },
    },
  },
  {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: 'player-14', recordedName: 'H. Kyle' },
    selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
  },
]);

function sourceAuthority(sourceBatches = [draftguru]) {
  const batchIds = sourceBatches.map(({ batchId }) => batchId).sort();
  return createAflTradeHistoricalCompletionReconciliationAuthority({
    schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
    kind: 'historical_plan_completion',
    completionId: `external-historical-capture-completion:${sha('1')}`,
    completionSha256: sha('1'),
    planId: `external-historical-capture-plan:${sha('2')}`,
    planSha256: sha('2'),
    targetSetSha256: sha('3'),
    resultSetSha256: sha('4'),
    completionSourceBatchSetSha256: sha256AflTradeCanonicalJson(batchIds),
    candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(batchIds),
    completedAt: '2026-08-10T00:00:04.000Z',
  });
}

describe('external identity review work builder', () => {
  it('enumerates the exact provider identities without merging distinct source scopes', () => {
    const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
      environment: 'test_fixture',
      competition: 'AFLM',
      sourceAuthority: sourceAuthority(),
      sourceBatches: [draftguru],
    });

    const items = reviewPackage.content.items.map(({ workItem }) => workItem.content);
    expect(items).toHaveLength(3);
    expect(
      items.find(({ subject }) => subject.content.entityKind === 'player')?.observedNames
    ).toEqual(['H. Kyle', 'Harry Kyle']);
    expect(
      items.find(
        ({ subject }) =>
          subject.content.identityScope.kind === 'exact_recorded_name' &&
          subject.content.identityScope.recordedName === 'Western Bulldogs'
      )?.observations
    ).toHaveLength(3);
    expect(
      items.find(
        ({ subject }) =>
          subject.content.identityScope.kind === 'provider_native_id' &&
          subject.content.identityScope.nativeId === 'club-gws'
      )
    ).toBeDefined();
  });

  it('rejects a trade identity whose event has no explicit transaction season', () => {
    const incomplete = batch('draftguru', 'b', [
      {
        kind: 'transaction_party',
        nativeEventId: '2025-missing-transaction',
        nativePartyId: 'gws',
        club: { nativeId: null, recordedName: 'GWS' },
      },
    ]);

    expect(() =>
      buildAflTradeExternalIdentityReviewPackage({
        environment: 'test_fixture',
        competition: 'AFLM',
        sourceAuthority: sourceAuthority([incomplete]),
        sourceBatches: [incomplete],
      })
    ).toThrow(/transaction season/i);
  });

  it('rejects substituted completion membership', () => {
    expect(() =>
      buildAflTradeExternalIdentityReviewPackage({
        environment: 'test_fixture',
        competition: 'AFLM',
        sourceAuthority: sourceAuthority(),
        sourceBatches: [
          batch(
            'draftguru',
            'c',
            draftguru.content.evidence.map((row) => row.content.claim)
          ),
        ],
      })
    ).toThrow(/source batches/i);
  });
});
