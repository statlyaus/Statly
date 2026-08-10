import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY,
  AFL_TRADE_ACHIEVEMENT_RECONCILIATION_POLICY_SCHEMA_VERSION,
  AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION,
  createAflTradeAchievementReconciliationPolicy,
  createAflTradeAchievementReconciliationRun,
  createAflTradeReconciledAchievement,
  createAflTradeReconciledAchievementSubjectKey,
} from '@/server/aflTradeIntelligence/outcomes/achievementReconciliationContracts';
import { reconcileAflTradeAchievements } from '@/server/aflTradeIntelligence/outcomes/achievementReconciliationService';
import {
  AflTradeAchievementReconciliationRepositoryError,
  PostgresAflTradeAchievementReconciliationRepository,
} from '@/server/aflTradeIntelligence/outcomes/postgresAchievementReconciliationRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
  AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
  createAflTradeSourceFact,
  type AflTradeSourceFact,
  type AflTradeSourceFactContent,
} from '@/server/aflTradeIntelligence/outcomes/factualObservationContracts';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

const digest = (character: string) => character.repeat(64);

type AchievementSourceFact = Omit<AflTradeSourceFact, 'content'> & {
  content: Extract<AflTradeSourceFactContent, { factKind: 'player_achievement' }>;
};

function isAchievementSourceFact(fact: AflTradeSourceFact): fact is AchievementSourceFact {
  return fact.content.factKind === 'player_achievement';
}

function reference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function playerResolution() {
  const decision = reference('provider-resolution-decision', 'player');
  return {
    mappingScope: 'provider_identity' as const,
    resolutionCaseId: createAflTradeContentAddress('provider-resolution-case', {
      fixture: 'player',
    }),
    revision: 1,
    decision,
    canonicalTargetSnapshot: reference('canonical-target-snapshot', 'player'),
    identityCandidateId: 'identity-candidate:achievement-player',
    playerIdentityId: createAflTradeContentAddress('provider-player-identity', {
      fixture: 'player',
    }),
    playerId: 'afl-player:achievement-player',
    assignment: {
      assignmentCaseId: createAflTradeContentAddress('provider-identity-assignment-case', {
        fixture: 'player',
      }),
      entityKind: 'player' as const,
      revision: 1,
      decisionId: decision.id,
      status: 'active' as const,
    },
  };
}

function achievementFact(evidenceValue = 'Selected in the 2026 team') {
  const normalizationRunId = createAflTradeContentAddress('provider-normalization-run', {
    fixture: 'achievement-run',
  });
  const stagingSha256 = digest('5');
  const finalizedAt = '2026-10-01T00:00:00.000Z';
  const finalizationId = createAflTradeContentAddress('provider-normalization-finalization', {
    normalizationRunId,
    stagingSha256,
    finalizedAt,
  });
  const fact = createAflTradeSourceFact({
    schemaVersion: AFL_TRADE_SOURCE_FACT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_SOURCE_FACT_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    provider: 'official_afl',
    capabilityId: 'official-afl-awards',
    competition: 'AFLM',
    seasonYear: 2026,
    fieldMapSha256: digest('4'),
    effectiveAt: '2026-09-30T00:00:00.000Z',
    recordedAt: '2026-10-01T00:01:00.000Z',
    source: {
      captureId: 'source-capture:achievement',
      normalizationRunId,
      normalizationFinalization: {
        id: finalizationId,
        sha256: finalizationId.slice(finalizationId.indexOf(':') + 1),
      },
      normalizationFinalizedAt: finalizedAt,
      stagingSha256,
      providerDecodedRowId: 'provider-row:achievement',
      sourceRowNumber: 1,
      sourceRowSha256: digest('1'),
      semanticNaturalKeySha256: digest('2'),
      candidateDigests: {
        identity: digest('7'),
        match: null,
        metric: null,
        achievement: digest('8'),
        appearance: null,
      },
      rowStatus: 'staged',
      issueSet: reference('provider-resolution-issue-set', 'achievement'),
      blockingIssueCount: 0,
      openBlockingIssueCount: 0,
      blockingIssueClosures: [],
      consumedSourceFields: ['all_australian', 'player_id'],
    },
    factKind: 'player_achievement',
    achievementCandidateId: 'achievement-candidate:fixture',
    achievementCode: 'all_australian_team',
    achievementDefinition: reference('achievement-definition', 'all-australian-team/v1'),
    achievementGrain: { kind: 'season' },
    player: playerResolution(),
    seasonClubScope: {
      kind: 'reviewed_unattributed',
      club: null,
      reasonCode: 'source_does_not_define_club',
      decision: reference('season-club-scope-decision', 'unattributed'),
    },
    availability: { state: 'affirmed', evidenceValue, reasonCode: null },
  });
  if (!isAchievementSourceFact(fact)) {
    throw new Error('Achievement fixture did not create a player-achievement fact.');
  }
  return fact;
}

