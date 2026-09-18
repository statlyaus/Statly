import { describe, expect, it, vi } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePostseasonYearContext } from '@/server/aflTradeIntelligence/domain/postseasonYearContext';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { PostgresAflTradePrivateValuationTradeEvidence } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationTradeEvidence';
import {
  AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
  AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCohortBinding';
import { createLocalAflTradePrivateValuationConstructionEvidence } from '@/server/aflTradeIntelligence/development/localPrivateValuationConstructionEvidence';
import { createAflTradeValuationInputBundleCandidate } from '@/server/aflTradeIntelligence/valuation/valuationInputBundleCandidate';
import { createAflTradeValuationInputBundleConstructionFixture } from '../testUtils/valuationInputBundleConstructionFixture';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;
const instant = '2026-01-01T00:00:00.000Z';
const request = {
  requestId: id('private-valuation-dispatch'),
  claim: { claimId: id('private-valuation-dispatch-claim'), leaseToken: 'b'.repeat(64) },
};
const historicalReviewDecisionId = 'review-decision:2020-jeremy-cameron';
const historicalKnowledgeCutoffAt = '2026-08-01T00:00:00.000Z';
const historicalEventVersionId = 'external-event-version:2020-jeremy-cameron';

function evidenceFixture() {
  const snapshot = {
    schemaVersion: 'afl-trade-canonical-release-member/v1',
    recordKind: 'transaction',
    record: {
      eventVersionId: 'event-version:one',
      eventId: 'event:one',
      competition: 'AFLM',
      seasonYear: 2025,
      kind: 'trade',
      status: 'approved',
      eventDate: '2025-10-01',
      recordedAt: '2025-12-01T00:00:00+00:00',
      parties: [],
    },
  };
  const membership = {
    ordinal: 1,
    recordKind: 'transaction',
    canonicalRecordId: snapshot.record.eventVersionId,
    canonicalRecordSha256: sha256AflTradeCanonicalJson(snapshot),
  };
  const sourceCaptures = [
    {
      captureId: 'capture:one',
      sourceSnapshotId: id('source-snapshot'),
      rightsArtifactId: id('source-rights'),
      gateDecisionId: id('gate-decision'),
      recordSha256: 'c'.repeat(64),
      recordedAt: instant,
    },
  ];
  const promotionSources = [
    { promotionId: id('external-canonical-promotion'), captureIds: ['capture:one'] },
  ];
  const counts = {
    transaction: 1,
    transfer: 0,
    draft_event: 0,
    draft_selection: 0,
    draft_player_asset: 0,
    pick_custody: 0,
    pick_realization: 0,
  };
  const content = {
    schemaVersion: 'afl-draft-trade-factual-release/v3',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership',
    authorityBoundary: 'registry_validation_and_activation_required',
    environment: 'non_production',
    scopeKey: 'afl-men:2025-trades',
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2025,
    createdAt: instant,
    effectiveThrough: instant,
    corpusId: id('corpus'),
    corpusSha256: 'a'.repeat(64),
    corpusSchemaVersion: 'afl-trade-canonical-corpus/v3',
    sourceMemberSetSha256: 'd'.repeat(64),
    memberCount: 1,
    sourceRecordCounts: counts,
    canonicalMembers: [membership],
    canonicalMemberCount: 1,
    canonicalMemberSetSha256: sha256AflTradeCanonicalJson([membership]),
    canonicalRecordCounts: counts,
    sourceCaptures,
    sourceCaptureSetSha256: sha256AflTradeCanonicalJson(sourceCaptures),
    promotionSources,
    promotionSourceSetSha256: sha256AflTradeCanonicalJson(promotionSources),
    factualCandidateSchemaVersion: 'afl-trade-factual-release-candidate/v4',
  };
  const releaseManifest = {
    releaseId: createAflTradeContentAddress('outcome-release', content),
    content,
  };
  return {
    binding: {
      requestId: request.requestId,
      factualOutputId: id('private-valuation-factual-output'),
      factualOperationId: id('current-valuation-factual-refresh-operation'),
      privateFactualCandidateId: id('private-factual-candidate'),
      privateFactualRevision: 1,
      lineageAdmissionId: id('corpus-factual-lineage-admission'),
      lineageId: id('corpus-factual-lineage'),
      corpusId: content.corpusId,
      cohortCandidateId: id('factual-release-candidate'),
      cohortReleaseId: releaseManifest.releaseId,
      cohortScopeKey: content.scopeKey,
      sourceMemberSetSha256: content.sourceMemberSetSha256,
      canonicalMemberSetSha256: content.canonicalMemberSetSha256,
      sourceCaptureSetSha256: content.sourceCaptureSetSha256,
      promotionSourceSetSha256: content.promotionSourceSetSha256,
      effectiveThrough: instant,
      cohortTradeIds: ['event-version:one'],
    },
    releaseManifest,
    members: [
      {
        membership,
        recordSha256: membership.canonicalRecordSha256,
        recordCanonicalJson: canonicalizeAflTradeJson(snapshot),
      },
    ],
  };
}

function reader(value: unknown) {
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string) {
      return {
        rows: (sql.startsWith('SET LOCAL ROLE') ? [] : [{ evidence_json: value }]) as Row[],
        rowCount: 1,
      };
    },
    async transaction(work) {
      return work(client);
    },
  };
  return new PostgresAflTradePrivateValuationTradeEvidence(client);
}

