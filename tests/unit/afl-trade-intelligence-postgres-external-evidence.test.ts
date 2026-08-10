import { describe, expect, it } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { PostgresAflTradeExternalEvidenceRepository } from '@/server/aflTradeIntelligence/source/postgresExternalEvidenceRepository';

const digest = (character: string) => character.repeat(64);
const captureId = `source-capture:${digest('1')}`;
const capturedAt = '2026-08-09T01:00:00.000Z';
const evidence = createAflTradeExternalEvidenceEnvelope({
  schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  provider: 'footywire',
  capture: {
    captureId,
    artifactId: `artifact:${digest('2')}`,
    contentSha256: digest('2'),
    mediaType: 'text/html; charset=utf-8',
    sourceUrl: 'https://www.footywire.com/afl/footy/ft_drafts?year=2025&t=N',
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'footywire-draft-parser/v1',
    fieldManifestSha256: digest('3'),
  },
  sourceRow: { ordinal: 1, sourceKey: '2025:national:14' },
  claim: {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: 'pp-sydney-swans--harry-kyle', recordedName: 'Harry Kyle' },
    selectedByClub: { nativeId: 'th-sydney-swans', recordedName: 'Sydney' },
  },
  publicationEligible: false,
});
const batch = createAflTradeExternalEvidenceBatch({
  schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  provider: 'footywire',
  captureId,
  evidence: [evidence],
  finalizedAt: '2026-08-09T01:01:00.000Z',
  publicationEligible: false,
});
const issues = [
  { code: 'unsupported_annotation', sourceKey: '2025:national:14', detail: 'Ignored flag.' },
];

function fakeClient(existing = false, provider = 'footywire') {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const query = async (sql: string, parameters: readonly unknown[] = []) => {
    statements.push({ sql, parameters });
    if (sql.includes('FROM outcome_source_capture')) {
      return { rows: [{ provider }], rowCount: 1 };
    }
    if (sql.includes('FROM outcome_external_evidence_batch')) {
      return existing
        ? {
            rows: [{ batch_id: batch.batchId }],
            rowCount: 1,
          }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: sql.startsWith('INSERT') || sql.startsWith('UPDATE') ? 1 : 0 };
  };
  const client: AflOutcomeSqlClient = {
    query: query as AflOutcomeSqlClient['query'],
    async transaction(work) {
      return work({ query: query as AflOutcomeSqlClient['query'] });
    },
  };
  return { client, statements };
}

describe('PostgreSQL external draft/trade evidence staging', () => {
  it('persists an exact batch, rows and issues before finalizing atomically', async () => {
    const fixture = fakeClient();
    const repository = new PostgresAflTradeExternalEvidenceRepository(fixture.client);

    await expect(repository.persist({ batch, issues })).resolves.toEqual({
      batchId: batch.batchId,
      idempotentReplay: false,
    });
    const rowInsert = fixture.statements.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_external_evidence_row')
    );
    const issueInsert = fixture.statements.find(({ sql }) =>
      sql.includes('INSERT INTO outcome_external_evidence_issue')
    );
    expect(rowInsert?.sql).toContain('jsonb_to_recordset');
    expect(JSON.parse(String(rowInsert?.parameters[1]))[0]).toMatchObject({
      evidence_id: evidence.evidenceId,
      source_key: '2025:national:14',
      claim_kind: 'draft_selection',
    });
    expect(JSON.parse(String(issueInsert?.parameters[1]))[0]).toMatchObject({
      issue_id: expect.stringMatching(/^external-evidence-issue:/),
      source_key: '2025:national:14',
      code: 'unsupported_annotation',
    });
    expect(
      fixture.statements.some(
        ({ sql, parameters }) =>
          sql.includes("SET status='finalized'") && parameters.includes(batch.batchId)
      )
    ).toBe(true);
  });

  it('returns exact finalized replay without inserting children', async () => {
    const fixture = fakeClient(true);
    const repository = new PostgresAflTradeExternalEvidenceRepository(fixture.client);

    await expect(repository.persist({ batch, issues })).resolves.toEqual({
      batchId: batch.batchId,
      idempotentReplay: true,
    });
    expect(
      fixture.statements.some(({ sql }) =>
        sql.includes('INSERT INTO outcome_external_evidence_row')
      )
    ).toBe(false);
  });

  it('rejects a source capture from another provider before writes', async () => {
    const fixture = fakeClient(false, 'draftguru');
    const repository = new PostgresAflTradeExternalEvidenceRepository(fixture.client);

    await expect(repository.persist({ batch, issues })).rejects.toThrow(/provider/i);
  });

  it('requires the unexpired execution lease at database finalization', () => {
    const migration = readFileSync(
      'prisma/afl-trade-outcomes/migrations/0010_external_draft_trade_staging/migration.sql',
      'utf8'
    );
    expect(migration).toContain('lease_expires_at <= clock_timestamp()');
    expect(migration).toContain('requires the current unexpired execution lease');
  });
});
import { readFileSync } from 'node:fs';
