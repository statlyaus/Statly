import { describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
  createAflTradeFactualReleaseCandidate,
} from '@/server/aflTradeIntelligence/outcomes/factualReleaseCandidateContracts';
import {
  AFL_TRADE_FACTUAL_PROJECTION_PARITY_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_PROJECTION_PARITY_SCHEMA_VERSION,
  createAflTradeFactualProjectionParity,
} from '@/server/aflTradeIntelligence/outcomes/factualProjectionParityContracts';
import {
  AflTradeFactualReleaseCandidateWriteError,
  PostgresAflTradeFactualReleaseCandidateWriter,
} from '@/server/aflTradeIntelligence/outcomes/postgresFactualReleaseCandidateRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflDraftTradeOutcomeFactualProjectionManifest,
  createAflDraftTradeOutcomeFactualReleaseManifest,
  validateAflDraftTradeOutcomeReleaseProjectionPair,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  applyAflDraftTradeOutcomeReleaseCommand,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import { createAflDraftTradeOutcomeReleaseFixture } from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

function reference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function referenceFromId(id: string) {
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

const recordedAt = '2026-10-01T00:00:00.000Z';
const effectiveThrough = '2026-09-30T23:59:59.000Z';
const baseFixture = createAflDraftTradeOutcomeReleaseFixture('f');
const baseRelease = baseFixture.release;
const sourceRightsBinding = baseRelease.content.sourceRightsBindings[0];
const gamesDefinition = baseRelease.content.metricDefinitions.find(
  ({ metric }) => metric === 'games'
);
if (!gamesDefinition) throw new Error('The factual candidate fixture requires games.');
const sourceCapture = {
  ordinal: 1,
  recordSha256: '1'.repeat(64),
  recordedAt,
  captureId: 'source-capture:fixture',
  sourceSnapshotId: sourceRightsBinding.sourceSnapshotId,
  gate0aDecisionId: sourceRightsBinding.gateDecisionId,
  consumedFieldSetSha256: '2'.repeat(64),
};
const eventVersion = {
  ordinal: 1,
  recordSha256: '3'.repeat(64),
  recordedAt,
  eventVersionId: 'event-version:fixture',
  eventId: 'event:fixture',
};
const spell = {
  ordinal: 1,
  recordSha256: '4'.repeat(64),
  recordedAt,
  spellVersionId: reference('acquisition-spell-version', 'fixture').id,
  playerId: 'afl-player:fixture',
  clubId: 'afl-club:fixture',
  startDate: '2026-01-01',
  endDate: null,
};
const factualRun = {
  ordinal: 1,
  recordSha256: '5'.repeat(64),
  recordedAt,
  factualRunId: reference('factual-reconciliation-run', 'fixture').id,
  finalization: reference('factual-reconciliation-finalization', 'fixture'),
  competition: 'AFLM' as const,
  seasonYear: 2026,
};
const reconciledMetric = {
  ordinal: 1,
  recordSha256: '6'.repeat(64),
  recordedAt,
  reconciledFactId: reference('reconciled-factual-metric', 'fixture').id,
  factualRunId: factualRun.factualRunId,
  subjectKey: reference('reconciled-factual-subject', 'fixture').id,
  headRevision: 1,
  playerId: 'afl-player:fixture',
  clubId: 'afl-club:fixture',
  competition: 'AFLM' as const,
  seasonYear: 2026,
  metricCode: 'games' as const,
  definition: referenceFromId(gamesDefinition.metricDefinitionId),
  state: 'measured' as const,
  effectiveThrough,
};
const achievementRun = {
  ordinal: 1,
  recordSha256: '7'.repeat(64),
  recordedAt,
  achievementRunId: reference('achievement-reconciliation-run', 'fixture').id,
  finalization: reference('achievement-reconciliation-finalization', 'fixture'),
  competition: 'AFLM' as const,
  seasonYear: 2026,
};
const achievement = {
  ordinal: 1,
  recordSha256: '8'.repeat(64),
  recordedAt,
  reconciledAchievementId: reference('reconciled-achievement', 'fixture').id,
  achievementRunId: achievementRun.achievementRunId,
  subjectKey: reference('reconciled-achievement-subject', 'fixture').id,
  headRevision: 1,
  playerId: 'afl-player:fixture',
  clubId: null,
  competition: 'AFLM' as const,
  seasonYear: 2026,
  achievementCode: 'all_australian_team' as const,
  definition: reference('achievement-definition', 'all-australian/v1'),
  grain: 'season' as const,
  state: 'affirmed' as const,
  effectiveThrough,
};
const spellMetric = {
  ordinal: 1,
  recordSha256: '9'.repeat(64),
  recordedAt,
  spellMetricVersionId: reference('acquisition-spell-metric-version', 'fixture').id,
  subjectKey: reference('acquisition-spell-metric-subject', 'fixture').id,
  headRevision: 1,
  spellVersionId: spell.spellVersionId,
  policyId: reference('acquisition-spell-metric-policy', 'fixture').id,
  playerId: 'afl-player:fixture',
  clubId: 'afl-club:fixture',
  metricCode: 'games' as const,
  definition: reference('metric-definition', 'games/v1'),
  state: 'complete' as const,
  effectiveThrough: '2026-09-30',
};
const reviewDecision = {
  ordinal: 1,
  recordSha256: 'a'.repeat(64),
  recordedAt,
  decisionId: 'review-decision:fixture',
  subjectType: 'factual_release_candidate',
};

function validContent() {
  const members = structuredClone({
    sourceCaptures: [sourceCapture],
    eventVersions: [eventVersion],
    lineageEdges: [],
    acquisitionSpells: [spell],
    factualRuns: [factualRun],
    reconciledMetrics: [reconciledMetric],
    achievementRuns: [achievementRun],
    reconciledAchievements: [achievement],
    spellMetrics: [spellMetric],
    reviewDecisions: [reviewDecision],
  });
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const targetReleaseManifest = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...baseRelease.content,
    schemaVersion: 'afl-draft-trade-outcome-release/v2',
    factualCandidateSchemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    sourceMemberSetSha256: memberSetSha256,
    createdAt: '2026-10-01T00:01:00.000Z',
    effectiveThrough,
    outcomeRecordCount: 3,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  });
  return {
    schemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false as const,
    environment: 'test_fixture' as const,
    scopeKey: targetReleaseManifest.content.scopeKey,
    competition: 'AFLM' as const,
    validFromSeason: 2026,
    validThroughSeason: 2026,
    createdAt: '2026-10-01T00:05:00.000Z',
    effectiveThrough,
    targetRelease: referenceFromId(targetReleaseManifest.releaseId),
    targetReleaseManifest,
    archiveDataset: referenceFromId(targetReleaseManifest.content.archiveDatasetId),
    sourceSnapshotSet: referenceFromId(targetReleaseManifest.content.sourceSnapshotSetId),
    metricRegistryVersion: targetReleaseManifest.content.metricRegistryVersion,
    acquisitionSpellRule: referenceFromId(targetReleaseManifest.content.acquisitionSpellRuleId),
    members,
    memberSetSha256,
    counts: {
      sourceCaptures: 1,
      eventVersions: 1,
      lineageEdges: 0,
      acquisitionSpells: 1,
      factualRuns: 1,
      reconciledMetrics: 1,
      achievementRuns: 1,
      reconciledAchievements: 1,
      spellMetrics: 1,
      reviewDecisions: 1,
    },
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  };
}