function historicalEvidenceFixture() {
  const retained = evidenceFixture();
  resealRecord(retained, {
    eventVersionId: historicalEventVersionId,
    eventId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
    seasonYear: 2020,
    eventDate: null,
    recordedAt: '2026-07-31T00:00:00.000Z',
  });
  const postseasonContext = createAflTradePostseasonYearContext({
    schemaVersion: 'afl-trade-postseason-year-context/v1',
    environment: 'non_production',
    competition: 'AFLM',
    tradeId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
    promotionId: id('external-canonical-promotion'),
    eventVersionId: historicalEventVersionId,
    tradeYear: 2020,
    tradeDate: null,
    period: 'established_postseason',
    reviewDecisionId: historicalReviewDecisionId,
    reviewEvidence: {
      artifactId: id('artifact'),
      contentSha256: 'a'.repeat(64),
      storageUri: `artifact://sha256/${'a'.repeat(64)}`,
      mediaType: 'application/json',
      byteLength: 42,
      createdAt: '2026-07-31T00:00:00.000Z',
    },
    recordedAt: '2026-07-31T12:00:00.000Z',
    knowledgeCutoffAt: historicalKnowledgeCutoffAt,
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
  });
  const content = retained.releaseManifest.content;
  retained.members[0]!.membership.canonicalRecordId = historicalEventVersionId;
  content.canonicalMemberSetSha256 = sha256AflTradeCanonicalJson(content.canonicalMembers);
  content.scopeKey = AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY;
  content.validFromSeason = 2020;
  content.validThroughSeason = 2020;
  content.createdAt = historicalKnowledgeCutoffAt;
  content.effectiveThrough = historicalKnowledgeCutoffAt;
  retained.releaseManifest.releaseId = createAflTradeContentAddress('outcome-release', content);
  const authorityContent = {
    schemaVersion: 'afl-trade-private-historical-factual-authority/v1',
    authorityBoundary: 'promotion_backed_postseason_factual_only',
    requestId: request.requestId,
    cohortScopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
    lineageAdmissionId: id('corpus-factual-lineage-admission'),
    cohortReleaseId: retained.releaseManifest.releaseId,
    reviewDecisionId: historicalReviewDecisionId,
    postseasonContextId: postseasonContext.contextId,
    transactionId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
    eventVersionId: historicalEventVersionId,
    tradeYear: 2020,
    revision: 1,
    knowledgeCutoffAt: historicalKnowledgeCutoffAt,
  } as const;
  const historicalRetained = {
    ...retained,
    binding: {
      schemaVersion: 'afl-trade-private-valuation-cohort-binding/v2',
      requestId: request.requestId,
      historicalFactualAuthority: {
        authorityId: createAflTradeContentAddress(
          'private-valuation-historical-factual-authority',
          authorityContent
        ),
        content: authorityContent,
      },
      lineageAdmissionId: authorityContent.lineageAdmissionId,
      lineageId: id('corpus-factual-lineage'),
      corpusId: content.corpusId,
      cohortCandidateId: id('factual-release-candidate'),
      cohortReleaseId: retained.releaseManifest.releaseId,
      cohortScopeKey: AFL_TRADE_HISTORICAL_PILOT_SCOPE_KEY,
      sourceMemberSetSha256: content.sourceMemberSetSha256,
      canonicalMemberSetSha256: content.canonicalMemberSetSha256,
      sourceCaptureSetSha256: content.sourceCaptureSetSha256,
      promotionSourceSetSha256: content.promotionSourceSetSha256,
      effectiveThrough: historicalKnowledgeCutoffAt,
      cohortTransactionId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
      tradeYear: 2020,
      cohortTradeIds: [historicalEventVersionId],
      postseasonYearContexts: [postseasonContext],
    },
  };
  return { retained: historicalRetained, postseasonContext };
}

