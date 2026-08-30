import { describe, expect, it, vi } from 'vitest';

import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeCurrentValuationReconciliationAuthority } from '@/server/aflTradeIntelligence/development/localCurrentValuationReconciliationAuthority';
import { createLocalAflTradeFiveSeasonAflTablesAuthority } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Review';
import { createAflTradeFitzRoyFieldMapSha256 } from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { AflTradeFitzRoyCaptureError } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureRuntime';
import { AflTradeFitzRoyStagingError } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureToStaging';
import {
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES,
  aflTradeCurrentValuationEvidenceOrchestrationResultSchema,
  createAflTradeCurrentValuationEvidenceFactualHandoffKey,
  createAflTradeCurrentValuationEvidenceCoordinator,
} from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { createPostgresAflTradeCurrentValuationEvidenceSourceRuntime } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationEvidenceOrchestration';

const expected = {
  schemaVersion: 'afl-current-valuation-evidence-orchestration-result-v1' as const,
  operationId: `current-valuation-evidence-orchestration-operation:${'a'.repeat(64)}`,
  scopeKey: 'afl-men:2026-trades',
  trigger: 'weekly' as const,
  stableOperationKey: 'refresh-awaiting-review',
  state: 'unavailable' as const,
  stage: 'reviewed_authority' as const,
  cause: 'review_required' as const,
  capturedAt: '2026-08-29T12:00:00.000Z',
  completedAt: '2026-08-29T12:00:00.000Z',
  executionLocation: 'local' as const,
  visibility: 'private' as const,
  environment: 'non_production' as const,
  publicationEligible: false as const,
  publicationProhibited: true as const,
  limitation:
    'Private local non-production evidence orchestration only; human review, public release, production activation, and publication authority are not granted.' as const,
};