function validProjection(candidate: ReturnType<typeof createAflTradeFactualReleaseCandidate>) {
  const logicalDatasetSha256 = 'c'.repeat(64);
  const publicListItemSetSha256 = 'd'.repeat(64);
  return createAflDraftTradeOutcomeFactualProjectionManifest({
    ...baseFixture.projection.content,
    schemaVersion: 'afl-draft-trade-outcome-projection/v2',
    createdAt: '2026-10-01T00:10:00.000Z',
    releaseId: candidate.content.targetRelease.id,
    archiveDatasetId: candidate.content.archiveDataset.id,
    metricRegistryVersion: candidate.content.metricRegistryVersion,
    effectiveThrough: candidate.content.effectiveThrough,
    metricDefinitionIds: candidate.content.targetReleaseManifest.content.metricDefinitions
      .map(({ metricDefinitionId }) => metricDefinitionId)
      .sort(),
    parityReport: {
      ...baseFixture.projection.content.parityReport,
      checkedOutcomeRecordCount: candidate.content.targetReleaseManifest.content.outcomeRecordCount,
      logicalDatasetSha256,
    },
    factualCandidateId: candidate.candidateId,
    sourceMemberSetSha256: candidate.content.memberSetSha256,
    publicListItemSetSha256,
    derivationSha256: sha256AflTradeCanonicalJson({
      factualCandidateId: candidate.candidateId,
      logicalDatasetSha256,
      publicListItemSetSha256,
      sourceMemberSetSha256: candidate.content.memberSetSha256,
    }),
  });
}

