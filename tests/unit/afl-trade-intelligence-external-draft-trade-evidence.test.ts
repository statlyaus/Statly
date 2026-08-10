import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  parseAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';

const digest = (character: string) => character.repeat(64);

const capture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.draftguru.com.au/trades/2025-trade-1',
  capturedAt: '2026-08-09T01:00:00.000Z',
  effectiveAt: '2025-10-08T00:00:00.000Z',
  parserVersion: 'draftguru-trade-parser/v1',
  fieldManifestSha256: digest('3'),
} as const;

function transactionEnvelope() {
  return createAflTradeExternalEvidenceEnvelope({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
    provider: 'draftguru',
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'trade-2025-1' },
    claim: {
      kind: 'transaction',
      nativeEventId: 'trade-2025-1',
      seasonYear: 2025,
      occurredOn: '2025-10-08',
      transactionType: 'trade',
      title: 'Trade for player',
    },
    publicationEligible: false,
  });
}

describe('external AFL draft and trade evidence contracts', () => {
  it('content-addresses provider-native transaction and directed-transfer claims', () => {
    const transaction = transactionEnvelope();
    const transfer = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'draftguru',
      capture,
      sourceRow: { ordinal: 2, sourceKey: 'trade-2025-1:asset-1' },
      claim: {
        kind: 'directed_transfer',
        nativeEventId: 'trade-2025-1',
        nativeTransferId: 'asset-1',
        fromClub: { nativeId: null, recordedName: 'GWS' },
        toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
        asset: {
          kind: 'current_pick',
          draftYear: 2025,
          draftType: 'national',
          recordedPickNumber: 14,
        },
      },
      publicationEligible: false,
    });

    expect(transaction.evidenceId).toMatch(/^external-evidence:[a-f0-9]{64}$/);
    expect(transfer.content.claim.kind).toBe('directed_transfer');
    expect(transfer.content.publicationEligible).toBe(false);
  });

  it('keeps full-draft selections and official current-order custody as different facts', () => {
    const selection = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'footywire',
      capture: {
        ...capture,
        sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts',
        parserVersion: 'footywire-full-draft-parser/v1',
      },
      sourceRow: { ordinal: 14, sourceKey: '2025:national:14' },
      claim: {
        kind: 'draft_selection',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        player: { nativeId: null, recordedName: 'Harry Kyle' },
        selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
      },
      publicationEligible: false,
    });
    const custody = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'official_afl',
      capture: {
        ...capture,
        sourceUrl: 'https://www.afl.com.au/draft/draft-order',
        parserVersion: 'official-afl-current-order-parser/v1',
      },
      sourceRow: { ordinal: 1, sourceKey: '2026:national:1' },
      claim: {
        kind: 'pick_custody',
        observedAt: '2026-08-09T01:00:00.000Z',
        draftYear: 2026,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 1,
        originalClub: { nativeId: null, recordedName: 'Club A' },
        currentClub: { nativeId: null, recordedName: 'Club B' },
      },
      publicationEligible: false,
    });

    expect(selection.content.claim.kind).toBe('draft_selection');
    expect(custody.content.claim.kind).toBe('pick_custody');
  });

  it('preserves unknown original club and round on point-in-time custody evidence', () => {
    const custody = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'official_afl',
      capture: {
        ...capture,
        sourceUrl: 'https://www.afl.com.au/news/1542355/example/amp',
        parserVersion: 'official-afl-current-order-parser/v1',
      },
      sourceRow: { ordinal: 1, sourceKey: '2026:national:1' },
      claim: {
        kind: 'pick_custody',
        observedAt: '2026-08-09T01:00:00.000Z',
        draftYear: 2026,
        draftType: 'national',
        roundNumber: null,
        recordedPickNumber: 1,
        originalClub: null,
        currentClub: { nativeId: null, recordedName: 'Essendon' },
      },
      publicationEligible: false,
    });

    expect(custody.content.claim).toEqual(
      expect.objectContaining({ roundNumber: null, originalClub: null })
    );
  });

  it('admits fitzRoy player-detail evidence only as draft corroboration', () => {
    const evidence = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'fitzroy_official_afl_player_details',
      capture: {
        ...capture,
        mediaType: 'application/x-r-rds',
        sourceUrl: 'fitzroy://fetch_player_details_afl',
        parserVersion: 'fitzroy-player-details-normalizer/v1',
      },
      sourceRow: { ordinal: 1, sourceKey: 'official-afl-player-1:2025' },
      claim: {
        kind: 'player_draft_detail',
        player: { nativeId: 'official-afl-player-1', recordedName: 'Harry Kyle' },
        squadSeason: 2025,
        squadClub: { nativeId: null, recordedName: 'Western Bulldogs' },
        draftYear: 2025,
        draftType: 'national',
        draftPosition: 14,
        recruitedFrom: 'Talent pathway club',
      },
      publicationEligible: false,
    });

    expect(evidence.content.claim.kind).toBe('player_draft_detail');
  });

  it('rejects derived grades, games and pick values at the source boundary', () => {
    expect(() =>
      parseAflTradeExternalEvidenceEnvelope({
        ...transactionEnvelope(),
        content: {
          ...transactionEnvelope().content,
          claim: {
            ...transactionEnvelope().content.claim,
            grade: 'A',
            games: 50,
            pickValue: 66.83,
          },
        },
      })
    ).toThrow();
  });

  it('rejects provider-kind mismatches and transfers without distinct sides', () => {
    expect(() =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'footywire',
        capture,
        sourceRow: { ordinal: 1, sourceKey: 'trade-1' },
        claim: {
          kind: 'transaction',
          nativeEventId: 'trade-1',
          seasonYear: 2025,
          occurredOn: '2025-10-08',
          transactionType: 'trade',
          title: null,
        },
        publicationEligible: false,
      })
    ).toThrow(/provider/i);

    expect(() =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture,
        sourceRow: { ordinal: 2, sourceKey: 'trade-1:asset-1' },
        claim: {
          kind: 'directed_transfer',
          nativeEventId: 'trade-1',
          nativeTransferId: 'asset-1',
          fromClub: { nativeId: 'club-1', recordedName: 'Club' },
          toClub: { nativeId: 'club-1', recordedName: 'Club' },
          asset: {
            kind: 'future_pick',
            draftYear: 2026,
            draftType: 'national',
            roundNumber: 1,
            originalClub: { nativeId: null, recordedName: 'Club' },
          },
        },
        publicationEligible: false,
      })
    ).toThrow(/distinct/i);
  });

  it('seals complete, sorted, unique source-row accounting', () => {
    const first = transactionEnvelope();
    const second = createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider: 'draftguru',
      capture,
      sourceRow: { ordinal: 2, sourceKey: 'trade-2025-2' },
      claim: {
        kind: 'transaction',
        nativeEventId: 'trade-2025-2',
        seasonYear: 2025,
        occurredOn: null,
        transactionType: 'trade',
        title: null,
      },
      publicationEligible: false,
    });
    const batch = createAflTradeExternalEvidenceBatch({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
      provider: 'draftguru',
      captureId: capture.captureId,
      evidence: [first, second],
      finalizedAt: '2026-08-09T01:01:00.000Z',
      publicationEligible: false,
    });

    expect(batch.content.rowCount).toBe(2);
    expect(batch.content.rowSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(batch.batchId).toMatch(/^external-evidence-batch:[a-f0-9]{64}$/);

    expect(() =>
      createAflTradeExternalEvidenceBatch({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
        provider: 'draftguru',
        captureId: capture.captureId,
        evidence: [second, first],
        finalizedAt: '2026-08-09T01:01:00.000Z',
        publicationEligible: false,
      })
    ).toThrow(/ordered/i);
  });
});
