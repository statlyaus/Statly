import { describe, expect, it, vi } from 'vitest';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import { buildAndPersistAflTradeExternalReconciliation } from '@/server/aflTradeIntelligence/source/externalReconciliationCommand';
import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import type { PersistAflTradeExternalReconciliationInput } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { runAflTradeExternalReconciliationCommand } from '../../Scripts/reconcile-external-draft-trade-evidence';

const digest = (character: string) => character.repeat(64);

function unresolvedDraftBatch() {
  const capture = {
    captureId: `source-capture:${digest('a')}`,
    artifactId: `artifact:${digest('b')}`,
    contentSha256: digest('b'),
    mediaType: 'text/html' as const,
    sourceUrl: 'https://www.draftguru.com.au/years/2025',
    capturedAt: '2026-08-09T04:00:00.000Z',
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'draftguru-year/v1',
    fieldManifestSha256: digest('c'),
  };
  const evidence = createAflTradeExternalEvidenceEnvelope({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
    provider: 'draftguru',
    capture,
    sourceRow: { ordinal: 1, sourceKey: 'national:14' },
    claim: {
      kind: 'draft_selection',
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
      roundNumber: 1,
      player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' },
      selectedByClub: {
        nativeId: 'western-bulldogs',
        recordedName: 'Western Bulldogs',
      },
    },
    publicationEligible: false,
  });
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: [evidence],
    finalizedAt: capture.capturedAt,
    publicationEligible: false,
  });
}

describe('external reconciliation command boundary', () => {
  it('builds and persists an immutable review candidate without publishing unresolved facts', async () => {
    const persistCandidate = vi.fn(
      async ({ candidate }: PersistAflTradeExternalReconciliationInput) => ({
        candidateId: parseAflTradeExternalReconciliationCandidate(candidate).candidateId,
        status: 'finalized' as const,
        blockingIssueCount: 2,
        idempotentReplay: false,
      })
    );

    const result = await buildAndPersistAflTradeExternalReconciliation(
      {
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        reconciledAt: '2026-08-09T05:00:00.000Z',
        sourceBatches: [unresolvedDraftBatch()],
        identityResolutions: [],
      },
      {
        repository: { persistCandidate },
      }
    );

    expect(result).toMatchObject({
      status: 'finalized',
      blockingIssueCount: 2,
      idempotentReplay: false,
      publicationEligible: false,
    });
    expect(persistCandidate).toHaveBeenCalledOnce();
    expect(persistCandidate.mock.calls[0]?.[0]).toMatchObject({
      identityResolutions: [],
      candidate: {
        candidateId: result.candidateId,
        content: {
          reconciledAt: '2026-08-09T05:00:00.000Z',
          publicationEligible: false,
          issues: [
            expect.objectContaining({ code: 'identity_unresolved', severity: 'blocking' }),
            expect.objectContaining({ code: 'identity_unresolved', severity: 'blocking' }),
          ],
        },
      },
    });
  });

  it('derives the same candidate identity from an exact reviewed replay', async () => {
    const candidateIds: string[] = [];
    const repository = {
      persistCandidate: vi.fn(async ({ candidate }: PersistAflTradeExternalReconciliationInput) => {
        const parsedCandidate = parseAflTradeExternalReconciliationCandidate(candidate);
        candidateIds.push(parsedCandidate.candidateId);
        return {
          candidateId: parsedCandidate.candidateId,
          status: 'finalized' as const,
          blockingIssueCount: 2,
          idempotentReplay: candidateIds.length > 1,
        };
      }),
    };
    const reviewedInput = {
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      reconciledAt: '2026-08-09T05:00:00.000Z',
      sourceBatches: [unresolvedDraftBatch()],
      identityResolutions: [],
    };

    await buildAndPersistAflTradeExternalReconciliation(reviewedInput, { repository });
    const replay = await buildAndPersistAflTradeExternalReconciliation(reviewedInput, {
      repository,
    });

    expect(candidateIds).toHaveLength(2);
    expect(new Set(candidateIds).size).toBe(1);
    expect(replay.idempotentReplay).toBe(true);
  });

  it('runs from reviewed JSON against the isolated outcomes connection and closes it', async () => {
    const batch = unresolvedDraftBatch();
    const close = vi.fn(async () => undefined);
    const persistCandidate = vi.fn(
      async ({ candidate }: PersistAflTradeExternalReconciliationInput) => ({
        candidateId: parseAflTradeExternalReconciliationCandidate(candidate).candidateId,
        status: 'finalized' as const,
        blockingIssueCount: 2,
        idempotentReplay: true,
      })
    );
    const output: string[] = [];

    const result = await runAflTradeExternalReconciliationCommand(
      {
        argv: ['--input', '/reviewed/reconciliation.json'],
        env: { AFL_OUTCOMES_DATABASE_URL: 'postgresql://fixture.invalid/outcomes' },
      },
      {
        readFile: async () =>
          JSON.stringify({
            environment: 'test_fixture',
            competition: 'AFLM',
            anchorSeasonYear: 2025,
            reconciledAt: '2026-08-09T05:00:00.000Z',
            sourceBatches: [batch],
            identityResolutions: [],
          }),
        connect: async () => ({ repository: { persistCandidate }, close }),
        writeOutput: (line) => output.push(line),
      }
    );

    expect(result).toMatchObject({
      status: 'finalized',
      blockingIssueCount: 2,
      idempotentReplay: true,
      publicationEligible: false,
    });
    expect(JSON.parse(output[0] ?? '{}')).toEqual(result);
    expect(close).toHaveBeenCalledOnce();
  });
});