function fakeClient(replay = false) {
  const statements: string[] = [];
  const candidate = createAflTradeFactualReleaseCandidate(validContent());
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string): Promise<AflOutcomeSqlQueryResult<Row>> {
      statements.push(sql);
      if (sql.includes('SELECT candidate_sha256')) {
        return replay
          ? {
              rows: [
                {
                  candidate_sha256: candidate.candidateSha256,
                  target_release_id: candidate.content.targetRelease.id,
                  member_set_sha256: candidate.content.memberSetSha256,
                  candidate_json: candidate.content,
                  finalized_at: candidate.content.createdAt,
                  status: 'approved',
                },
              ] as Row[],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes('SELECT release_id FROM outcome_release_manifest')) {
        return {
          rows: [{ release_id: candidate.content.targetRelease.id }] as Row[],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE outcome_factual_release_candidate')) {
        return { rows: [{ finalized_at: candidate.content.createdAt }] as Row[], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    async transaction<T>(work: (transaction: AflOutcomeSqlClient) => Promise<T>): Promise<T> {
      return work(client);
    },
  };
  return { client, statements, candidate };
}

describe('AFL trade factual release candidate v3', () => {
  it('creates a deterministic typed private candidate', () => {
    const content = validContent();
    const candidate = createAflTradeFactualReleaseCandidate(content);
    expect(createAflTradeFactualReleaseCandidate(structuredClone(content))).toEqual(candidate);
    expect(candidate.content.publicationEligible).toBe(false);
  });

  it('rejects same-count member substitution through the member-set root', () => {
    const content = validContent();
    const changed = structuredClone(content);
    changed.members.reconciledMetrics[0].recordSha256 = 'b'.repeat(64);
    expect(() => createAflTradeFactualReleaseCandidate(changed)).toThrow();
  });

  it('rejects a canonical fact without its exact run', () => {
    const content = validContent();
    expect(() =>
      createAflTradeFactualReleaseCandidate({
        ...content,
        members: { ...content.members, achievementRuns: [] },
        counts: { ...content.counts, achievementRuns: 0 },
      })
    ).toThrow();
  });

  it('admits an acquisition-only factual candidate without inventing outcome evidence', () => {
    const content = validContent();
    const members = {
      ...content.members,
      factualRuns: [],
      reconciledMetrics: [],
      achievementRuns: [],
      reconciledAchievements: [],
      spellMetrics: [],
    };
    const memberSetSha256 = sha256AflTradeCanonicalJson(members);
    const targetReleaseManifest = createAflDraftTradeOutcomeFactualReleaseManifest({
      ...content.targetReleaseManifest.content,
      sourceMemberSetSha256: memberSetSha256,
      outcomeRecordCount: 0,
    });

    const candidate = createAflTradeFactualReleaseCandidate({
      ...content,
      targetRelease: referenceFromId(targetReleaseManifest.releaseId),
      targetReleaseManifest,
      members,
      memberSetSha256,
      counts: {
        ...content.counts,
        factualRuns: 0,
        reconciledMetrics: 0,
        achievementRuns: 0,
        reconciledAchievements: 0,
        spellMetrics: 0,
      },
    });

    expect(candidate.content.targetReleaseManifest.content.outcomeRecordCount).toBe(0);
    expect(candidate.content.members.acquisitionSpells).toHaveLength(1);
    expect(candidate.content.members.reconciledMetrics).toEqual([]);
  });

  it('rejects target manifests that do not cover an exact source capture', () => {
    const content = validContent();
    content.members.sourceCaptures[0].gate0aDecisionId = reference('gate-decision', 'different').id;
    expect(() => createAflTradeFactualReleaseCandidate(content)).toThrow();
  });

  it('has no representable raw provider achievement member', () => {
    const content = validContent();
    expect(() =>
      createAflTradeFactualReleaseCandidate({
        ...content,
        members: {
          ...content.members,
          providerAchievementFacts: [{ achievementFactId: 'source-fact:raw' }],
        },
      } as never)
    ).toThrow();
  });

  it('rejects post-cutoff factual knowledge', () => {
    const content = validContent();
    const changed = structuredClone(content);
    changed.members.reconciledAchievements[0].effectiveThrough = '2026-10-02T00:00:00.000Z';
    changed.memberSetSha256 = sha256AflTradeCanonicalJson(changed.members);
    expect(() => createAflTradeFactualReleaseCandidate(changed)).toThrow();
  });

  it('persists every typed membership behind one write interface without registering a release', async () => {
    const database = fakeClient();
    const writer = new PostgresAflTradeFactualReleaseCandidateWriter(database.client);
    await expect(writer.persistCandidate(database.candidate)).resolves.toMatchObject({
      candidateId: database.candidate.candidateId,
      idempotentReplay: false,
    });
    const sql = database.statements.join('\n').toLowerCase();
    expect(sql).toContain('insert into outcome_release_manifest');
    expect(sql).toContain('outcome_release_reconciled_metric_member');
    expect(sql).toContain('outcome_release_reconciled_achievement_member');
    expect(sql).toContain('outcome_release_spell_metric_member');
    expect(sql).not.toMatch(
      /insert into outcome_registry_event|outcome_active_release|outcome_projection/
    );
  });

  it('returns an exact finalized replay without inserting membership again', async () => {
    const database = fakeClient(true);
    const writer = new PostgresAflTradeFactualReleaseCandidateWriter(database.client);
    await expect(writer.persistCandidate(database.candidate)).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(database.statements.join('\n')).not.toContain(
      'INSERT INTO outcome_release_source_capture'
    );
  });

  it('rejects malformed input before opening a transaction', async () => {
    const database = fakeClient();
    const writer = new PostgresAflTradeFactualReleaseCandidateWriter(database.client);
    await expect(writer.persistCandidate({})).rejects.toMatchObject({
      name: AflTradeFactualReleaseCandidateWriteError.name,
      code: 'INVALID_CANDIDATE',
    });
    expect(database.statements).toHaveLength(0);
  });

  it('binds factual projection parity to the exact member-set root', () => {
    const candidate = createAflTradeFactualReleaseCandidate(validContent());
    const projection = validProjection(candidate);
    const parity = createAflTradeFactualProjectionParity({
      schemaVersion: AFL_TRADE_FACTUAL_PROJECTION_PARITY_SCHEMA_VERSION,
      publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
      authorityBoundary: AFL_TRADE_FACTUAL_PROJECTION_PARITY_AUTHORITY_BOUNDARY,
      publicationEligible: false,
      checkedAt: '2026-10-01T00:11:00.000Z',
      candidate,
      projection,
      memberSetSha256: candidate.content.memberSetSha256,
    });
    expect(parity.content.projection.content.sourceMemberSetSha256).toBe(
      candidate.content.memberSetSha256
    );
    expect(parity.content.projection.content.parityReport.logicalDatasetSha256).not.toBe(
      candidate.content.memberSetSha256
    );
    expect(
      validateAflDraftTradeOutcomeReleaseProjectionPair(
        candidate.content.targetReleaseManifest,
        projection
      )
    ).toBe(true);
    expect(
      validateAflDraftTradeOutcomeReleaseProjectionPair(
        candidate.content.targetReleaseManifest,
        baseFixture.projection
      )
    ).toBe(false);
    expect(validateAflDraftTradeOutcomeReleaseProjectionPair(baseFixture.release, projection)).toBe(
      false
    );
  });

  it('rejects a changed public root without a new authenticated derivation', () => {
    const candidate = createAflTradeFactualReleaseCandidate(validContent());
    const projection = validProjection(candidate);
    const changed = structuredClone(projection);
    changed.content.parityReport.logicalDatasetSha256 = 'd'.repeat(64);
    expect(() =>
      createAflTradeFactualProjectionParity({
        schemaVersion: AFL_TRADE_FACTUAL_PROJECTION_PARITY_SCHEMA_VERSION,
        publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
        authorityBoundary: AFL_TRADE_FACTUAL_PROJECTION_PARITY_AUTHORITY_BOUNDARY,
        publicationEligible: false,
        checkedAt: '2026-10-01T00:11:00.000Z',
        candidate,
        projection: changed,
        memberSetSha256: candidate.content.memberSetSha256,
      })
    ).toThrow();
  });

  it('registers and validates the discriminated factual-v2 pair in memory', () => {
    const candidate = createAflTradeFactualReleaseCandidate(validContent());
    const projection = validProjection(candidate);
    const registered = registerAflDraftTradeOutcomeRelease(
      createAflDraftTradeOutcomeReleaseRegistry(),
      {
        expectedRevision: 0,
        manifest: candidate.content.targetReleaseManifest,
        actor: 'fixture-factual-builder',
        evidenceId: candidate.candidateId,
      }
    );
    const validated = applyAflDraftTradeOutcomeReleaseCommand(registered, {
      action: 'validate',
      releaseId: candidate.content.targetRelease.id,
      expectedRevision: registered.revision,
      occurredAt: '2026-10-01T00:12:00.000Z',
      actor: 'fixture-factual-reviewer',
      evidenceId: projection.projectionId,
      environment: 'test_fixture',
      projectionManifest: projection,
      gateDecisionLedger: baseFixture.rights.ledger,
    });
    expect(validated.releases[candidate.content.targetRelease.id].state).toBe('validated');
  });
});