function historicalReader(value: unknown, postseasonContext: unknown) {
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string) {
      const rows = sql.includes('historical_trade_evidence') ? [{ evidence_json: value }] : [];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      return work(client);
    },
  };
  return new PostgresAflTradePrivateValuationTradeEvidence(
    client,
    { read: async () => Buffer.from('unused') },
    async () => ({
      context: postseasonContext as never,
      acquisitionSpell: {} as never,
      release: {} as never,
      review: {} as never,
    })
  );
}

function resealRecord(
  retained: ReturnType<typeof evidenceFixture>,
  fields: Record<string, unknown>
) {
  const member = retained.members[0]!;
  const snapshot = JSON.parse(member.recordCanonicalJson);
  Object.assign(snapshot.record, fields);
  member.recordCanonicalJson = canonicalizeAflTradeJson(snapshot);
  member.recordSha256 = sha256AflTradeCanonicalJson(snapshot);
  member.membership.canonicalRecordSha256 = member.recordSha256;
  const content = retained.releaseManifest.content;
  content.canonicalMemberSetSha256 = sha256AflTradeCanonicalJson(content.canonicalMembers);
  retained.binding.canonicalMemberSetSha256 = content.canonicalMemberSetSha256;
  retained.releaseManifest.releaseId = createAflTradeContentAddress('outcome-release', content);
  retained.binding.cohortReleaseId = retained.releaseManifest.releaseId;
}

