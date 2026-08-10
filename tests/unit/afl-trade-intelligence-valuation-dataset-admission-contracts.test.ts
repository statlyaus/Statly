import { describe, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { aflTradeArtifactReadbackReceiptSchema } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createAflTradeSourceSnapshotManifest } from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeDatasetManifestSchema } from '@/server/aflTradeIntelligence/artifacts/datasetManifest';
import {
  AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION,
  AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
  AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
  createAflTradeConsumedFieldSet,
  createAflTradeCorpusFactualLineage,
  createAflTradeValuationDatasetAdmissionReceipt,
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
  parseAflTradeAnyDatasetManifest,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactKind,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION,
  AflTradeValuationDatasetAdmissionService,
} from '@/server/aflTradeIntelligence/modeling/valuationDatasetAdmission';
import {
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
  createAflTradeFactualReleaseCandidate,
  type AflTradeFactualReleaseCandidate,
} from '@/server/aflTradeIntelligence/outcomes/factualReleaseCandidateContracts';
import {
  createAflDraftTradeOutcomeFactualProjectionManifest,
  createAflDraftTradeOutcomeFactualReleaseManifest,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseContracts';
import {
  applyAflDraftTradeOutcomeReleaseCommand,
  authenticateAflDraftTradeOutcomeReleaseRegistry,
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import {
  AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';

import {
  createAflDraftTradeOutcomeReleaseFixture,
  createAflTradeGateDecisionFixture,
} from '../fixtures/aflDraftTradeOutcomeReleaseFixture';

const digest = (value: string) => value.repeat(64);
const instant = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, '0')}:00.000Z`;
const retainedBytes = new Map<string, Uint8Array>();

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

function artifact(value: unknown, minute = 0): AflTradeArtifactRef {
  const reference = createAflTradeCanonicalJsonArtifactRef(value, instant(minute));
  retainedBytes.set(reference.artifactId, jsonBytes(value));
  return reference;
}

function reference(prefix: string, marker: string) {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function referenceFromId(id: string) {
  return { id, sha256: id.slice(id.indexOf(':') + 1) };
}

function sealMember<T extends { ordinal: number }>(member: T) {
  return { ...member, recordSha256: sha256AflTradeCanonicalJson({ fixtureRecord: member }) };
}

function specification() {
  return createAflTradeValuationDatasetSpecification({
    schemaVersion: 'afl-trade-valuation-dataset-specification/v1',
    environment: 'test_fixture',
    scopeKey: 'public-afl-draft-trade-outcomes',
    competition: 'AFLM',
    modelKind: 'player_contribution_and_availability',
    createdAt: instant(8),
    rowGrain: 'player_acquisition_spell_prediction',
    featurePolicy: {
      knowledgeJoin: 'point_in_time_as_known_at_prediction_cutoff',
      correctionAvailability: 'only_after_known_from',
      unknownAndZero: 'distinct',
      targetDerivedFeatures: 'prohibited',
      postOutcomeFeatures: 'prohibited',
    },
    targetPolicy: {
      targetKind: 'future_real_club_contribution',
      targetStarts: 'strictly_after_prediction_origin',
      activeCareerTreatment: 'right_censored',
      unavailableObservationTreatment: 'explicit_unavailable_not_zero',
    },
    splits: [
      { role: 'train', from: '2010-01-01', to: '2014-01-01' },
      { role: 'calibration', from: '2014-01-08', to: '2018-01-01' },
      { role: 'validation', from: '2018-01-08', to: '2022-01-01' },
      { role: 'final_test', from: '2022-01-08', to: '2027-01-01' },
    ],
    embargoDays: 7,
    leakageGroupKinds: ['acquisition_spell', 'event', 'player'],
    featureDefinitions: [artifact({ definition: 'feature' })],
    targetDefinition: artifact({ definition: 'target' }),
    valueUnitDefinition: artifact({ definition: 'value-unit' }),
    roleTaxonomy: artifact({ definition: 'roles' }),
    eraDefinition: artifact({ definition: 'eras' }),
    censoringDefinition: artifact({ definition: 'censoring' }),
    inclusionPolicy: artifact({ definition: 'inclusion' }),
  });
}

function allMemberMappings(members: AflTradeFactualReleaseCandidate['content']['members']) {
  return [
    ...members.sourceCaptures.map((member) => ({
      kind: 'source_capture' as const,
      memberId: member.captureId,
      recordSha256: member.recordSha256,
    })),
    ...members.eventVersions.map((member) => ({
      kind: 'event_version' as const,
      memberId: member.eventVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.lineageEdges.map((member) => ({
      kind: 'lineage_edge' as const,
      memberId: member.edgeId,
      recordSha256: member.recordSha256,
    })),
    ...members.acquisitionSpells.map((member) => ({
      kind: 'acquisition_spell' as const,
      memberId: member.spellVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.factualRuns.map((member) => ({
      kind: 'factual_run' as const,
      memberId: member.factualRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledMetrics.map((member) => ({
      kind: 'reconciled_metric' as const,
      memberId: member.reconciledFactId,
      recordSha256: member.recordSha256,
    })),
    ...members.achievementRuns.map((member) => ({
      kind: 'achievement_run' as const,
      memberId: member.achievementRunId,
      recordSha256: member.recordSha256,
    })),
    ...members.reconciledAchievements.map((member) => ({
      kind: 'reconciled_achievement' as const,
      memberId: member.reconciledAchievementId,
      recordSha256: member.recordSha256,
    })),
    ...members.spellMetrics.map((member) => ({
      kind: 'spell_metric' as const,
      memberId: member.spellMetricVersionId,
      recordSha256: member.recordSha256,
    })),
    ...members.reviewDecisions.map((member) => ({
      kind: 'review_decision' as const,
      memberId: member.decisionId,
      recordSha256: member.recordSha256,
    })),
  ].sort((left, right) =>
    `${left.kind}|${left.memberId}`.localeCompare(`${right.kind}|${right.memberId}`)
  );
}

function factualProjection(candidate: ReturnType<typeof createAflTradeFactualReleaseCandidate>) {
  const base = createAflDraftTradeOutcomeReleaseFixture('f').projection;
  const logicalDatasetSha256 = digest('c');
  const publicListItemSetSha256 = digest('d');
  return createAflDraftTradeOutcomeFactualProjectionManifest({
    ...base.content,
    schemaVersion: 'afl-draft-trade-outcome-projection/v2',
    createdAt: instant(6),
    releaseId: candidate.content.targetRelease.id,
    archiveDatasetId: candidate.content.archiveDataset.id,
    metricRegistryVersion: candidate.content.metricRegistryVersion,
    effectiveThrough: candidate.content.effectiveThrough,
    metricDefinitionIds: candidate.content.targetReleaseManifest.content.metricDefinitions
      .map(({ metricDefinitionId }) => metricDefinitionId)
      .sort(),
    parityReport: {
      ...base.content.parityReport,
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

function sourceSnapshotFixture() {
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'fixture-authoritative-source',
    provider: 'Fixture workbook provider',
    dataset: 'Fixture AFL outcomes workbook',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Retain exact fixture evidence for factual and valuation admission tests.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'manual_review' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      deliveryMethod: 'Fabricated fixture workbook',
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'allowed' as const,
      public_fact_display: 'allowed' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: false,
      identification: null,
      rateLimit: null,
      cache: { permitted: false, maximumSeconds: null },
    },
    retention: {
      rawEvidence: {
        disposition: 'transient' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Fixture source bytes are retained temporarily.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Fixture hashes are retained for tests.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Fixture derived artifacts are test-only.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
    attribution: { required: false, text: null, placement: null },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: [
      {
        sourceField: 'games',
        normalizedField: 'games',
        uses: {
          archive_fact: 'allowed' as const,
          model_training: 'blocked' as const,
          derived_feature: 'allowed' as const,
          public_display: 'allowed' as const,
        },
        attributionRequired: false,
        notes: null,
      },
    ],
    conditions: [],
    rightsEvidenceIds: [`artifact:${digest('2')}`],
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-10-01T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fixture source and derived bytes.',
      retainableAuditMaterial: 'Retain fixture hashes only.',
    },
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const rights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const decisionKey = 'fixture-capture-rights';
  const ledger = gateLedger({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    decidedAt: instant(0),
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rights.rightsArtifactId }],
    dimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: ['manual_review'] },
      { name: 'geography', values: ['fixture'] },
      { name: 'commercial_context', values: ['fixture'] },
      { name: 'audience', values: ['internal_fixture'] },
      {
        name: 'operation',
        values: [
          'bounded_evaluation_capture',
          'raw_evidence_retention',
          'metadata_hash_retention',
          'public_derived_output',
          'public_fact_display',
        ],
      },
    ],
  });
  const gate0aReceipt = createAflTradeGate0AReceipt(
    ledger,
    rights,
    {
      decisionKey,
      environment: 'test_fixture',
      rightsArtifactId: rights.rightsArtifactId,
      evaluatedAt: instant(0),
      competition: 'AFLM',
      season: 2026,
      accessMechanism: 'manual_review',
      capabilityId: null,
      geography: 'fixture',
      commercialContext: 'fixture',
      audience: 'internal_fixture',
      operations: [
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'public_derived_output',
        'public_fact_display',
      ],
      fieldUses: [{ sourceField: 'games', use: 'public_display' }],
      rawRetentionDays: 30,
      metadataRetentionDays: null,
      cacheSeconds: null,
    },
    instant(0)
  );
  const sourceArtifact = createAflTradeByteArtifactRef(
    Uint8Array.from([80, 75, 3, 4]),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    instant(0)
  );
  const readbackContent = {
    schemaVersion: 'afl-trade-artifact-readback/v4' as const,
    artifact: sourceArtifact,
    repositoryAssurance: 'fixture_memory' as const,
    artifactClass: 'raw_source' as const,
    custodyProfileId: null,
    custodyProfile: null,
    custodyEnvironment: 'test_fixture' as const,
    verifiedAt: instant(0),
    verification: 'exact_reference_and_sha256_bytes' as const,
    status: 'passed' as const,
  };
  const readbackReceipt = aflTradeArtifactReadbackReceiptSchema.parse({
    receiptId: createAflTradeContentAddress('artifact-readback', readbackContent),
    content: readbackContent,
  });
  const snapshot = createAflTradeSourceSnapshotManifest({
    schemaVersion: 'afl-trade-source-snapshot/v3',
    sourceArtifact,
    readbackReceipt,
    capture: {
      kind: 'workbook',
      sourceRegisterId: rights.content.registerId,
      upstreamProvider: rights.content.provider,
      upstreamDataset: rights.content.dataset,
      upstreamDatasetVersion: rights.content.datasetVersion,
      originalFilename: 'AFL Drafts Trades.xlsx',
      workbookFormat: 'xlsx',
      worksheetNames: ['Player outcomes'],
      importFormatVersion: 'fixture-v1',
      accessMechanism: 'manual_review',
    },
    sourceRightsProposal: rights,
    gate0aProposal: ledger.proposals[0],
    gate0aDecision: ledger.decisions[0],
    gate0aReceipt,
    fitzRoyCaptureReceipt: null,
    capturedFields: ['games'],
    retrievedAt: instant(0),
    effectiveAt: '2026-08-01T00:00:00.000Z',
    retention: { rawRetentionDays: 30, deleteOnWithdrawal: true },
    createdAt: instant(0),
  });
  return { snapshot, ledger, rights, gate0aReceipt };
}

function factualFixture(achievementGrain: 'season' | 'round' = 'season', additionalSpell = false) {
  const releaseFixture = createAflDraftTradeOutcomeReleaseFixture('f');
  const capture = sourceSnapshotFixture();
  const sourceBinding = {
    sourceSnapshotId: capture.snapshot.snapshotId,
    sourceRightsArtifactId: capture.rights.rightsArtifactId,
    gateDecisionId: capture.ledger.decisions[0].decisionId,
    sourceRightsProposal: capture.rights,
    gate0aReceipt: capture.gate0aReceipt,
    consumedSourceFields: ['games'],
  };
  const gamesDefinition = releaseFixture.release.content.metricDefinitions.find(
    ({ metric }) => metric === 'games'
  );
  if (!gamesDefinition) throw new Error('Fixture requires the games definition.');
  const captureId = 'source-capture:fixture';
  const consumedFieldSet = createAflTradeConsumedFieldSet({
    schemaVersion: AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION,
    captureId,
    sourceSnapshotId: sourceBinding.sourceSnapshotId,
    createdAt: instant(4),
    fields: [{ sourceField: 'games', uses: ['derived_feature', 'model_training'] }],
  });
  const sourceCapture = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    captureId,
    sourceSnapshotId: sourceBinding.sourceSnapshotId,
    gate0aDecisionId: sourceBinding.gateDecisionId,
    consumedFieldSetSha256: consumedFieldSet.content.fieldSetSha256,
  });
  const eventVersion = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    eventVersionId: 'event-version:fixture',
    eventId: 'event:fixture',
  });
  const lineageEdge = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    edgeId: `lineage-edge:${digest('4')}`,
  });
  const spell = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    spellVersionId: reference('acquisition-spell-version', 'fixture').id,
    spellId: 'acquisition-spell:fixture',
    playerId: 'afl-player:fixture',
    clubId: 'afl-club:fixture',
    startDate: '2025-01-01',
    endDate: null,
  });
  const secondLineageEdge = sealMember({
    ordinal: 2,
    recordedAt: instant(0),
    edgeId: `lineage-edge:${digest('f')}`,
  });
  const secondSpell = sealMember({
    ordinal: 2,
    recordedAt: instant(0),
    spellVersionId: `acquisition-spell-version:${digest('f')}`,
    spellId: 'acquisition-spell:fixture-two',
    playerId: 'afl-player:fixture-two',
    clubId: spell.clubId,
    startDate: spell.startDate,
    endDate: null,
  });
  const lineageEdges = additionalSpell ? [lineageEdge, secondLineageEdge] : [lineageEdge];
  const acquisitionSpells = additionalSpell ? [spell, secondSpell] : [spell];
  const factualRun = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    factualRunId: reference('factual-reconciliation-run', 'fixture').id,
    finalization: reference('factual-reconciliation-finalization', 'fixture'),
    competition: 'AFLM' as const,
    seasonYear: 2026,
  });
  const reconciledMetric = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    reconciledFactId: reference('reconciled-factual-metric', 'fixture').id,
    factualRunId: factualRun.factualRunId,
    subjectKey: reference('reconciled-factual-subject', 'fixture').id,
    headRevision: 1,
    playerId: spell.playerId,
    clubId: spell.clubId,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    metricCode: 'games' as const,
    definition: referenceFromId(gamesDefinition.metricDefinitionId),
    state: 'measured' as const,
    effectiveThrough: '2026-09-30T23:59:59.000Z',
  });
  const achievementRun = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    achievementRunId: reference('achievement-reconciliation-run', 'fixture').id,
    finalization: reference('achievement-reconciliation-finalization', 'fixture'),
    competition: 'AFLM' as const,
    seasonYear: 2026,
  });
  const achievement = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    reconciledAchievementId: reference('reconciled-achievement', 'fixture').id,
    achievementRunId: achievementRun.achievementRunId,
    subjectKey: reference('reconciled-achievement-subject', 'fixture').id,
    headRevision: 1,
    playerId: spell.playerId,
    clubId: null,
    competition: 'AFLM' as const,
    seasonYear: 2026,
    achievementCode: 'all_australian_team' as const,
    definition: reference('achievement-definition', 'all-australian/v1'),
    grain: achievementGrain,
    state: 'affirmed' as const,
    effectiveThrough: reconciledMetric.effectiveThrough,
  });
  const spellMetric = sealMember({
    ordinal: 1,
    recordedAt: '2025-12-31T23:59:59.000Z',
    spellMetricVersionId: reference('acquisition-spell-metric-version', 'fixture').id,
    subjectKey: reference('acquisition-spell-metric-subject', 'fixture').id,
    headRevision: 1,
    spellVersionId: spell.spellVersionId,
    policyId: reference('acquisition-spell-metric-policy', 'fixture').id,
    playerId: spell.playerId,
    clubId: spell.clubId,
    metricCode: 'games' as const,
    definition: reference('metric-definition', 'games/v1'),
    state: 'complete' as const,
    effectiveThrough: '2025-12-31',
  });
  const reviewDecision = sealMember({
    ordinal: 1,
    recordedAt: instant(0),
    decisionId: 'review-decision:fixture',
    subjectType: 'factual_release_candidate',
  });
  const members = {
    sourceCaptures: [sourceCapture],
    eventVersions: [eventVersion],
    lineageEdges,
    acquisitionSpells,
    factualRuns: [factualRun],
    reconciledMetrics: [reconciledMetric],
    achievementRuns: [achievementRun],
    reconciledAchievements: [achievement],
    spellMetrics: [spellMetric],
    reviewDecisions: [reviewDecision],
  };
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const targetReleaseManifest = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...releaseFixture.release.content,
    schemaVersion: 'afl-draft-trade-outcome-release/v2',
    factualCandidateSchemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    sourceMemberSetSha256: memberSetSha256,
    createdAt: instant(1),
    effectiveThrough: reconciledMetric.effectiveThrough,
    outcomeRecordCount: 3,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
    sourceRightsBindings: [sourceBinding],
  });
  const factualCandidate = createAflTradeFactualReleaseCandidate({
    schemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    scopeKey: targetReleaseManifest.content.scopeKey,
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2026,
    createdAt: instant(5),
    effectiveThrough: reconciledMetric.effectiveThrough,
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
      lineageEdges: lineageEdges.length,
      acquisitionSpells: acquisitionSpells.length,
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
  });
  const projection = factualProjection(factualCandidate);
  let registry = registerAflDraftTradeOutcomeRelease(createAflDraftTradeOutcomeReleaseRegistry(), {
    expectedRevision: 0,
    manifest: targetReleaseManifest,
    actor: 'fixture-builder',
    evidenceId: factualCandidate.candidateId,
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'validate',
    releaseId: targetReleaseManifest.releaseId,
    expectedRevision: registry.revision,
    occurredAt: instant(6),
    actor: 'fixture-reviewer',
    evidenceId: projection.projectionId,
    environment: 'test_fixture',
    projectionManifest: projection,
    gateDecisionLedger: capture.ledger,
  });
  const review = createAflTradeGateDecisionFixture({
    gate: 'gate_4_publication_api_readiness',
    decisionKey: 'fixture-factual-approval',
    decidedAt: instant(7),
    revalidateAt: '2027-10-01T00:00:00.000Z',
    affectedArtifacts: [
      { kind: 'factual_release', artifactId: targetReleaseManifest.releaseId },
      { kind: 'factual_projection', artifactId: projection.projectionId },
    ],
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'approve',
    releaseId: targetReleaseManifest.releaseId,
    expectedRevision: registry.revision,
    occurredAt: instant(7),
    actor: 'fixture-reviewer',
    evidenceId: review.decisionId,
    environment: 'test_fixture',
    gateDecisionId: review.decisionId,
    gateDecisionLedger: review.ledger,
  });
  const record = registry.releases[targetReleaseManifest.releaseId];
  const approvalEvent = registry.events.at(-1)!;
  const corpusId = `corpus:${digest('7')}`;
  const corpusLineage = createAflTradeCorpusFactualLineage({
    schemaVersion: AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION,
    environment: 'test_fixture',
    scopeKey: factualCandidate.content.scopeKey,
    competition: 'AFLM',
    createdAt: instant(7),
    corpusId,
    factualReleaseId: targetReleaseManifest.releaseId,
    factualCandidateId: factualCandidate.candidateId,
    sourceMemberSetSha256: memberSetSha256,
    memberMappings: allMemberMappings(factualCandidate.content.members),
    sourceMappings: [
      {
        captureId,
        sourceSnapshotId: sourceCapture.sourceSnapshotId,
        consumedFieldSetId: consumedFieldSet.fieldSetId,
        consumedFieldSetSha256: consumedFieldSet.content.fieldSetSha256,
      },
    ],
    domainLineageMappings: acquisitionSpells.map((member, index) => {
      const edge = lineageEdges[index];
      return {
        eventId: eventVersion.eventId,
        eventVersionId: eventVersion.eventVersionId,
        acquisitionSpellId: member.spellId!,
        acquisitionSpellVersionId: member.spellVersionId,
        playerId: member.playerId,
        clubId: member.clubId,
        lineageEdgeIds: [edge.edgeId],
      };
    }),
  });
  return {
    factualCandidate,
    registry,
    record,
    approvalEvent,
    corpusId,
    corpusLineage,
    consumedFieldSet,
    sourceCapture,
    eventVersion,
    lineageEdge,
    lineageEdges,
    spell,
    spells: acquisitionSpells,
    reconciledMetric,
    achievement,
    spellMetric,
    sourceSnapshot: capture.snapshot,
  };
}

function identityAuthority(
  entityKind: 'player' | 'club',
  entityId: string,
  options: {
    environment?: 'test_fixture' | 'non_production' | 'production';
    competition?: 'AFLM' | 'AFLW';
    seasonYear?: number;
    validFromSeason?: number;
    validThroughSeason?: number;
    temporalAlias?: boolean;
  } = {}
) {
  const environment = options.environment ?? 'test_fixture';
  const competition = options.competition ?? 'AFLM';
  const seasonYear = options.seasonYear ?? 2026;
  const validFromSeason = options.validFromSeason ?? seasonYear;
  const validThroughSeason = options.validThroughSeason ?? seasonYear;
  const capabilityId = 'official-afl-player-stats';
  const namespaceVersion = `fixture-${entityKind}/v1`;
  const definitionSha256 = digest(entityKind === 'player' ? '7' : '8');
  const namespaceId = createAflTradeContentAddress('provider-native-id-namespace', {
    environment,
    provider: 'official_afl',
    capabilityId,
    entityKind,
    namespaceVersion,
    identityScope: { kind: 'competition', competition },
    definitionSha256,
  });
  const governedNamespace = {
    namespaceId,
    definitionSha256,
    environment,
    provider: 'official_afl',
    capabilityId,
    entityKind,
    namespaceVersion,
    identityScope: { kind: 'competition' as const, competition },
    validFromSeason,
    validThroughSeason,
    approvalDecision: reference('provider-namespace-approval-decision', entityKind),
  };
  const identityCandidateId = `identity-candidate:${entityKind}`;
  const staging = {
    normalizationRunId: 'provider-normalization-run:fixture',
    stagingSha256: digest('9'),
    providerDecodedRowId: `provider-decoded-row:${entityKind}`,
    sourceRowSha256: digest('a'),
    candidateSha256: digest(entityKind === 'player' ? 'b' : 'c'),
    environment,
    provider: 'official_afl',
    capabilityId,
    fieldMapSha256: digest('d'),
    normalizationFinalization: reference('provider-normalization-finalization', 'fixture'),
    rowStatus: 'staged' as const,
    issueSet: reference('provider-resolution-issue-set', entityKind),
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    nativeIdNamespace: options.temporalAlias ? null : governedNamespace,
    competition,
    seasonYear,
  };
  const nativeId = `provider-${entityKind}-fixture`;
  const normalizationPolicy = reference('provider-resolution-policy', 'fixture-alias');
  const aliasId = createAflTradeContentAddress('provider-club-alias', {
    provider: staging.provider,
    competition,
    normalizationPolicyId: normalizationPolicy.id,
    normalizedName: 'fixture club',
    validFromSeason,
    validThroughSeason,
  });
  const providerIdentityId =
    options.temporalAlias && entityKind === 'club'
      ? aliasId
      : createAflTradeContentAddress(
          entityKind === 'player' ? 'provider-player-identity' : 'provider-club-identity',
          {
            nativeIdNamespaceId: namespaceId,
            [entityKind === 'player' ? 'nativePlayerId' : 'nativeClubId']: nativeId,
          }
        );
  const assignmentEntityKind =
    options.temporalAlias && entityKind === 'club' ? ('club_alias' as const) : entityKind;
  const assignmentCaseId = createAflTradeContentAddress('provider-identity-assignment-case', {
    entityKind: assignmentEntityKind,
    identityId: providerIdentityId,
  });
  const occurrence = { source: 'player_affiliation' as const, identityCandidateId };
  const proposal = createAflTradeProviderResolutionProposal({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
    resolutionCaseId: createAflTradeContentAddress(
      'provider-resolution-case',
      entityKind === 'player'
        ? { subjectType: 'provider_player_candidate', identityCandidateId }
        : { subjectType: 'provider_club_candidate', occurrence }
    ),
    method: reference('provider-resolution-method', 'fixture'),
    staging,
    canonicalTargetSnapshot: reference('canonical-target-snapshot', entityKind),
    supportingEvidence: [reference('provider-resolution-evidence', entityKind)],
    proposedAt: instant(8),
    ...(entityKind === 'player'
      ? {
          subjectType: 'provider_player_candidate' as const,
          identityCandidateId,
          candidate: {
            nativePlayerId: nativeId,
            recordedName: 'Fixture Player',
            recordedClubId: 'provider-club-fixture',
            recordedClubName: 'Fixture Club',
          },
          proposedTarget: {
            scope: 'provider_identity' as const,
            playerIdentityId: providerIdentityId,
            assignmentCaseId,
            playerId: entityId,
          },
          alternativePlayerIds: [],
        }
      : {
          subjectType: 'provider_club_candidate' as const,
          occurrence,
          candidate: {
            nativeClubId: options.temporalAlias ? null : nativeId,
            recordedName: 'Fixture Club',
          },
          proposedTarget: options.temporalAlias
            ? {
                scope: 'temporal_alias' as const,
                clubId: entityId,
                validFromSeason,
                validThroughSeason,
                normalizedName: 'fixture club',
                aliasId,
                assignmentCaseId,
                normalizationPolicy,
              }
            : {
                scope: 'provider_identity' as const,
                clubIdentityId: providerIdentityId,
                assignmentCaseId,
                clubId: entityId,
              },
          alternativeClubIds: [],
        }),
  });
  const decision = createAflTradeProviderResolutionDecision({
    schemaVersion: AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
    proposal,
    expectedRevision: 0,
    supersedesDecisionId: null,
    assignmentRevision: {
      assignmentCaseId,
      entityKind: assignmentEntityKind,
      identityId: providerIdentityId,
      expectedRevision: 0,
      supersedesDecisionId: null,
      nextStatus: 'active',
    },
    outcome: 'approved',
    rationale: 'The exact fixture candidate and canonical identity were independently reviewed.',
    reviewerAuthority: {
      principalRef: 'operator:fixture-reviewer',
      authorityEvidence: reference('reviewer-authority-evidence', entityKind),
      role: 'afl_trade_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: staging.provider,
      capabilityId: staging.capabilityId,
      competition: staging.competition,
      validFromSeason,
      validThroughSeason,
    },
    effectiveAt: instant(9),
    decidedAt: instant(9),
  });
  return {
    entityKind,
    entityId,
    decision,
    resolutionHead: {
      resolutionCaseId: proposal.content.resolutionCaseId,
      revision: 1,
      resolutionId: decision.decisionId,
      updatedAt: instant(9),
    },
    assignmentHead: {
      assignmentCaseId,
      entityKind: assignmentEntityKind,
      identityId: providerIdentityId,
      revision: 1,
      decisionId: decision.decisionId,
      status: 'active' as const,
      updatedAt: instant(9),
    },
    authenticatedAt: instant(9),
  };
}

function datasetFixture(
  options: {
    achievementGrain?: 'season' | 'round';
    useAchievementTarget?: boolean;
    additionalSpell?: boolean;
    playerAuthorityOptions?: Parameters<typeof identityAuthority>[2];
    clubAuthorityOptions?: Parameters<typeof identityAuthority>[2];
  } = {}
) {
  const factual = factualFixture(options.achievementGrain, options.additionalSpell);
  const playerAuthority = identityAuthority(
    'player',
    factual.spell.playerId,
    options.playerAuthorityOptions
  );
  const clubAuthority = identityAuthority(
    'club',
    factual.spell.clubId,
    options.clubAuthorityOptions
  );
  const playerDecisionId = playerAuthority.decision.decisionId;
  const clubDecisionId = clubAuthority.decision.decisionId;
  const featureInput = {
    kind: 'acquisition_spell_metric' as const,
    memberId: factual.spellMetric.spellMetricVersionId,
    recordSha256: factual.spellMetric.recordSha256,
    headRevision: factual.spellMetric.headRevision,
    effectiveFrom: factual.spell.startDate,
    effectiveThrough: factual.spellMetric.effectiveThrough,
    recordedAt: factual.spellMetric.recordedAt,
    state: factual.spellMetric.state,
    playerId: factual.spellMetric.playerId,
    clubId: factual.spellMetric.clubId,
    spellVersionId: factual.spellMetric.spellVersionId,
    metricCode: factual.spellMetric.metricCode,
  };
  const targetInput = {
    kind: 'reconciled_achievement' as const,
    memberId: factual.achievement.reconciledAchievementId,
    recordSha256: factual.achievement.recordSha256,
    headRevision: factual.achievement.headRevision,
    effectiveFrom: '2026-01-01',
    effectiveThrough: factual.achievement.effectiveThrough,
    recordedAt: factual.achievement.recordedAt,
    state: factual.achievement.state,
    playerId: factual.achievement.playerId,
    clubId: factual.achievement.clubId,
    competition: factual.achievement.competition,
    seasonYear: factual.achievement.seasonYear,
    achievementCode: factual.achievement.achievementCode,
  };
  const row = createAflTradeValuationDatasetRow({
    schemaVersion: AFL_TRADE_VALUATION_DATASET_ROW_SCHEMA_VERSION,
    ordinal: 1,
    rowKey: 'afl-player:fixture|spell:fixture|2026-01-01',
    competition: 'AFLM',
    seasonYear: 2026,
    cohortIds: ['era:modern', 'role:key-forward'],
    predictionOriginAt: '2025-12-31T23:59:59.000Z',
    featureKnownThrough: '2025-12-31T23:59:59.000Z',
    targetFrom: '2026-01-01T00:00:00.000Z',
    targetThrough: factual.reconciledMetric.effectiveThrough,
    splitRole: 'final_test',
    leakageGroups: {
      acquisition_spell: factual.spell.spellId,
      event: factual.eventVersion.eventId,
      player: factual.spell.playerId,
    },
    identity: {
      playerId: factual.spell.playerId,
      playerResolutionDecisionId: playerDecisionId,
      playerAssignmentRevision: 1,
      clubId: factual.spell.clubId,
      clubResolutionDecisionId: clubDecisionId,
      clubAssignmentRevision: 1,
    },
    lineage: {
      eventId: factual.eventVersion.eventId,
      eventVersionId: factual.eventVersion.eventVersionId,
      acquisitionSpellId: factual.spell.spellId,
      acquisitionSpellVersionId: factual.spell.spellVersionId,
      lineageEdgeIds: [factual.lineageEdge.edgeId],
    },
    featureInputs: [featureInput],
    targetInputs: [targetInput],
  });
  const parent = {
    corpusId: factual.corpusId,
    corpusToCandidateLineageId: factual.corpusLineage.lineageId,
    factualReleaseId: factual.factualCandidate.content.targetRelease.id,
    factualCandidateId: factual.factualCandidate.candidateId,
    sourceMemberSetSha256: factual.factualCandidate.content.memberSetSha256,
    archiveDatasetId: factual.factualCandidate.content.archiveDataset.id,
    sourceSnapshotSetId: factual.factualCandidate.content.sourceSnapshotSet.id,
    metricRegistryVersion: factual.factualCandidate.content.metricRegistryVersion,
    acquisitionSpellRuleId: factual.factualCandidate.content.acquisitionSpellRule.id,
    factualEffectiveThrough: factual.factualCandidate.content.effectiveThrough,
    releaseRecordStateId: createAflTradeContentAddress(
      'outcome-release-record-state',
      factual.record
    ),
    releaseApprovalEventId: factual.approvalEvent.eventId,
    releaseRegistryRevision: factual.registry.revision,
  };
  const spec = specification();
  const datasetArtifact = artifact([row], 10);
  const dataset = createAflTradeValuationDatasetCandidate({
    schemaVersion: AFL_TRADE_VALUATION_DATASET_CANDIDATE_SCHEMA_VERSION,
    authorityBoundary:
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    scopeKey: factual.factualCandidate.content.scopeKey,
    competition: 'AFLM',
    createdAt: instant(10),
    knowledgeCutoffAt: instant(5),
    factualParent: parent,
    specification: spec,
    requiredSourceUses: {
      operations: ['derived_feature_creation', 'model_training'],
      fieldUses: ['derived_feature', 'model_training'],
      publicDerivedOutput: 'not_authorized_by_dataset_admission',
      revalidateAtModelRunStart: true,
    },
    includedCohorts: ['era:modern', 'role:key-forward'],
    excludedCohorts: ['era:unsupported'],
    rows: [row],
    exclusionReport: artifact({ exclusions: ['era:unsupported'] }, 10),
    datasetArtifact,
    extractor: {
      codeArtifact: artifact({ code: 'fixture-extractor' }, 10),
      configurationArtifact: artifact({ config: 'fixture' }, 10),
    },
  });
  return { dataset, row, featureInput, targetInput, factual, playerAuthority, clubAuthority };
}

function gateLedger(input: {
  gate: AflTradeGateCode;
  decisionKey: string;
  affectedArtifacts: readonly { kind: AflTradeGovernedArtifactKind; artifactId: string }[];
  dimensions: readonly { name: string; values: readonly string[] }[];
  decidedAt?: string;
  revalidateAt?: string;
}): AflTradeGateDecisionLedger {
  const conditionEvidence = `artifact:${digest('1')}`;
  const decidedAt = input.decidedAt ?? instant(1);
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope: {
      scopeKey: input.decisionKey,
      description: 'Fabricated admission evidence for deterministic unit tests.',
      dimensions: input.dimensions,
      exclusions: ['All non-fixture operations'],
    },
    proposal: 'Permit the exact fixture-only operation.',
    alternativesConsidered: ['Keep the fixture operation blocked.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: ['fixture-reviewer'],
    conditions: [
      {
        conditionId: 'fixture-condition',
        description: 'Use test fixtures only.',
        required: true,
        verificationEvidenceIds: [conditionEvidence],
      },
    ],
    evidenceIds: [conditionEvidence],
    affectedArtifacts: input.affectedArtifacts,
    proposedAt: instant(0),
    proposedBy: 'fixture-proposer',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [
      {
        reviewerId: 'fixture-independent-reviewer',
        role: 'fixture-reviewer',
        evidenceId: conditionEvidence,
      },
    ],
    authorityEvidenceIds: [conditionEvidence],
    conditionResults: [
      {
        conditionId: 'fixture-condition',
        status: 'satisfied' as const,
        evidenceIds: [conditionEvidence],
        explanation: 'The fixture-only condition is satisfied.',
      },
    ],
    rationale: 'The fixture-only evidence is sufficient for contract tests.',
    limitations: ['No production authority.'],
    decidedAt,
    effectiveAt: decidedAt,
    revalidateAt: input.revalidateAt ?? '2027-10-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: input.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposals: [proposal], decisions: [decision] };
}

function sourceRightsEvidence(fixture: ReturnType<typeof datasetFixture>) {
  const source = fixture.factual.sourceCapture;
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'fixture-source-register',
    provider: 'Fixture provider',
    dataset: 'Fixture AFL facts',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Fixture-only feature derivation and model-training contract tests.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'manual_review' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/json',
      deliveryMethod: 'Fabricated unit-test artifact',
    },
    operations: {
      bounded_evaluation_capture: 'blocked' as const,
      raw_evidence_retention: 'blocked' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: false,
      identification: null,
      rateLimit: null,
      cache: { permitted: false, maximumSeconds: null },
    },
    retention: {
      rawEvidence: {
        disposition: 'prohibited' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Fixture raw bytes are not retained.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Fixture evidence only.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Fixture evidence only.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: { required: false, text: null, placement: null },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: [
      {
        sourceField: 'games',
        normalizedField: 'games',
        uses: {
          archive_fact: 'allowed' as const,
          model_training: 'allowed' as const,
          derived_feature: 'allowed' as const,
          public_display: 'blocked' as const,
        },
        attributionRequired: false,
        notes: null,
      },
    ],
    conditions: [],
    rightsEvidenceIds: [`artifact:${digest('2')}`],
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-10-01T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fixture derivatives.',
      retainableAuditMaterial: 'Retain hashes only.',
    },
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const rightsProposal = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const decisionKey = 'fixture-model-rights';
  const requestBase = {
    decisionKey,
    environment: 'test_fixture' as const,
    rightsArtifactId: rightsProposal.rightsArtifactId,
    competition: 'AFLM',
    season: 2026,
    accessMechanism: 'manual_review' as const,
    capabilityId: null,
    geography: 'fixture',
    commercialContext: 'fixture',
    audience: 'internal_fixture',
    operations: ['derived_feature_creation', 'model_training'] as const,
    fieldUses: [
      { sourceField: 'games', use: 'derived_feature' as const },
      { sourceField: 'games', use: 'model_training' as const },
    ],
    rawRetentionDays: null,
    metadataRetentionDays: 365,
    cacheSeconds: null,
  };
  const ledger = gateLedger({
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rightsProposal.rightsArtifactId }],
    dimensions: [
      { name: 'source_rights_artifact', values: [rightsProposal.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: ['manual_review'] },
      { name: 'geography', values: ['fixture'] },
      { name: 'commercial_context', values: ['fixture'] },
      { name: 'audience', values: ['internal_fixture'] },
      { name: 'operation', values: ['derived_feature_creation', 'model_training'] },
    ],
  });
  return {
    captureId: source.captureId,
    sourceSnapshotId: source.sourceSnapshotId,
    consumedFieldSetId: fixture.factual.consumedFieldSet.fieldSetId,
    sourceSnapshotManifest: fixture.factual.sourceSnapshot,
    rightsProposal,
    derivationReceipt: createAflTradeGate0AReceipt(
      ledger,
      rightsProposal,
      { ...requestBase, evaluatedAt: instant(9) },
      instant(9)
    ),
    admissionReceipt: createAflTradeGate0AReceipt(
      ledger,
      rightsProposal,
      { ...requestBase, evaluatedAt: instant(20) },
      instant(20)
    ),
    gateLedger: ledger,
  };
}

function operationReceipt(
  fixture: ReturnType<typeof datasetFixture>,
  authorityKind: 'analytical_authority' | 'operational_authorization'
) {
  const content = {
    schemaVersion: 'afl-trade-architecture-operation-authorization/v1' as const,
    operation: 'materialize_feature_dataset' as const,
    authorityKind,
    environment: 'test_fixture' as const,
    scopeKey: fixture.dataset.content.scopeKey,
    datasetId: fixture.dataset.datasetId,
    factualReleaseId: fixture.dataset.content.factualParent.factualReleaseId,
    factualCandidateId: fixture.dataset.content.factualParent.factualCandidateId,
    authorizedAt: instant(9),
    validThrough: '2027-10-01T00:00:00.000Z',
    principalRef: `fixture-${authorityKind}`,
  };
  return {
    receiptId: createAflTradeContentAddress('architecture-operation-receipt', content),
    content,
  };
}

function evidenceFor(fixture: ReturnType<typeof datasetFixture>) {
  const parent = fixture.dataset.content.factualParent;
  const gate2Ledger = gateLedger({
    gate: 'gate_2_corpus_lineage',
    decisionKey: 'fixture-corpus-lineage',
    decidedAt: instant(8),
    affectedArtifacts: [
      { kind: 'corpus_manifest', artifactId: parent.corpusId },
      { kind: 'corpus_factual_lineage', artifactId: parent.corpusToCandidateLineageId },
      { kind: 'factual_release', artifactId: parent.factualReleaseId },
      { kind: 'factual_release_candidate', artifactId: parent.factualCandidateId },
    ],
    dimensions: [{ name: 'scope', values: [fixture.dataset.content.scopeKey] }],
  });
  const expectedReferences = [
    fixture.dataset.content.datasetArtifact,
    fixture.dataset.content.exclusionReport,
    fixture.dataset.content.extractor.codeArtifact,
    fixture.dataset.content.extractor.configurationArtifact,
    ...fixture.dataset.content.specification.content.featureDefinitions,
    fixture.dataset.content.specification.content.targetDefinition,
    fixture.dataset.content.specification.content.valueUnitDefinition,
    fixture.dataset.content.specification.content.roleTaxonomy,
    fixture.dataset.content.specification.content.eraDefinition,
    fixture.dataset.content.specification.content.censoringDefinition,
    fixture.dataset.content.specification.content.inclusionPolicy,
  ];
  return {
    schemaVersion: AFL_TRADE_VALUATION_DATASET_ADMISSION_EVIDENCE_SCHEMA_VERSION,
    authenticatedAt: instant(20),
    factualCandidate: fixture.factual.factualCandidate,
    factualCandidateFinalizedAt: instant(5),
    releaseRegistry: fixture.factual.registry,
    corpusLineage: fixture.factual.corpusLineage,
    consumedFieldSets: [fixture.factual.consumedFieldSet],
    gate2Ledger,
    gate2DecisionKey: 'fixture-corpus-lineage',
    sourceRights: [sourceRightsEvidence(fixture)],
    identityAuthorities: [fixture.clubAuthority, fixture.playerAuthority],
    domainLineageAuthorities: fixture.factual.corpusLineage.content.domainLineageMappings.map(
      (mapping) => {
        const spell = fixture.factual.spells.find(
          ({ spellVersionId }) => spellVersionId === mapping.acquisitionSpellVersionId
        );
        const edges = mapping.lineageEdgeIds.map((edgeId) =>
          fixture.factual.lineageEdges.find((edge) => edge.edgeId === edgeId)
        );
        if (!spell || edges.some((edge) => edge === undefined)) {
          throw new Error('Fixture corpus lineage must resolve every factual member.');
        }
        return {
          eventVersionId: fixture.factual.eventVersion.eventVersionId,
          eventId: fixture.factual.eventVersion.eventId,
          eventRecordSha256: fixture.factual.eventVersion.recordSha256,
          acquisitionSpellId: spell.spellId!,
          acquisitionSpellVersionId: spell.spellVersionId,
          playerId: spell.playerId,
          clubId: spell.clubId,
          lineageEdges: edges.map((edge) => ({
            edgeId: edge!.edgeId,
            recordSha256: edge!.recordSha256,
          })),
          authenticatedAt: instant(9),
        };
      }
    ),
    rowAuthorities: [
      {
        rowId: fixture.row.rowId,
        identity: fixture.row.content.identity,
        ...fixture.row.content.lineage,
      },
    ],
    artifactBytes: [
      ...new Map(
        expectedReferences.map((reference) => [
          reference.artifactId,
          { artifactId: reference.artifactId, bytes: retainedBytes.get(reference.artifactId)! },
        ])
      ).values(),
    ],
    analyticalAuthority: operationReceipt(fixture, 'analytical_authority'),
    operationalAuthorization: operationReceipt(fixture, 'operational_authorization'),
  };
}

describe('valuation dataset admission contracts', () => {
  it('keeps legacy dataset-v1 readable while v4 remains private and player-specific', () => {
    const content = {
      schemaVersion: 'afl-trade-dataset/v1' as const,
      environment: 'test_fixture' as const,
      createdAt: instant(2),
      corpusId: `corpus:${digest('2')}`,
      gate2DecisionId: `gate-decision:${digest('3')}`,
      sourceRegisterIds: ['source:fixture'],
      knowledgeCutoffAt: instant(1),
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: '2021-01-01T00:00:00.000Z',
      rowCount: 1,
      includedCohorts: ['fixture'],
      excludedCohorts: [],
      featureDefinitionArtifacts: [artifact({ legacy: 'feature' })],
      featureSchemaArtifact: artifact({ legacy: 'schema' }),
      targetDefinitionArtifact: artifact({ legacy: 'target' }),
      splitAssignmentArtifact: artifact({ legacy: 'split' }),
      datasetArtifact: artifact({ legacy: 'dataset' }),
    };
    const legacy = aflTradeDatasetManifestSchema.parse({
      datasetId: createAflTradeContentAddress('dataset', content),
      content,
    });
    const fixture = datasetFixture();
    expect(parseAflTradeAnyDatasetManifest(legacy).content.schemaVersion).toBe(
      'afl-trade-dataset/v1'
    );
    expect(fixture.dataset.content.publicationEligible).toBe(false);
    expect(JSON.stringify(fixture.dataset)).not.toMatch(/"(?:grade|userId|leagueId)"\s*:/);
  });

  it('rejects valid-time leakage and preserves independent member IDs and record digests', () => {
    const fixture = datasetFixture();
    expect(fixture.targetInput.memberId.endsWith(fixture.targetInput.recordSha256)).toBe(false);
    expect(() =>
      createAflTradeValuationDatasetRow({
        ...fixture.row.content,
        featureInputs: [{ ...fixture.featureInput, effectiveThrough: '2026-01-01' }],
      })
    ).toThrow(/prediction origin/i);
    expect(() =>
      createAflTradeValuationDatasetRow({
        ...fixture.row.content,
        targetInputs: [{ ...fixture.targetInput, effectiveFrom: '2025-01-01' }],
      })
    ).toThrow(/target/i);
  });

  it('requires stable row-key order rather than a row-id fixed point', () => {
    const fixture = datasetFixture();
    const second = createAflTradeValuationDatasetRow({
      ...fixture.row.content,
      ordinal: 2,
      rowKey: 'zz-second-row',
    });
    expect(() =>
      createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        rows: [second, fixture.row],
      } as never)
    ).toThrow(/row keys/i);
  });

  it('rejects caller-invented leakage groups that do not equal authoritative row identities', () => {
    const fixture = datasetFixture();
    expect(() =>
      createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        rows: [
          createAflTradeValuationDatasetRow({
            ...fixture.row.content,
            leakageGroups: { ...fixture.row.content.leakageGroups, player: 'synthetic-player' },
          }),
        ],
      } as never)
    ).toThrow(/authoritative player, event, or acquisition spell identity/i);
    expect(() =>
      createAflTradeValuationDatasetCandidate({
        ...fixture.dataset.content,
        rows: [
          createAflTradeValuationDatasetRow({
            ...fixture.row.content,
            leakageGroups: {
              ...fixture.row.content.leakageGroups,
              event: fixture.row.content.lineage.eventVersionId,
            },
          }),
        ],
      } as never)
    ).toThrow(/authoritative player, event, or acquisition spell identity/i);
  });

  it('rejects reconciled metrics until factual membership exposes exact metric grain and match time', () => {
    const fixture = datasetFixture();
    expect(() =>
      createAflTradeValuationDatasetRow({
        ...fixture.row.content,
        targetInputs: [
          {
            kind: 'reconciled_metric',
            memberId: fixture.factual.reconciledMetric.reconciledFactId,
            recordSha256: fixture.factual.reconciledMetric.recordSha256,
            headRevision: fixture.factual.reconciledMetric.headRevision,
            effectiveFrom: '2026-01-01',
            effectiveThrough: fixture.factual.reconciledMetric.effectiveThrough,
            recordedAt: fixture.factual.reconciledMetric.recordedAt,
            state: fixture.factual.reconciledMetric.state,
            playerId: fixture.factual.reconciledMetric.playerId,
            clubId: fixture.factual.reconciledMetric.clubId,
            competition: fixture.factual.reconciledMetric.competition,
            seasonYear: fixture.factual.reconciledMetric.seasonYear,
            metricCode: fixture.factual.reconciledMetric.metricCode,
          } as never,
        ],
      })
    ).toThrow();
  });

  it('binds admission receipts to exact captures and consumed-field artifacts', () => {
    const fixture = datasetFixture();
    const source = sourceRightsEvidence(fixture);
    const receipt = createAflTradeValuationDatasetAdmissionReceipt({
      schemaVersion: AFL_TRADE_VALUATION_DATASET_ADMISSION_SCHEMA_VERSION,
      authorityBoundary:
        'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      admittedAt: instant(20),
      datasetCreatedAt: fixture.dataset.content.createdAt,
      datasetId: fixture.dataset.datasetId,
      datasetSha256: fixture.dataset.datasetId.slice('dataset:'.length),
      factualReleaseId: fixture.dataset.content.factualParent.factualReleaseId,
      factualCandidateId: fixture.dataset.content.factualParent.factualCandidateId,
      sourceMemberSetSha256: fixture.dataset.content.factualParent.sourceMemberSetSha256,
      corpusId: fixture.dataset.content.factualParent.corpusId,
      corpusToCandidateLineageId: fixture.dataset.content.factualParent.corpusToCandidateLineageId,
      gate2Decision: {
        decisionId: `gate-decision:${digest('1')}`,
        state: 'approved',
        effectiveAt: instant(8),
        evaluatedAt: instant(20),
        revalidateAt: '2027-10-01T00:00:00.000Z',
        pinnedCorpusId: fixture.dataset.content.factualParent.corpusId,
        pinnedCorpusToCandidateLineageId:
          fixture.dataset.content.factualParent.corpusToCandidateLineageId,
        pinnedFactualReleaseId: fixture.dataset.content.factualParent.factualReleaseId,
        pinnedFactualCandidateId: fixture.dataset.content.factualParent.factualCandidateId,
      },
      sourceRightsEvaluations: [
        {
          captureId: source.captureId,
          sourceSnapshotId: source.sourceSnapshotId,
          consumedFieldSetId: source.consumedFieldSetId,
          proposalId: source.rightsProposal.rightsArtifactId,
          derivationDecisionId: source.derivationReceipt.content.result.decisionId!,
          derivationEvaluationReceiptId: source.derivationReceipt.receiptId,
          derivationEvaluatedAt: source.derivationReceipt.content.request.evaluatedAt,
          admissionDecisionId: source.admissionReceipt.content.result.decisionId!,
          admissionEvaluationReceiptId: source.admissionReceipt.receiptId,
          admissionEvaluatedAt: source.admissionReceipt.content.request.evaluatedAt,
          consumedFieldSetSha256: fixture.factual.consumedFieldSet.content.fieldSetSha256,
          operations: ['derived_feature_creation', 'model_training'],
          fieldUses: ['derived_feature', 'model_training'],
          status: 'approved',
          termsValidThrough: source.rightsProposal.content.termsExpireAt,
        },
      ],
      analyticalAuthorityReceiptId: operationReceipt(fixture, 'analytical_authority').receiptId,
      operationalAuthorizationReceiptId: operationReceipt(fixture, 'operational_authorization')
        .receiptId,
    });
    expect(receipt.content.sourceRightsEvaluations[0]).toMatchObject({
      captureId: source.captureId,
      consumedFieldSetId: source.consumedFieldSetId,
    });
    expect(receipt.content.gate2Decision).not.toHaveProperty('pinnedDatasetId');
  });
});

describe('valuation dataset admission service', () => {
  it('admits a canonical approved release with byte-backed evidence and no fitting or grading', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    expect(() =>
      authenticateAflDraftTradeOutcomeReleaseRegistry(evidence.releaseRegistry)
    ).not.toThrow();
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return evidence;
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toMatchObject({ status: 'admitted', blockers: [] });
    if (result.status !== 'admitted') throw new Error(JSON.stringify(result.blockers));
    expect(result.receipt.content.publicationEligible).toBe(false);
    expect(result.receipt.content.datasetId).toBe(fixture.dataset.datasetId);
  });

  it('rejects round-grain achievements until authoritative round valid-time is represented', async () => {
    const fixture = datasetFixture({ achievementGrain: 'round', useAchievementTarget: true });
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return evidenceFor(fixture);
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'FACTUAL_MEMBERSHIP_MISMATCH' }),
      ]),
    });
  });

  it('admits one multi-player event with two independently sealed acquisition spells', async () => {
    const fixture = datasetFixture({ additionalSpell: true });
    const evidence = evidenceFor(fixture);
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return evidence;
      },
    });
    const admitted = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(admitted.status).toBe('admitted');

    const substituted = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return {
          ...evidence,
          domainLineageAuthorities: evidence.domainLineageAuthorities.map((authority, index) =>
            index === 1
              ? { ...authority, acquisitionSpellId: 'acquisition-spell:substituted' }
              : authority
          ),
        };
      },
    });
    const blocked = await substituted.admit({
      dataset: fixture.dataset,
      admittedAt: instant(20),
    });
    expect(blocked).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE' }),
      ]),
    });
  });

  it.each([
    {
      label: 'cross-environment player authority',
      options: { playerAuthorityOptions: { environment: 'non_production' as const } },
    },
    {
      label: 'cross-competition player authority',
      options: { playerAuthorityOptions: { competition: 'AFLW' as const } },
    },
    {
      label: 'out-of-season player authority',
      options: { playerAuthorityOptions: { seasonYear: 2025 } },
    },
    {
      label: 'expired temporal club alias',
      options: {
        clubAuthorityOptions: {
          seasonYear: 2025,
          validFromSeason: 2025,
          validThroughSeason: 2025,
          temporalAlias: true,
        },
      },
    },
  ])('rejects $label', async ({ options }) => {
    const fixture = datasetFixture(options);
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return evidenceFor(fixture);
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE' }),
      ]),
    });
  });

  it('rejects candidate finalization that predates the candidate it claims to seal', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return { ...evidence, factualCandidateFinalizedAt: instant(4) };
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'EVIDENCE_CHRONOLOGY_INVALID' }),
      ]),
    });
  });

  it('rejects a historical release event and substituted domain-lineage authority', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const historicalEventId = evidence.releaseRegistry.events[0].eventId;
    const alteredDataset = createAflTradeValuationDatasetCandidate({
      ...fixture.dataset.content,
      factualParent: {
        ...fixture.dataset.content.factualParent,
        releaseApprovalEventId: historicalEventId,
      },
    });
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return {
          ...evidence,
          domainLineageAuthorities: evidence.domainLineageAuthorities.map((authority) => ({
            ...authority,
            playerId: 'afl-player:substituted',
          })),
        };
      },
    });
    const result = await service.admit({ dataset: alteredDataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'FACTUAL_ANCESTRY_MISMATCH' }),
        expect.objectContaining({ code: 'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE' }),
      ]),
    });
  });

  it('fails closed when no authenticator evidence is available', async () => {
    const fixture = datasetFixture();
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return null;
      },
    });
    await expect(
      service.admit({ dataset: fixture.dataset, admittedAt: instant(20) })
    ).resolves.toEqual({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'AUTHENTICATOR_UNAVAILABLE' })],
    });
  });

  it('rejects a hand-built approved release that bypasses validation and projection authority', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const forgedRegistry = structuredClone(evidence.releaseRegistry);
    Object.assign(forgedRegistry.releases, {
      [fixture.dataset.content.factualParent.factualReleaseId]: {
        ...forgedRegistry.releases[fixture.dataset.content.factualParent.factualReleaseId],
        projectionManifest: null,
      },
    });
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return { ...evidence, releaseRegistry: forgedRegistry };
      },
    });

    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });

    expect(result).toEqual({
      status: 'blocked',
      blockers: [expect.objectContaining({ code: 'AUTHENTICATOR_UNAVAILABLE' })],
    });
  });

  it('rejects stale identity heads, row re-keying, and unrelated dataset bytes', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return {
          ...evidence,
          identityAuthorities: evidence.identityAuthorities.map((authority, index) =>
            index === 0
              ? {
                  ...authority,
                  assignmentHead: { ...authority.assignmentHead, revision: 2 },
                }
              : authority
          ),
          rowAuthorities: [],
          artifactBytes: evidence.artifactBytes.map((artifactEvidence) =>
            artifactEvidence.artifactId === fixture.dataset.content.datasetArtifact.artifactId
              ? { ...artifactEvidence, bytes: jsonBytes({ unrelated: true }) }
              : artifactEvidence
          ),
        };
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'IDENTITY_OR_LINEAGE_NOT_ELIGIBLE' }),
        expect.objectContaining({ code: 'DATASET_ARTIFACT_MISMATCH' }),
      ]),
    });
  });

  it('rejects incomplete field rights and authority granted after materialization', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const lateRights = sourceRightsEvidence(fixture);
    const lateReceipt = createAflTradeGate0AReceipt(
      lateRights.gateLedger,
      lateRights.rightsProposal,
      { ...lateRights.derivationReceipt.content.request, evaluatedAt: instant(11) },
      instant(11)
    );
    const lateAuthorityContent = {
      ...evidence.analyticalAuthority.content,
      authorizedAt: instant(11),
    };
    const lateAuthority = {
      receiptId: createAflTradeContentAddress(
        'architecture-operation-receipt',
        lateAuthorityContent
      ),
      content: lateAuthorityContent,
    };
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return {
          ...evidence,
          consumedFieldSets: [],
          sourceRights: [{ ...lateRights, derivationReceipt: lateReceipt }],
          analyticalAuthority: lateAuthority,
        };
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('Expected blocked admission.');
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SOURCE_RIGHTS_INCOMPLETE' }),
        expect.objectContaining({ code: 'SOURCE_RIGHTS_EXPIRED' }),
        expect.objectContaining({ code: 'AUTHORITY_EVIDENCE_INVALID' }),
      ])
    );
  });

  it('rejects an expired Gate 2 decision at the exclusive boundary', async () => {
    const fixture = datasetFixture();
    const evidence = evidenceFor(fixture);
    const service = new AflTradeValuationDatasetAdmissionService({
      async authenticate() {
        return {
          ...evidence,
          gate2Ledger: gateLedger({
            gate: 'gate_2_corpus_lineage',
            decisionKey: evidence.gate2DecisionKey,
            decidedAt: instant(8),
            revalidateAt: instant(20),
            affectedArtifacts: evidence.gate2Ledger.decisions[0].content.affectedArtifacts,
            dimensions: [{ name: 'scope', values: [fixture.dataset.content.scopeKey] }],
          }),
        };
      },
    });
    const result = await service.admit({ dataset: fixture.dataset, admittedAt: instant(20) });
    expect(result).toEqual({
      status: 'blocked',
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'GATE_2_NOT_ELIGIBLE' })]),
    });
  });
});