function policy() {
  return createAflTradeAchievementReconciliationPolicy({
    schemaVersion: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_POLICY_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    validFromSeason: 2026,
    validThroughSeason: 2026,
    policyVersion: 'achievement-reconciliation/v1',
    rules: [
      {
        achievementCode: 'all_australian_team',
        definition: reference('achievement-definition', 'all-australian-team/v1'),
        sourcePreferences: [
          { priority: 1, provider: 'official_afl', capabilityId: 'official-afl-awards' },
        ],
        selection: 'lowest_priority_tier_with_usable_evidence',
        agreement: 'exact_normalized_evidence_value',
        conflict: 'preserve_same_tier_disagreement',
        absence: 'unavailable_never_negative_achievement',
        inference: 'forbidden',
      },
    ],
    approvedAt: '2026-10-01T00:02:00.000Z',
    approval: reference('achievement-reconciliation-policy-approval', 'v1'),
  });
}

function validRun() {
  const source = achievementFact();
  if (source.content.seasonClubScope.kind !== 'reviewed_unattributed') {
    throw new Error('Achievement fixture did not create an unattributed club scope.');
  }
  const inputSourceFactIds = [source.factId];
  const result = createAflTradeReconciledAchievement({
    schemaVersion: 'afl-trade-reconciled-achievement/v1',
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    seasonYear: 2026,
    playerId: source.content.player.playerId,
    clubScope: {
      kind: 'reviewed_unattributed',
      clubId: null,
      reasonCode: 'source_does_not_define_club',
      decision: source.content.seasonClubScope.decision,
    },
    achievementCode: 'all_australian_team',
    definition: source.content.achievementDefinition,
    grain: { kind: 'season' },
    availability: {
      state: 'affirmed',
      evidenceValue: 'Selected in the 2026 team',
      inputSourceFactIds,
      selectedSourceFactIds: inputSourceFactIds,
      reasonCode: null,
    },
    effectiveAt: '2026-09-30T00:00:00.000Z',
    effectiveThrough: '2026-09-30T23:59:59.000Z',
    recordedAt: '2026-10-01T00:03:00.000Z',
  });
  const selectedPolicy = policy();
  const sourceMemberships = [
    { ordinal: 1, fact: source, factSha256: source.factId.slice('source-fact:'.length) },
  ];
  const results = [result];
  const subjectKey = createAflTradeReconciledAchievementSubjectKey({
    environment: result.content.environment,
    competition: result.content.competition,
    seasonYear: result.content.seasonYear,
    playerId: result.content.playerId,
    clubScope: result.content.clubScope,
    achievementCode: result.content.achievementCode,
    grain: result.content.grain,
  });
  const content = {
    schemaVersion: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_RUN_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_ACHIEVEMENT_RECONCILIATION_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    policyId: selectedPolicy.policyId,
    policySha256: selectedPolicy.policySha256,
    sourceMemberships,
    sourceSetSha256: sha256AflTradeCanonicalJson(sourceMemberships),
    results,
    resultSetSha256: sha256AflTradeCanonicalJson(results),
    headAdvances: [
      {
        subjectKey,
        expectedRevision: 0,
        revision: 1,
        reconciledAchievementId: result.reconciledAchievementId,
      },
    ],
    counts: {
      sourceFacts: 1,
      results: 1,
      affirmed: 1,
      conflicting: 0,
      unavailable: 0,
      quarantined: 0,
      notApplicable: 0,
    },
    startedAt: '2026-10-01T00:02:00.000Z',
    completedAt: '2026-10-01T00:04:00.000Z',
  };
  return { source, result, content };
}

function runFromService() {
  return reconcileAflTradeAchievements({
    policy: policy(),
    sourceFacts: [achievementFact()],
    expectedHeadRevisions: {},
    startedAt: '2026-10-01T00:02:00.000Z',
    completedAt: '2026-10-01T00:04:00.000Z',
  });
}