async function constructionFixture() {
  const retained = evidenceFixture();
  const model = createAflTradeValuationInputBundleConstructionFixture();
  const authority = model.modelEvidence.privateFactualAuthority;
  retained.binding.privateFactualCandidateId = authority.candidateId;
  retained.binding.privateFactualRevision = authority.revision;
  retained.binding.factualOperationId = model.modelEvidence.factualOperationId;
  const createdAt = '2026-08-15T03:00:00.000Z';
  const configuration = model.specification.content;
  const bundle = createAflTradeValuationInputBundleCandidate({
    modelEvidence: model.modelEvidence,
    playerRun: model.playerRun.manifest,
    pickRun: model.pickRun.manifest,
    valueUnitId: configuration.valueUnitId,
    createdAt,
    currentView: configuration.currentView,
    policies: configuration.policies,
    simulation: configuration.simulation,
  });
  const bundleArtifact = createAflTradeCanonicalJsonArtifactRef(bundle, createdAt);
  const artifactRepository = createAflTradeFixtureArtifactRepository({
    artifactClass: 'derived_private',
  });
  await artifactRepository.putIfAbsent(model.specificationArtifact, model.specificationBytes);
  await artifactRepository.putIfAbsent(
    bundleArtifact,
    new TextEncoder().encode(canonicalizeAflTradeJson(bundle))
  );
  const operationId = createAflTradeContentAddress(
    'valuation-input-bundle-construction-operation',
    {
      scopeKey: model.modelEvidence.scopeKey,
      modelEvidenceOperationId: model.modelEvidence.operationId,
      specificationId: model.specification.specificationId,
    }
  );
  const custody = new Map<string, Record<string, unknown>>();
  const client: AflOutcomeSqlClient = {
    async query<Row>(sql: string, values: readonly unknown[] = []) {
      let rows: unknown[];
      if (sql.includes('load_outcome_private_valuation_trade_evidence'))
        rows = [{ evidence_json: retained }];
      else if (sql.includes('FROM outcome_current_valuation_model_evidence_operation'))
        rows = [{ result_json: model.modelEvidence }];
      else if (sql.includes('FROM outcome_current_governed_valuation_model_pair'))
        rows = [{ qualification_id: model.modelEvidence.qualificationId }];
      else if (sql.includes('JOIN outcome_private_factual_candidate'))
        rows = [
          {
            candidate_id: authority.candidateId,
            revision: authority.revision,
            valuation_scope_key: authority.valuationScopeKey,
            evidence_scope_key: authority.evidenceScopeKey,
            evidence_bundle_id: authority.evidenceBundleId,
            review_decision_id: authority.reviewDecisionId,
            normalized_reconciled_custody_sha256: authority.normalizedReconciledCustodySha256,
          },
        ];
      else if (sql.includes('FROM outcome_current_valuation_factual_refresh_operation'))
        rows = [
          {
            scope_key: model.modelEvidence.scopeKey,
            candidate_id: authority.candidateId,
            private_factual_revision: authority.revision,
          },
        ];
      else if (sql.includes('FROM outcome_valuation_input_bundle_construction_operation'))
        rows = [
          {
            scope_key: model.modelEvidence.scopeKey,
            model_evidence_operation_id: model.modelEvidence.operationId,
            specification_id: model.specification.specificationId,
            specification_json: model.specification,
            specification_artifact_json: model.specificationArtifact,
            factual_revision: authority.revision,
            model_revision: model.modelEvidence.modelRevision,
            player_run_id: model.modelEvidence.playerRunId,
            pick_run_id: model.modelEvidence.pickRunId,
            constructed_at: createdAt,
            valuation_input_bundle_id: bundle.valuationInputBundleId,
            valuation_input_bundle_json: bundle,
            valuation_input_bundle_artifact_json: bundleArtifact,
            result_json: {
              operationId,
              specificationId: model.specification.specificationId,
              specificationArtifact: model.specificationArtifact,
              valuationInputBundleId: bundle.valuationInputBundleId,
              valuationInputBundle: bundle,
              valuationInputBundleArtifact: bundleArtifact,
            },
          },
        ];
      else if (sql.includes('INSERT INTO outcome_artifact_custody')) {
        custody.set(String(values[0]), {
          artifact_id: values[0],
          content_sha256: values[1],
          storage_uri: values[2],
          media_type: values[3],
          byte_length: values[4],
        });
        rows = [];
      } else if (sql.includes('FROM outcome_artifact_custody'))
        rows = [custody.get(String(values[0]))];
      else if (sql.includes('AS trusted_at')) rows = [{ trusted_at: '2026-08-15T04:00:00.000Z' }];
      else if (
        sql.startsWith('SET LOCAL ROLE') ||
        sql.includes('pg_advisory_xact_lock') ||
        sql.includes('SELECT revision FROM outcome_current_private_factual_authority')
      )
        rows = [];
      else throw new Error(`Unexpected fixture database query: ${sql}`);
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      return work(client);
    },
  };
  const options = {
    dispatch: { ...request, scopeKey: 'afl-men:2025-trades' as const },
    artifactRepository,
    maximumArtifactBytes: 100_000,
    specificationArtifact: model.specificationArtifact,
  };
  const input = {
    transaction: client,
    requestId: request.requestId,
    factualOutputId: retained.binding.factualOutputId,
    factualReleaseId: retained.binding.cohortReleaseId,
    capturedAt: '2026-08-15T04:00:00.000Z',
    modelEvidence: model.modelEvidence,
    hpnCalculationId: id('hpn-pav-season'),
    modelOperationId: id('private-valuation-model-operation'),
  };
  return { retained, model, bundle, bundleArtifact, artifactRepository, options, input, custody };
}