describe('current valuation evidence orchestration', () => {
  it('authenticates exact retained unavailable outcomes without publication authority', () => {
    const unavailable = {
      ...expected,
      operationId: `current-valuation-evidence-orchestration-operation:${'b'.repeat(64)}`,
      stableOperationKey: 'refresh-capture-authority-missing',
      stage: 'capture_authority' as const,
      cause: 'missing' as const,
    };

    expect(aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse(unavailable)).toEqual(
      unavailable
    );
  });

  it('retains reviewed-authority failures that do not request a new human decision', () => {
    const stale = {
      ...expected,
      operationId: `current-valuation-evidence-orchestration-operation:${'9'.repeat(64)}`,
      stableOperationKey: 'refresh-reviewed-authority-stale',
      cause: 'stale' as const,
    };

    expect(aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse(stale)).toEqual(stale);
  });

  it('authenticates a completed private factual handoff without granting publication', () => {
    const completed = {
      ...expected,
      operationId: `current-valuation-evidence-orchestration-operation:${'c'.repeat(64)}`,
      stableOperationKey: 'refresh-private-factual-complete',
      state: 'complete' as const,
      stage: 'private_factual_authority' as const,
      cause: undefined,
      currentValuationRefresh: {
        schemaVersion: 'afl-current-valuation-refresh-result-v2' as const,
        operationId: `current-valuation-factual-refresh-operation:${'d'.repeat(64)}`,
        scopeKey: expected.scopeKey,
        trigger: expected.trigger,
        stableOperationKey: createAflTradeCurrentValuationEvidenceFactualHandoffKey({
          scopeKey: expected.scopeKey,
          trigger: expected.trigger,
          stableOperationKey: 'refresh-private-factual-complete',
        }),
        state: 'factual_refresh_complete' as const,
        factualStage: 'advanced' as const,
        privateFactualAuthority: {
          valuationScopeKey: expected.scopeKey,
          candidateId: `private-factual-candidate:${'e'.repeat(64)}`,
          evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
          evidenceBundleId: `private-reviewed-evidence-bundle:${'f'.repeat(64)}`,
          reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${'1'.repeat(64)}`,
          normalizedReconciledCustodySha256: '2'.repeat(64),
          revision: 1,
        },
        capturedAt: expected.capturedAt,
        completedAt: expected.completedAt,
        executionLocation: 'local' as const,
        visibility: 'private' as const,
        environment: 'non_production' as const,
        publicationEligible: false as const,
        publicationProhibited: true as const,
        limitation:
          'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.' as const,
      },
    };

    expect(aflTradeCurrentValuationEvidenceOrchestrationResultSchema.parse(completed)).toEqual(
      completed
    );
  });

  it('resumes retained normalized sources and stops before a human review decision', async () => {
    const request = {
      scopeKey: expected.scopeKey,
      trigger: expected.trigger,
      stableOperationKey: expected.stableOperationKey,
    };
    let terminalResult: typeof expected | null = null;
    const retainedSourceKeys = [AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!.sourceKey];
    const loadOperation = vi.fn(async () => ({ terminalResult, retainedSourceKeys }));
    const retainNormalizedSource = vi.fn(async ({ sourceKey }: { sourceKey: string }) => {
      retainedSourceKeys.push(sourceKey);
    });
    const retainUnavailable = vi.fn(async () => {
      terminalResult = expected;
      return expected;
    });
    const ensureCurrent = vi.fn(async (source: { sourceKey: string }) => ({
      state: 'ready' as const,
      sourceKey: source.sourceKey,
      observedCaptureId: `observed-source-capture:${source.sourceKey}`,
      effectiveCaptureId: `effective-source-capture:${source.sourceKey}`,
      normalizationRunId: `provider-normalization-run:${source.sourceKey}`,
    }));
    const assessCurrent = vi.fn(async () => ({
      state: 'unavailable' as const,
      stage: 'reviewed_authority' as const,
      cause: 'review_required' as const,
    }));
    const refreshCurrent = vi.fn(async () => {
      throw new Error('Factual refresh must not run before human review.');
    });
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: {
        loadOperation,
        retainNormalizedSource,
        retainUnavailable,
        retainComplete: vi.fn(),
      },
      source: { ensureCurrent },
      reconciliationAuthority: { assessCurrent: async () => ({ state: 'ready' }) },
      reviewedAuthority: { assessCurrent },
      factualRefresh: { refreshCurrent },
    });
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(expected);
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(expected);

    expect(ensureCurrent.mock.calls.map(([source]) => source.sourceKey)).toEqual(
      AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.slice(1).map(({ sourceKey }) => sourceKey)
    );
    expect(ensureCurrent.mock.calls.map(([, retainedRequest]) => retainedRequest)).toEqual(
      Array(6).fill(request)
    );
    expect(retainNormalizedSource).toHaveBeenCalledTimes(6);
    expect(assessCurrent).toHaveBeenCalledOnce();
    expect(retainUnavailable).toHaveBeenCalledWith(request, {
      stage: 'reviewed_authority',
      cause: 'review_required',
    });
    expect(refreshCurrent).not.toHaveBeenCalled();
  });

  it('stops at the retained reconciliation boundary before assessing the reviewed head', async () => {
    const reconciliationUnavailable = {
      ...expected,
      operationId: `current-valuation-evidence-orchestration-operation:${'8'.repeat(64)}`,
      stableOperationKey: 'refresh-awaiting-reconciliation-review',
      stage: 'reconciliation_authority' as const,
      cause: 'missing' as const,
    };
    const retainUnavailable = vi.fn(async () => reconciliationUnavailable);
    const reviewedAssessment = vi.fn();
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: {
        loadOperation: async () => ({
          terminalResult: null,
          retainedSourceKeys: AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(
            ({ sourceKey }) => sourceKey
          ),
        }),
        retainNormalizedSource: vi.fn(),
        retainUnavailable,
        retainComplete: vi.fn(),
      },
      source: { ensureCurrent: vi.fn() },
      reconciliationAuthority: {
        assessCurrent: async () => ({
          state: 'unavailable',
          stage: 'reconciliation_authority',
          cause: 'missing',
        }),
      },
      reviewedAuthority: { assessCurrent: reviewedAssessment },
      factualRefresh: { refreshCurrent: vi.fn() },
    });
    const request = {
      scopeKey: expected.scopeKey,
      trigger: expected.trigger,
      stableOperationKey: reconciliationUnavailable.stableOperationKey,
    };

    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(reconciliationUnavailable);
    expect(retainUnavailable).toHaveBeenCalledWith(request, {
      stage: 'reconciliation_authority',
      cause: 'missing',
    });
    expect(reviewedAssessment).not.toHaveBeenCalled();
  });

  it('retains a reviewed-authority cause when the factual handoff loses its source fence', async () => {
    const retainUnavailable = vi.fn(async () => ({
      ...expected,
      operationId: `current-valuation-evidence-orchestration-operation:${'6'.repeat(64)}`,
      stage: 'reviewed_authority' as const,
      cause: 'stale' as const,
    }));
    const factualUnavailable = {
      schemaVersion: 'afl-current-valuation-refresh-result-v2' as const,
      operationId: `current-valuation-factual-refresh-operation:${'7'.repeat(64)}`,
      scopeKey: expected.scopeKey,
      trigger: expected.trigger,
      stableOperationKey: createAflTradeCurrentValuationEvidenceFactualHandoffKey({
        scopeKey: expected.scopeKey,
        trigger: expected.trigger,
        stableOperationKey: expected.stableOperationKey,
      }),
      state: 'unavailable' as const,
      cause: 'source_authority_stale' as const,
      capturedAt: expected.capturedAt,
      completedAt: expected.completedAt,
      executionLocation: 'local' as const,
      visibility: 'private' as const,
      environment: 'non_production' as const,
      publicationEligible: false as const,
      publicationProhibited: true as const,
      limitation:
        'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.' as const,
    };
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: {
        loadOperation: async () => ({
          terminalResult: null,
          retainedSourceKeys: AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(
            ({ sourceKey }) => sourceKey
          ),
        }),
        retainNormalizedSource: vi.fn(),
        retainUnavailable,
        retainComplete: vi.fn(),
      },
      source: { ensureCurrent: vi.fn() },
      reconciliationAuthority: { assessCurrent: async () => ({ state: 'ready' }) },
      reviewedAuthority: { assessCurrent: async () => ({ state: 'ready' }) },
      factualRefresh: { refreshCurrent: async () => factualUnavailable },
    });

    await coordinator.refreshCurrent({
      scopeKey: expected.scopeKey,
      trigger: expected.trigger,
      stableOperationKey: expected.stableOperationKey,
    });

    expect(retainUnavailable).toHaveBeenCalledWith(
      {
        scopeKey: expected.scopeKey,
        trigger: expected.trigger,
        stableOperationKey: expected.stableOperationKey,
      },
      { stage: 'reviewed_authority', cause: 'stale' }
    );
  });

  it('freshly observes a new operation before reusing equivalent governed normalization', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const request = {
      scopeKey: expected.scopeKey,
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'fresh-observation-equivalent-normalization',
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcome_provider_field_map')) {
        return {
          rows: [
            {
              map_json: authority.fieldMap,
              field_map_sha256: createAflTradeFitzRoyFieldMapSha256(authority.fieldMap),
              approval_decision_id: authority.fieldMap.approvalDecisionId,
              subject_type: 'provider_field_map',
              subject_id: authority.fieldMap.mapId,
              decision: 'approved',
              evidence_json: {
                fieldMapSha256: createAflTradeFitzRoyFieldMapSha256(authority.fieldMap),
              },
              current: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_source_work')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_normalization_claim')) {
        return {
          rows: [
            {
              effective_capture_id: `source-capture:${'3'.repeat(64)}`,
              normalization_run_id: `provider-normalization-run:${'5'.repeat(64)}`,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const capture = vi.fn(async () => ({
      captureId: `source-capture:${'6'.repeat(64)}`,
      sourceContentSha256: '7'.repeat(64),
      snapshot: {} as never,
    }));
    const resumeNormalization = vi.fn();
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: { query } as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      capture,
      resumeNormalization,
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
    });

    await expect(runtime.ensureCurrent(source, request)).resolves.toEqual({
      state: 'ready',
      sourceKey: source.sourceKey,
      observedCaptureId: `source-capture:${'6'.repeat(64)}`,
      effectiveCaptureId: `source-capture:${'3'.repeat(64)}`,
      normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        source,
        request,
        authoritySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(resumeNormalization).not.toHaveBeenCalled();
  });

  it('normalizes changed bytes and retains the winning effective claim', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(authority.fieldMap);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcome_provider_field_map')) {
        return {
          rows: [
            {
              map_json: authority.fieldMap,
              field_map_sha256: fieldMapSha256,
              approval_decision_id: authority.fieldMap.approvalDecisionId,
              subject_type: 'provider_field_map',
              subject_id: authority.fieldMap.mapId,
              decision: 'approved',
              evidence_json: { fieldMapSha256 },
              current: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_source_work')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_normalization_claim')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('claim_outcome_current_valuation_evidence_normalization')) {
        return {
          rows: [
            {
              effective_capture_id: `source-capture:${'6'.repeat(64)}`,
              normalization_run_id: `provider-normalization-run:${'5'.repeat(64)}`,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const resumeNormalization = vi.fn(async () => ({
      state: 'ready' as const,
      sourceKey: source.sourceKey,
      observedCaptureId: `source-capture:${'6'.repeat(64)}`,
      effectiveCaptureId: `source-capture:${'6'.repeat(64)}`,
      normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
    }));
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: { query } as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
      capture: vi.fn(async () => ({
        captureId: `source-capture:${'6'.repeat(64)}`,
        sourceContentSha256: '7'.repeat(64),
        snapshot: {} as never,
      })),
      resumeNormalization,
    });

    await expect(
      runtime.ensureCurrent(source, {
        scopeKey: expected.scopeKey,
        trigger: 'ad_hoc',
        stableOperationKey: 'changed-source-bytes',
      })
    ).resolves.toEqual({
      state: 'ready',
      sourceKey: source.sourceKey,
      observedCaptureId: `source-capture:${'6'.repeat(64)}`,
      effectiveCaptureId: `source-capture:${'6'.repeat(64)}`,
      normalizationRunId: `provider-normalization-run:${'5'.repeat(64)}`,
    });
    expect(resumeNormalization).toHaveBeenCalledOnce();
  });

  it('does not capture or synthesize a missing reviewed field-map decision', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const capture = vi.fn();
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
      capture,
      resumeNormalization: vi.fn(),
    });

    await expect(
      runtime.ensureCurrent(source, {
        scopeKey: expected.scopeKey,
        trigger: 'ad_hoc',
        stableOperationKey: 'missing-field-map-review',
      })
    ).resolves.toEqual({
      state: 'unavailable',
      stage: 'normalization_authority',
      cause: 'missing',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('classifies a superseded reviewed field map as stale authority', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(authority.fieldMap);
    const capture = vi.fn();
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: {
        query: vi.fn(async () => ({
          rows: [
            {
              map_json: authority.fieldMap,
              field_map_sha256: fieldMapSha256,
              approval_decision_id: authority.fieldMap.approvalDecisionId,
              subject_type: 'provider_field_map',
              subject_id: authority.fieldMap.mapId,
              decision: 'approved',
              evidence_json: { fieldMapSha256 },
              current: false,
            },
          ],
          rowCount: 1,
        })),
      } as unknown as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
      capture,
      resumeNormalization: vi.fn(),
    });

    await expect(
      runtime.ensureCurrent(source, {
        scopeKey: expected.scopeKey,
        trigger: 'ad_hoc',
        stableOperationKey: 'superseded-field-map-review',
      })
    ).resolves.toEqual({
      state: 'unavailable',
      stage: 'normalization_authority',
      cause: 'stale',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('classifies malformed reconciliation review-set authority as unauthenticated', async () => {
    const loadReviewedBundle = vi.fn();
    const rows = [
      {
        decision_id: `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}`,
        subject_type: 'local_review_set',
        subject_id: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        decision: 'approved',
        canonical_record_type: 'local_review_set',
        canonical_record_id: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        supersedes_decision_id: null,
        evidence_json: {
          evidenceSetSha256: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        },
        decided_by: 'unexpected-reviewer',
        current: true,
      },
      {
        decision_id: `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
        subject_type: 'local_review_set',
        subject_id: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        decision: 'approved',
        canonical_record_type: 'local_review_set',
        canonical_record_id: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        supersedes_decision_id: null,
        evidence_json: {
          evidenceSetSha256: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        },
        decided_by: 'local-workbook-evidence-reviewer',
        current: true,
      },
    ];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcome_review_decision')) return { rows, rowCount: rows.length };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const authority = createLocalAflTradeCurrentValuationReconciliationAuthority(
      {
        query,
        transaction: async (callback) => callback({ query } as never),
      } as unknown as AflOutcomeSqlClient,
      { loadReviewedBundle }
    );

    await expect(
      authority.assessCurrent({ stableOperationKey: 'review-set-authority-missing' })
    ).resolves.toEqual({
      state: 'unavailable',
      stage: 'reconciliation_authority',
      cause: 'unauthenticated',
    });
    expect(loadReviewedBundle).not.toHaveBeenCalled();
  });

  it('retains provider schema drift as a capture mismatch instead of missing evidence', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcome_provider_field_map')) {
        return {
          rows: [
            {
              map_json: authority.fieldMap,
              field_map_sha256: createAflTradeFitzRoyFieldMapSha256(authority.fieldMap),
              approval_decision_id: authority.fieldMap.approvalDecisionId,
              subject_type: 'provider_field_map',
              subject_id: authority.fieldMap.mapId,
              decision: 'approved',
              evidence_json: {
                fieldMapSha256: createAflTradeFitzRoyFieldMapSha256(authority.fieldMap),
              },
              current: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_source_work')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: { query } as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
      capture: vi.fn(async () => {
        throw new AflTradeFitzRoyCaptureError('SCHEMA_DRIFT', 'Fixture schema drift.');
      }),
      resumeNormalization: vi.fn(),
    });

    await expect(
      runtime.ensureCurrent(source, {
        scopeKey: expected.scopeKey,
        trigger: 'ad_hoc',
        stableOperationKey: 'provider-schema-drift',
      })
    ).resolves.toEqual({
      state: 'unavailable',
      stage: 'capture',
      cause: 'mismatched',
    });
  });

  it('retains failed receipt authority at the normalization-authority boundary', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    const authority = createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM outcome_provider_field_map')) {
        const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(authority.fieldMap);
        return {
          rows: [
            {
              map_json: authority.fieldMap,
              field_map_sha256: fieldMapSha256,
              approval_decision_id: authority.fieldMap.approvalDecisionId,
              subject_type: 'provider_field_map',
              subject_id: authority.fieldMap.mapId,
              decision: 'approved',
              evidence_json: { fieldMapSha256 },
              current: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_source_work')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('load_outcome_current_valuation_evidence_normalization_claim')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const runtime = createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
      client: { query } as AflOutcomeSqlClient,
      gateRepository: {
        resolveAuthorization: vi.fn(async () => ({
          revision: 1,
          ledger: authority.capture.ledger,
          sourceRights: authority.capture.sourceRights,
        })),
      },
      clock: { now: () => '2026-08-29T12:00:00.000Z' },
      normalizationRuntime: {
        dependencyLockSha256: '8'.repeat(64),
        imageDigest: `sha256:${'9'.repeat(64)}`,
      },
      capture: vi.fn(async () => ({
        captureId: `source-capture:${'6'.repeat(64)}`,
        sourceContentSha256: '7'.repeat(64),
        snapshot: {} as never,
      })),
      resumeNormalization: vi.fn(async () => {
        throw new AflTradeFitzRoyStagingError(
          'AUTHORITY_INVALID',
          'Retained egress receipt failed authentication.'
        );
      }),
    });

    await expect(
      runtime.ensureCurrent(source, {
        scopeKey: expected.scopeKey,
        trigger: 'ad_hoc',
        stableOperationKey: 'failed-normalization-receipt-authority',
      })
    ).resolves.toEqual({
      state: 'unavailable',
      stage: 'normalization_authority',
      cause: 'unauthenticated',
    });
  });
});