function fakeSqlClient(
  options: { replay?: ReturnType<typeof runFromService>; stale?: boolean } = {}
) {
  const statements: string[] = [];
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
      statements.push(sql);
      if (sql.includes('SELECT policy_id FROM outcome_achievement_reconciliation_policy')) {
        return { rows: [{ policy_id: policy().policyId }] as Row[], rowCount: 1 };
      }
      if (sql.includes('SELECT run_sha256,receipt_json,finalized_at,status')) {
        const replay = options.replay;
        return replay
          ? {
              rows: [
                {
                  run_sha256: replay.runSha256,
                  receipt_json: replay,
                  finalized_at: replay.content.completedAt,
                  status: 'approved',
                },
              ] as Row[],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO outcome_reconciled_achievement_head')) {
        return { rows: [], rowCount: options.stale ? 0 : 1 };
      }
      if (sql.includes('UPDATE outcome_achievement_reconciliation_run')) {
        return {
          rows: [{ finalized_at: '2026-10-01T00:04:00.000Z' }] as Row[],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
    async transaction<T>(work: (transaction: AflOutcomeSqlClient) => Promise<T>): Promise<T> {
      return work(client);
    },
  };
  return { client, statements };
}

describe('AFL trade achievement reconciliation contracts', () => {
  it('creates a deterministic canonical achievement and run without numeric aggregation', () => {
    const { content } = validRun();
    const run = createAflTradeAchievementReconciliationRun(content);
    expect(createAflTradeAchievementReconciliationRun(structuredClone(content))).toEqual(run);
    expect(run.content.results[0].content.availability.state).toBe('affirmed');
    expect(JSON.stringify(run)).not.toContain('numericValue');
  });

  it('rejects stale current-head revisions', () => {
    const { content } = validRun();
    expect(() =>
      createAflTradeAchievementReconciliationRun({
        ...content,
        headAdvances: [{ ...content.headAdvances[0], revision: 2 }],
      })
    ).toThrow();
  });

  it('rejects unconsumed and mixed-subject source evidence', () => {
    const { content, source } = validRun();
    expect(() =>
      createAflTradeAchievementReconciliationRun({
        ...content,
        results: [
          {
            ...content.results[0],
            content: {
              ...content.results[0].content,
              playerId: 'afl-player:other',
            },
          },
        ],
      })
    ).toThrow();
    expect(() =>
      createAflTradeAchievementReconciliationRun({
        ...content,
        sourceMemberships: [
          ...content.sourceMemberships,
          { ordinal: 2, fact: source, factSha256: source.factId.slice('source-fact:'.length) },
        ],
      })
    ).toThrow();
  });

  it('rejects inferred or numeric-shaped achievements', () => {
    const { result } = validRun();
    expect(() =>
      createAflTradeReconciledAchievement({
        ...result.content,
        availability: {
          state: 'unavailable',
          evidenceValue: 0,
          inputSourceFactIds: result.content.availability.inputSourceFactIds,
          selectedSourceFactIds: [],
          reasonCode: 'no_usable_approved_source',
        },
      } as never)
    ).toThrow();
  });

  it('rejects a selected fact whose evidence disagrees with the canonical value', () => {
    const { content } = validRun();
    const changed = structuredClone(content);
    changed.results[0].content.availability.evidenceValue = 'Different evidence';
    changed.resultSetSha256 = sha256AflTradeCanonicalJson(changed.results);
    expect(() => createAflTradeAchievementReconciliationRun(changed)).toThrow();
  });

  it('selects affirmed evidence without inventing a numeric award value', () => {
    const run = reconcileAflTradeAchievements({
      policy: policy(),
      sourceFacts: [achievementFact()],
      expectedHeadRevisions: {},
      startedAt: '2026-10-01T00:02:00.000Z',
      completedAt: '2026-10-01T00:04:00.000Z',
    });
    expect(run.content.results[0].content.availability).toMatchObject({
      state: 'affirmed',
      evidenceValue: 'Selected in the 2026 team',
    });
    expect(run.content.headAdvances[0]).toMatchObject({ expectedRevision: 0, revision: 1 });
    expect(JSON.stringify(run)).not.toContain('numericValue');
  });

  it('preserves same-tier achievement disagreement as a conflict', () => {
    const run = reconcileAflTradeAchievements({
      policy: policy(),
      sourceFacts: [achievementFact(), achievementFact('Named only in the squad')],
      expectedHeadRevisions: {},
      startedAt: '2026-10-01T00:02:00.000Z',
      completedAt: '2026-10-01T00:04:00.000Z',
    });
    expect(run.content.results[0].content.availability).toMatchObject({
      state: 'conflicting',
      evidenceValue: null,
      reasonCode: 'same_priority_sources_disagree',
    });
    expect(run.content.counts.conflicting).toBe(1);
  });

  it('persists a complete private run without touching release or fantasy tables', async () => {
    const database = fakeSqlClient();
    const repository = new PostgresAflTradeAchievementReconciliationRepository(database.client);
    await expect(repository.persistRun(runFromService())).resolves.toMatchObject({
      idempotentReplay: false,
    });
    const sql = database.statements.join('\n').toLowerCase();
    expect(sql).toContain('outcome_reconciled_achievement_member');
    expect(sql).toContain('outcome_reconciled_achievement_head');
    expect(sql).not.toMatch(
      /outcome_registry|outcome_active_release|outcome_projection|valuation|fantasy|user_id|league_id/
    );
  });

  it('returns an exact finalized replay without creating children', async () => {
    const run = runFromService();
    const database = fakeSqlClient({ replay: run });
    const repository = new PostgresAflTradeAchievementReconciliationRepository(database.client);
    await expect(repository.persistRun(run)).resolves.toMatchObject({ idempotentReplay: true });
    expect(database.statements.join('\n')).not.toContain(
      'INSERT INTO outcome_achievement_reconciliation_input'
    );
  });

  it('rejects a stale achievement head instead of overwriting it', async () => {
    const database = fakeSqlClient({ stale: true });
    const repository = new PostgresAflTradeAchievementReconciliationRepository(database.client);
    await expect(repository.persistRun(runFromService())).rejects.toMatchObject({
      name: AflTradeAchievementReconciliationRepositoryError.name,
      code: 'STALE_HEAD',
    });
  });
});