describe('local private valuation construction evidence', () => {
  it('retains exact release, membership and bundle evidence with versioned cohort identities', async () => {
    const value = await constructionFixture();
    const load = createLocalAflTradePrivateValuationConstructionEvidence(value.options);
    const result = await load(value.input);
    expect(result.releaseTradeIds).toEqual(['event-version:one']);
    expect(result.valuationInputBundle).toEqual(value.bundle);
    expect(result.valuationInputBundleArtifact).toEqual(value.bundleArtifact);
    expect(result.factualReleaseArtifact.createdAt).toBe(instant);
    expect(result.releaseMembershipArtifact.createdAt).toBe(instant);
    const membership = await value.artifactRepository.loadExact(
      result.releaseMembershipArtifact,
      100_000
    );
    expect(JSON.parse(new TextDecoder().decode(membership!.bytes))).toEqual(
      value.retained.releaseManifest.content.canonicalMembers
    );
    expect([...value.custody.keys()].sort()).toEqual(
      [
        result.factualReleaseArtifact.artifactId,
        result.releaseMembershipArtifact.artifactId,
        result.valuationInputBundleArtifact.artifactId,
      ].sort()
    );
    await expect(
      createLocalAflTradePrivateValuationConstructionEvidence(value.options)(value.input)
    ).resolves.toEqual(result);
  });

  it.each([
    'request',
    'factual output',
    'release',
    'candidate',
    'revision',
    'factual operation',
    'scope',
  ] as const)(
    'rejects substituted %s ancestry before retaining construction evidence',
    async (field) => {
      const value = await constructionFixture();
      const input = { ...value.input, modelEvidence: structuredClone(value.input.modelEvidence) };
      if (field === 'request') input.requestId = `private-valuation-dispatch:${'f'.repeat(64)}`;
      if (field === 'factual output')
        input.factualOutputId = `private-valuation-factual-output:${'f'.repeat(64)}`;
      if (field === 'release') input.factualReleaseId = `outcome-release:${'f'.repeat(64)}`;
      if (field === 'candidate')
        input.modelEvidence.privateFactualAuthority.candidateId = `private-factual-candidate:${'f'.repeat(64)}`;
      if (field === 'revision') input.modelEvidence.privateFactualAuthority.revision += 1;
      if (field === 'factual operation')
        input.modelEvidence.factualOperationId = `current-valuation-factual-refresh-operation:${'f'.repeat(64)}`;
      if (field === 'scope') input.modelEvidence.scopeKey = 'afl-men:2026-trades';
      await expect(
        createLocalAflTradePrivateValuationConstructionEvidence(value.options)(input)
      ).rejects.toThrow(/dispatch|ancestry/);
      expect(value.custody.size).toBe(0);
    }
  );

  it('propagates a revoked claim without retaining any construction evidence', async () => {
    const value = await constructionFixture();
    const query = value.input.transaction.query.bind(value.input.transaction);
    vi.spyOn(value.input.transaction, 'query').mockImplementation(async (sql, parameters) => {
      if (sql.includes('load_outcome_private_valuation_trade_evidence'))
        throw new Error('claim revoked');
      return query(sql, parameters);
    });
    await expect(
      createLocalAflTradePrivateValuationConstructionEvidence(value.options)(value.input)
    ).rejects.toThrow('claim revoked');
    expect(value.custody.size).toBe(0);
  });

  it('rejects unavailable retained bundle bytes before retaining construction evidence', async () => {
    const value = await constructionFixture();
    const load = value.artifactRepository.loadExact.bind(value.artifactRepository);
    vi.spyOn(value.artifactRepository, 'loadExact').mockImplementation(
      async (reference, maximumBytes) =>
        reference.artifactId === value.bundleArtifact.artifactId
          ? null
          : load(reference, maximumBytes)
    );
    await expect(
      createLocalAflTradePrivateValuationConstructionEvidence(value.options)(value.input)
    ).rejects.toThrow();
    expect(value.custody.size).toBe(0);
  });

  it('does not report evidence ready if artifact custody registration fails', async () => {
    const value = await constructionFixture();
    const query = value.input.transaction.query.bind(value.input.transaction);
    vi.spyOn(value.input.transaction, 'query').mockImplementation(async (sql, parameters) => {
      if (sql.includes('INSERT INTO outcome_artifact_custody'))
        throw new Error('custody unavailable');
      return query(sql, parameters);
    });
    await expect(
      createLocalAflTradePrivateValuationConstructionEvidence(value.options)(value.input)
    ).rejects.toThrow('custody unavailable');
  });
});

