import { describe, expect, it } from 'vitest';

import {
  normalizeFitzRoyOfficialAflPlayerDetails,
  parseOfficialAflIndicativeDraftOrder,
} from '@/server/aflTradeIntelligence/source/draftCorroborationAdapter';
import {
  AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
  createDecodedFieldSchemaSha256,
  type AflTradeFitzRoyDecodedTable,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';

const digest = (character: string) => character.repeat(64);
const officialCapture = {
  captureId: `source-capture:${digest('1')}`,
  artifactId: `artifact:${digest('2')}`,
  contentSha256: digest('2'),
  mediaType: 'text/html; charset=utf-8',
  sourceUrl: 'https://www.afl.com.au/news/1542355/example/amp',
  capturedAt: '2026-08-09T01:00:00.000Z',
  effectiveAt: '2026-06-17T00:00:00.000Z',
  parserVersion: 'official-afl-current-order-parser/v1',
  fieldManifestSha256: digest('3'),
} as const;

const fields = [
  'firstName',
  'surname',
  'id',
  'team',
  'season',
  'providerId',
  'draftYear',
  'draftType',
  'draftPosition',
  'recruitedFrom',
].map((name) => ({
  name,
  storageType:
    name === 'season' || name === 'draftYear' || name === 'draftPosition' ? 'integer' : 'character',
  classes: [
    name === 'season' || name === 'draftYear' || name === 'draftPosition' ? 'integer' : 'character',
  ],
  levels: null,
  timezone: null,
}));

const text = (value: string) => ({ kind: 'text' as const, value });
const integer = (value: number) => ({ kind: 'integer' as const, value: String(value) });
const missing = { kind: 'missing' as const };

function decodedTable(rows: AflTradeFitzRoyDecodedTable['rows']): AflTradeFitzRoyDecodedTable {
  return {
    schemaVersion: AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
    captureReceiptSha256: digest('4'),
    capabilityId: 'official-afl-player-details',
    fitzRoyVersion: '1.7.0',
    authorizationCompetition: 'AFLM',
    authorizationSeason: 2025,
    invocationSha256: digest('5'),
    invocationArgumentsSha256: digest('6'),
    diagnosticsSha256: digest('7'),
    sourceRdsSha256: digest('8'),
    sourceSchemaSha256: createDecodedFieldSchemaSha256(fields),
    decoderRuntime: {
      decoderVersion: 'afl-trade-fitzroy-rds-decoder/v1',
      rVersion: '4.5.1',
      dependencyLockSha256: digest('9'),
      imageDigest: `sha256:${digest('a')}`,
    },
    frame: { classes: ['data.frame'], rowNames: rows.map((_row, index) => String(index + 1)) },
    fields,
    rows,
  };
}

describe('draft corroboration adapters', () => {
  it('records official indicative order as point-in-time custody, not a final selection', () => {
    const html = `
      <article>
        <p><strong>2026 INDICATIVE DRAFT ORDER – AFTER ROUND 14</strong></p>
        <p>1.&nbsp; Essendon<br>2. Richmond<br>10. Melbourne (via Gold Coast)</p>
        <p>11. Western Bulldogs</p>
        <p>Unrelated article copy</p>
      </article>`;
    const result = parseOfficialAflIndicativeDraftOrder(html, {
      capture: officialCapture,
      draftYear: 2026,
      observedAt: '2026-06-17T00:00:00.000Z',
    });

    expect(result.issues).toEqual([]);
    expect(result.evidence.map((row) => row.content.claim)).toEqual([
      expect.objectContaining({
        kind: 'pick_custody',
        recordedPickNumber: 1,
        roundNumber: null,
        originalClub: { nativeId: null, recordedName: 'Essendon' },
        currentClub: { nativeId: null, recordedName: 'Essendon' },
      }),
      expect.objectContaining({
        recordedPickNumber: 2,
        originalClub: { nativeId: null, recordedName: 'Richmond' },
      }),
      expect.objectContaining({
        recordedPickNumber: 10,
        originalClub: { nativeId: null, recordedName: 'Gold Coast' },
        currentClub: { nativeId: null, recordedName: 'Melbourne' },
      }),
      expect.objectContaining({ recordedPickNumber: 11 }),
    ]);
    expect(JSON.stringify(result)).not.toContain('draft_selection');
  });

  it('rejects an older order whose body only mentions the requested year incidentally', () => {
    const result = parseOfficialAflIndicativeDraftOrder(
      `<article>
        <p><strong>2024 INDICATIVE DRAFT ORDER – AFTER ROUND 14</strong></p>
        <p>1. Essendon<br>2. Richmond</p>
        <p>Updated competition rules will apply in 2025.</p>
      </article>`,
      {
        capture: officialCapture,
        draftYear: 2025,
        observedAt: '2025-06-17T00:00:00.000Z',
      }
    );

    expect(result.evidence).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_page' }));
  });

  it('keeps current custody while quarantining unsupported order annotations', () => {
    const result = parseOfficialAflIndicativeDraftOrder(
      `<p><strong>2026 INDICATIVE DRAFT ORDER</strong></p><p>1. Gold Coast (priority pick)</p>`,
      {
        capture: officialCapture,
        draftYear: 2026,
        observedAt: '2026-06-17T00:00:00.000Z',
      }
    );

    expect(result.evidence[0]?.content.claim).toEqual(
      expect.objectContaining({
        kind: 'pick_custody',
        originalClub: null,
        currentClub: { nativeId: null, recordedName: 'Gold Coast' },
      })
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unsupported_order_annotation',
        sourceKey: '2026:national:1',
      }),
    ]);
  });

  it('turns official-AFL player details into corroboration with exact provider identity', () => {
    const table = decodedTable([
      [
        text('Harry'),
        text('Kyle'),
        text('internal-14'),
        text('Sydney'),
        integer(2025),
        text('CD_I123456'),
        integer(2025),
        text('nationalDraft'),
        integer(14),
        text('Allies'),
      ],
    ]);
    const result = normalizeFitzRoyOfficialAflPlayerDetails(table, {
      capture: {
        ...officialCapture,
        artifactId: `artifact:${digest('8')}`,
        contentSha256: digest('8'),
        mediaType: 'application/x-r-rds',
        sourceUrl: 'fitzroy://official-afl-player-details/2025',
        parserVersion: 'fitzroy-official-afl-player-details-normalizer/v1',
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.evidence[0]?.content.claim).toEqual({
      kind: 'player_draft_detail',
      player: { nativeId: 'CD_I123456', recordedName: 'Harry Kyle' },
      squadSeason: 2025,
      squadClub: { nativeId: null, recordedName: 'Sydney' },
      draftYear: 2025,
      draftType: 'national',
      draftPosition: 14,
      recruitedFrom: 'Allies',
    });
  });

  it('does not create partial draft triples or infer lineage from squad membership', () => {
    const table = decodedTable([
      [
        text('Unresolved'),
        text('Player'),
        text('internal-1'),
        text('Carlton'),
        integer(2025),
        missing,
        integer(2025),
        missing,
        integer(14),
        missing,
      ],
    ]);
    const result = normalizeFitzRoyOfficialAflPlayerDetails(table, {
      capture: {
        ...officialCapture,
        artifactId: `artifact:${digest('8')}`,
        contentSha256: digest('8'),
        mediaType: 'application/x-r-rds',
        sourceUrl: 'fitzroy://official-afl-player-details/2025',
        parserVersion: 'fitzroy-official-afl-player-details-normalizer/v1',
      },
    });

    expect(result.evidence[0]?.content.claim).toEqual(
      expect.objectContaining({
        kind: 'player_draft_detail',
        player: { nativeId: 'internal-1', recordedName: 'Unresolved Player' },
        draftYear: null,
        draftType: null,
        draftPosition: null,
      })
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'partial_draft_detail', sourceKey: 'row:1' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('directed_transfer');
  });
});