describe('private retained trade evidence reader', () => {
  it('loads the independent cohort and preserves stable versus version identities and recorded time', async () => {
    const retained = evidenceFixture();
    const result = await reader(retained).load(request);
    expect(result.binding.cohortReleaseId).toBe(retained.releaseManifest.releaseId);
    expect(result.trades).toEqual([{ eventVersionId: 'event-version:one', eventId: 'event:one' }]);
    expect(result.members[0]?.record.recordedAt).toBe('2025-12-01T00:00:00+00:00');
    expect(result.members[0]?.recordCanonicalJson).toBe(retained.members[0]!.recordCanonicalJson);
  });

  it('rejects a substituted request or release instead of trusting a valid-looking database result', async () => {
    const retained = evidenceFixture();
    retained.binding.requestId = `private-valuation-dispatch:${'f'.repeat(64)}`;
    await expect(reader(retained).load(request)).rejects.toThrow(/selected cohort/);
    retained.binding.requestId = request.requestId;
    retained.binding.cohortReleaseId = id('outcome-release');
    await expect(reader(retained).load(request)).rejects.toThrow(/selected cohort/);
  });

  it.each(['bytes', 'membership', 'duplicate', 'missing'] as const)(
    'rejects %s corruption of the sealed member set',
    async (mutation) => {
      const retained = evidenceFixture();
      if (mutation === 'bytes') retained.members[0]!.recordCanonicalJson = '{}';
      if (mutation === 'membership')
        retained.members[0]!.membership.canonicalRecordId = 'event-version:substitute';
      if (mutation === 'duplicate') retained.members.push(structuredClone(retained.members[0]!));
      if (mutation === 'missing') retained.members = [];
      await expect(reader(retained).load(request)).rejects.toThrow();
    }
  );

  it.each([
    { eventVersionId: 'event-version:substitute' },
    { seasonYear: 2024 },
    { competition: 'AFLW' },
    { status: 'withdrawn' },
    { recordedAt: '2026-02-01T00:00:00Z' },
    { recordedAt: null },
    { eventDate: '2026-01-02' },
  ])('rejects readdressed transaction identity or cutoff defects: %j', async (fields) => {
    const retained = evidenceFixture();
    resealRecord(retained, fields);
    await expect(reader(retained).load(request)).rejects.toThrow();
  });

  it('rejects a different exhaustive cohort list', async () => {
    const retained = evidenceFixture();
    retained.binding.cohortTradeIds = ['event-version:another'];
    await expect(reader(retained).load(request)).rejects.toThrow();
  });

  it('loads the exact reviewed historical pilot with a year-precise postseason date', async () => {
    const { retained, postseasonContext } = historicalEvidenceFixture();
    const result = await historicalReader(retained, postseasonContext).loadHistoricalPilot({
      ...request,
      reviewDecisionId: historicalReviewDecisionId,
      knowledgeCutoffAt: historicalKnowledgeCutoffAt,
    });
    expect(result.binding).toEqual(retained.binding);
    expect(result.trades).toEqual([
      {
        eventVersionId: historicalEventVersionId,
        eventId: AFL_TRADE_HISTORICAL_PILOT_TRANSACTION_ID,
      },
    ]);
    expect(result.members[0]?.record.eventDate).toBeNull();
    expect(result.members[0]?.record.recordedAt).toBe('2026-07-31T00:00:00.000Z');
  });

  it('requires physical review evidence before loading the historical pilot', async () => {
    const { retained } = historicalEvidenceFixture();
    await expect(
      reader(retained).loadHistoricalPilot({
        ...request,
        reviewDecisionId: historicalReviewDecisionId,
        knowledgeCutoffAt: historicalKnowledgeCutoffAt,
      })
    ).rejects.toThrow('requires physical review evidence');
  });
});
