import { createHash } from 'node:crypto';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION,
  AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION,
  createAflTradeConsumedFieldSet,
  createAflTradeCorpusFactualLineage,
  createAflTradeValuationDatasetCandidate,
  createAflTradeValuationDatasetRow,
  createAflTradeValuationDatasetSpecification,
} from '@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts';
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
  createAflDraftTradeOutcomeReleaseRegistry,
  registerAflDraftTradeOutcomeRelease,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReleaseState';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateCode,
  type AflTradeGovernedArtifactKind,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AFL_TRADE_PROVIDER_RESOLUTION_PROPOSAL_SCHEMA_VERSION,
  AFL_TRADE_PROVIDER_RESOLUTION_SCHEMA_VERSION,
  createAflTradeProviderResolutionDecision,
  createAflTradeProviderResolutionProposal,
} from '@/server/aflTradeIntelligence/source/providerResolutionContracts';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import { AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY } from '@/types/aflDraftTradeOutcomes';
import {
  createAflDraftTradeOutcomeReleaseFixture,
  createAflTradeGateDecisionFixture,
} from '../fixtures/aflDraftTradeOutcomeReleaseFixture';
import {
  createAflTradeHpnPavFieldMap,
  createAflTradeHpnPavSeasonInputSet,
} from '@/server/aflTradeIntelligence/modeling/hpnPavInputContracts';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import { createAflTradeFinalizedHpnPavCalculationService } from '@/server/aflTradeIntelligence/modeling/hpnPavCalculationService';
import { createAflTradePlayerPavCalculationEvidence } from '@/server/aflTradeIntelligence/modeling/playerPavCalculationEvidence';
import { materializeAflTradePlayerPavObservationSet } from '@/server/aflTradeIntelligence/modeling/playerPavObservationService';
import { createAflTradePlayerPavPolicy } from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
const sha = (character: string) => character.repeat(64);
const admissionDigest = sha;
const admissionInstant = (minute: number) =>
  `2026-09-02T00:${String(minute).padStart(2, '0')}:00.000Z`;
const admissionReference = (prefix: string, marker: string) => {
  const id = createAflTradeContentAddress(prefix, { fixture: marker });
  return { id, sha256: id.split(':')[1]! };
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const decision = (prefix: string, character: string) => ({
  id: `${prefix}:${digest(character)}`,
  sha256: digest(character),
});

const resolution = (
  entityKind: 'player' | 'club' | 'match',
  character: string,
  canonicalId = `${entityKind}:${character}`
) => ({
  entityKind,
  canonicalId,
  revision: 1,
  status: 'current_approved' as const,
  resolutionDecision: decision('provider-resolution-decision', character),
  assignmentDecision: decision('provider-resolution-decision', character),
});

const acquisitionSpell = (playerKey: string, clubId: string) => ({
  spellVersionId: `acquisition-spell-version:${digest(`${playerKey}:${clubId}`)}`,
  spellId: `spell:${playerKey}:${clubId}`,
  version: 1,
  playerId: `player:${playerKey}`,
  clubId,
  startEventVersionId: `event-version:${playerKey}:${clubId}`,
  startAssetVersionId: `asset-version:${playerKey}:${clubId}`,
  startDate: '2002-01-01',
  endDate: null,
  endReason: null,
  ruleId: 'spell-rule:v1',
  status: 'approved' as const,
  supersedesSpellVersionId: null,
  recordedAt: '2026-08-01T00:00:00.000Z',
});

type FixtureEnvironment = 'test_fixture' | 'non_production';

function admissionMemberMappings(members: AflTradeFactualReleaseCandidate['content']['members']) {
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

function admissionFactualProjection(
  candidate: ReturnType<typeof createAflTradeFactualReleaseCandidate>
) {
  const base = createAflDraftTradeOutcomeReleaseFixture('f').projection;
  const logicalDatasetSha256 = admissionDigest('c');
  const publicListItemSetSha256 = admissionDigest('d');
  return createAflDraftTradeOutcomeFactualProjectionManifest({
    ...base.content,
    environment: candidate.content.environment,
    schemaVersion: 'afl-draft-trade-outcome-projection/v2',
    createdAt: admissionInstant(6),
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

function admissionIdentityAuthority(
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
  const definitionSha256 = admissionDigest(entityKind === 'player' ? '7' : '8');
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
    approvalDecision: admissionReference('provider-namespace-approval-decision', entityKind),
  };
  const identityCandidateId = `identity-candidate:${entityKind}:${entityId}:${seasonYear}`;
  const staging = {
    normalizationRunId: 'provider-normalization-run:fixture',
    stagingSha256: admissionDigest('9'),
    providerDecodedRowId: `provider-decoded-row:${entityKind}`,
    sourceRowSha256: admissionDigest('a'),
    candidateSha256: admissionDigest(entityKind === 'player' ? 'b' : 'c'),
    environment,
    provider: 'official_afl',
    capabilityId,
    fieldMapSha256: admissionDigest('d'),
    normalizationFinalization: admissionReference('provider-normalization-finalization', 'fixture'),
    rowStatus: 'staged' as const,
    issueSet: admissionReference('provider-resolution-issue-set', entityKind),
    blockingIssueCount: 0,
    openBlockingIssueCount: 0,
    blockingIssueClosures: [],
    nativeIdNamespace: options.temporalAlias ? null : governedNamespace,
    competition,
    seasonYear,
  };
  const nativeId = `provider-${entityKind}-${entityId}-${seasonYear}`;
  const normalizationPolicy = admissionReference('provider-resolution-policy', 'fixture-alias');
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
    method: admissionReference('provider-resolution-method', 'fixture'),
    staging,
    canonicalTargetSnapshot: admissionReference('canonical-target-snapshot', entityKind),
    supportingEvidence: [admissionReference('provider-resolution-evidence', entityKind)],
    proposedAt: admissionInstant(8),
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
      authorityEvidence: admissionReference('reviewer-authority-evidence', entityKind),
      role: 'afl_trade_identity_reviewer',
      scopeKey: 'public-afl-draft-trade-outcomes',
      provider: staging.provider,
      capabilityId: staging.capabilityId,
      competition: staging.competition,
      validFromSeason,
      validThroughSeason,
    },
    effectiveAt: admissionInstant(9),
    decidedAt: admissionInstant(9),
  });
  return {
    entityKind,
    entityId,
    decision,
    resolutionHead: {
      resolutionCaseId: proposal.content.resolutionCaseId,
      revision: 1,
      resolutionId: decision.decisionId,
      updatedAt: admissionInstant(9),
    },
    assignmentHead: {
      assignmentCaseId,
      entityKind: assignmentEntityKind,
      identityId: providerIdentityId,
      revision: 1,
      decisionId: decision.decisionId,
      status: 'active' as const,
      updatedAt: admissionInstant(9),
    },
    authenticatedAt: admissionInstant(9),
  };
}

function admissionGateLedger(input: {
  environment?: 'test_fixture' | 'non_production';
  gate: AflTradeGateCode;
  decisionKey: string;
  affectedArtifacts: readonly { kind: AflTradeGovernedArtifactKind; artifactId: string }[];
  dimensions: readonly { name: string; values: readonly string[] }[];
  decidedAt?: string;
  revalidateAt?: string;
}): AflTradeGateDecisionLedger {
  const conditionEvidence = `artifact:${admissionDigest('1')}`;
  const decidedAt = input.decidedAt ?? admissionInstant(1);
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: input.gate,
    decisionKey: input.decisionKey,
    version: 1,
    environment: input.environment ?? ('test_fixture' as const),
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
    proposedAt: input.decidedAt ?? admissionInstant(0),
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
    environment: input.environment ?? ('test_fixture' as const),
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind:
      input.environment === 'non_production'
        ? ('external_human_record' as const)
        : ('fixture' as const),
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

function admissionSourceEvidence(
  document: Awaited<ReturnType<typeof playerPavDatasetAdmissionFixture>>['sourceDocuments'][number]
) {
  const run = document.run;
  const fields = [...new Set(document.rows.flatMap((row) => row.source.sourceFields))].sort();
  const consumedFieldSet = createAflTradeConsumedFieldSet({
    schemaVersion: AFL_TRADE_CONSUMED_FIELD_SET_SCHEMA_VERSION,
    captureId: run.captureId,
    sourceSnapshotId: run.sourceSnapshotId,
    createdAt: admissionInstant(4),
    fields: fields.map((sourceField) => ({
      sourceField,
      uses: ['derived_feature', 'model_training'],
    })),
  });
  const source = { captureId: run.captureId, sourceSnapshotId: run.sourceSnapshotId };
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: run.captureId,
    provider: run.provider,
    dataset: 'Fixture AFL facts',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Fixture-only feature derivation and model-training contract tests.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: run.seasonYear, to: run.seasonYear }],
      accessMechanism: 'manual_review' as const,
    },
    acquisition: {
      kind: 'provided_artifact' as const,
      mediaType: 'application/json',
      deliveryMethod: 'Fabricated unit-test artifact',
    },
    operations: {
      bounded_evaluation_capture: 'blocked' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
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
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Synthetic fixture bytes only.',
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
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
    attribution: { required: false, text: null, placement: null },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: fields.map((sourceField) => ({
      sourceField,
      normalizedField: sourceField,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'allowed' as const,
        derived_feature: 'allowed' as const,
        public_display: 'allowed' as const,
      },
      attributionRequired: false,
      notes: null,
    })),
    conditions: [],
    rightsEvidenceIds: [`artifact:${admissionDigest('2')}`],
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
  const decisionKey = `fixture-model-rights:${run.captureId}`;
  const requestBase = {
    decisionKey,
    environment: 'test_fixture' as const,
    rightsArtifactId: rightsProposal.rightsArtifactId,
    competition: 'AFLM',
    season: run.seasonYear,
    accessMechanism: 'manual_review' as const,
    capabilityId: null,
    geography: 'fixture',
    commercialContext: 'fixture',
    audience: 'internal_fixture',
    operations: ['derived_feature_creation', 'model_training'] as const,
    fieldUses: fields.flatMap((sourceField) => [
      { sourceField, use: 'derived_feature' as const },
      { sourceField, use: 'model_training' as const },
    ]),
    rawRetentionDays: null,
    metadataRetentionDays: 365,
    cacheSeconds: null,
  };
  const ledger = admissionGateLedger({
    gate: 'gate_0a_permission_to_evaluate',
    decidedAt: '2026-08-01T00:00:00.000Z',
    decisionKey,
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rightsProposal.rightsArtifactId }],
    dimensions: [
      { name: 'source_rights_artifact', values: [rightsProposal.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: [String(run.seasonYear)] },
      { name: 'access_mechanism', values: ['manual_review'] },
      { name: 'geography', values: ['fixture'] },
      { name: 'commercial_context', values: ['fixture'] },
      { name: 'audience', values: ['internal_fixture'] },
      {
        name: 'operation',
        values: [
          'derived_feature_creation',
          'model_training',
          'public_derived_output',
          'public_fact_display',
          'raw_evidence_retention',
        ],
      },
    ],
  });
  const captureReceipt = createAflTradeGate0AReceipt(
    ledger,
    rightsProposal,
    {
      ...requestBase,
      evaluatedAt: run.capturedAt,
      operations: ['public_derived_output', 'public_fact_display', 'raw_evidence_retention'],
      fieldUses: fields.map((sourceField) => ({ sourceField, use: 'public_display' as const })),
    },
    run.capturedAt
  );
  const proof = {
    captureId: source.captureId,
    sourceSnapshotId: source.sourceSnapshotId,
    consumedFieldSetId: consumedFieldSet.fieldSetId,
    sourceSnapshotManifest: {
      snapshotId: run.sourceSnapshotId,
      content: { capturedFields: fields, createdAt: run.capturedAt },
    },
    rightsProposal,
    derivationReceipt: createAflTradeGate0AReceipt(
      ledger,
      rightsProposal,
      { ...requestBase, evaluatedAt: admissionInstant(9) },
      admissionInstant(9)
    ),
    admissionReceipt: createAflTradeGate0AReceipt(
      ledger,
      rightsProposal,
      { ...requestBase, evaluatedAt: admissionInstant(20) },
      admissionInstant(20)
    ),
    gateLedger: ledger,
  };
  return { proof, consumedFieldSet, captureReceipt };
}

function playerFieldMap(
  provider: 'afl_tables' | 'footywire',
  character: string,
  environment: FixtureEnvironment
) {
  return createAflTradeHpnPavFieldMap({
    environment,
    competition: 'AFLM',
    provider,
    capabilityId: `${provider.replace('_', '-')}-player-stats`,
    sourceSchemaSha256: sha(character),
    inputKind: 'player_match_stats',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: decision('review-decision', character),
    bindings: {
      player: 'player_id',
      match: 'match_id',
      club: 'team',
      totalPoints: { kind: 'goals_plus_behinds', goals: 'goals', behinds: 'behinds' },
      hitOuts: 'hit_outs',
      goalAssists: 'goal_assists',
      inside50s: 'inside_50s',
      marks: 'marks',
      marksInside50: 'marks_inside_50',
      freeKicksFor: 'free_kicks_for',
      freeKicksAgainst: 'free_kicks_against',
      rebound50s: 'rebound_50s',
      onePercenters: 'one_percenters',
      clearances: 'clearances',
      tackles: 'tackles',
    },
  });
}

function resultFieldMap(environment: FixtureEnvironment) {
  return createAflTradeHpnPavFieldMap({
    environment,
    competition: 'AFLM',
    provider: 'official_afl',
    capabilityId: 'official-afl-results',
    sourceSchemaSha256: sha('a'),
    inputKind: 'completed_match_result',
    validFromSeason: 1998,
    validThroughSeason: 2200,
    approvalDecision: decision('review-decision', 'a'),
    bindings: {
      match: 'match_id',
      homeClub: 'home_team',
      awayClub: 'away_team',
      homePoints: 'home_points',
      awayPoints: 'away_points',
      completionStatus: 'status',
      completedValues: ['completed'],
    },
  });
}

function source(
  normalizationRunId: string,
  providerDecodedRowId: string,
  character: string,
  sourceValues: Record<string, string | number | boolean | null>
) {
  return {
    normalizationRunId,
    providerDecodedRowId: `${normalizationRunId}:${providerDecodedRowId}`,
    sourceRowSha256: digest(`row:${character}`),
    typedPayloadSha256: digest(`payload:${character}`),
    sourceFields: Object.keys(sourceValues).sort(),
    sourceValues,
  };
}

function seasonInput(seasonYear: number, methodId: string, environment: FixtureEnvironment) {
  const resultMap = resultFieldMap(environment);
  const primaryMap = playerFieldMap('afl_tables', 'b', environment);
  const corroboratingMap = playerFieldMap('footywire', 'c', environment);
  const resultRunId = `provider-normalization-run:${digest(`${seasonYear}:run:1`)}`;
  const primaryRunId = `provider-normalization-run:${digest(`${seasonYear}:run:2`)}`;
  const corroboratingRunId = `provider-normalization-run:${digest(`${seasonYear}:run:3`)}`;
  const matchId = `match:${seasonYear}-1`;
  const homeClub = resolution('club', 'a');
  const awayClub = resolution('club', 'b');
  const universePlayers = ['a1', 'a2', 'b1', 'b2'] as const;
  const rows = [
    {
      kind: 'completed_match_result' as const,
      source: source(resultRunId, 'provider-row:result', 'd', {
        away_points: 80,
        away_team: 'club:b',
        home_points: 100,
        home_team: 'club:a',
        match_id: matchId,
        status: 'completed',
      }),
      match: resolution('match', 'm', matchId),
      effectiveAt: `${seasonYear}-03-20T10:00:00.000Z`,
      homeClub,
      awayClub,
      homePoints: 100,
      awayPoints: 80,
      completionStatus: 'completed' as const,
    },
    ...(['a1', 'a2', 'b1', 'b2'] as const).flatMap((playerKey, playerIndex) => {
      const club = playerKey.startsWith('a') ? homeClub : awayClub;
      return (['primary', 'corroborating'] as const).map((role, providerIndex) => ({
        kind: 'player_match_stats' as const,
        role,
        source: source(
          role === 'primary' ? primaryRunId : corroboratingRunId,
          `provider-row:${role}:${playerKey}`,
          String.fromCharCode(101 + playerIndex * 2 + providerIndex),
          {
            behinds: 2 + playerIndex,
            clearances: 4,
            free_kicks_against: 1,
            free_kicks_for: 2,
            goal_assists: 1,
            goals: 3,
            hit_outs: playerIndex,
            inside_50s: 10 + playerIndex,
            marks: 5,
            marks_inside_50: 1,
            match_id: matchId,
            one_percenters: 2,
            player_id: `player:${playerKey}`,
            rebound_50s: 3,
            tackles: 5,
            team: club.canonicalId,
          }
        ),
        match: resolution('match', 'm', matchId),
        player: resolution('player', playerKey),
        club,
        acquisitionSpell: acquisitionSpell(playerKey, club.canonicalId),
        stats: {
          totalPoints: 20 + playerIndex,
          hitOuts: playerIndex,
          goalAssists: 1,
          inside50s: 10 + playerIndex,
          marks: 5,
          marksInside50: 1,
          freeKicksFor: 2,
          freeKicksAgainst: 1,
          rebound50s: 3,
          onePercenters: 2,
          clearances: 4,
          tackles: 5,
        },
      }));
    }),
  ];
  const run = (
    normalizationRunId: string,
    provider: string,
    capabilityId: string,
    fieldMapId: string,
    rowCount: number
  ) => ({
    normalizationRunId,
    captureId: `capture:${provider}:${seasonYear}`,
    sourceSnapshotId: `source-snapshot:${digest(`${seasonYear}:${provider}:snapshot`)}`,
    sourceArtifactId: createAflTradeCanonicalJsonArtifactRef(
      {
        rows: rows
          .filter((row) => row.source.normalizationRunId === normalizationRunId)
          .map((row) => row.source.sourceValues),
      },
      '2026-08-01T00:00:00.000Z'
    ).artifactId,
    provider,
    capabilityId,
    fieldMapId,
    competition: 'AFLM' as const,
    seasonYear,
    stagingSha256: digest(`${seasonYear}:${provider}:staging`),
    sourceRowCount: rowCount,
    acceptedRowCount: rowCount,
    issueCount: 0 as const,
    status: 'staged' as const,
    capturedAt: '2026-08-01T00:00:00.000Z',
    finalizedAt: '2026-08-09T00:00:00.000Z',
  });
  return {
    environment,
    competition: 'AFLM' as const,
    seasonYear,
    effectiveThrough: `${seasonYear}-09-27T00:00:00.000Z`,
    knowledgePolicy: 'retrospective_as_recorded_by_input_creation' as const,
    knowledgeCutoffAt: '2026-08-09T23:59:59.999Z',
    createdAt: '2026-08-10T00:00:00.000Z',
    methodId,
    factualUniverse: {
      factualRunId: `factual-reconciliation-run:${digest(`${seasonYear}:factual`)}`,
      policyId: `factual-reconciliation-policy:${sha('d')}`,
      inputSetSha256: digest(`${seasonYear}:factual-input`),
      status: 'approved' as const,
      finalizedAt: '2026-08-09T00:00:00.000Z',
      completedMatchFacts: [
        {
          factIds: [`source-fact:${digest(`match-universe:${seasonYear}-1`)}`],
          matchId,
          effectiveAt: `${seasonYear}-03-20T10:00:00.000Z`,
          homeClubId: homeClub.canonicalId,
          awayClubId: awayClub.canonicalId,
        },
      ],
      playerAppearanceFacts: universePlayers.map((playerKey) => ({
        factIds: [`source-fact:${digest(`appearance:${seasonYear}:${playerKey}`)}`],
        matchId,
        playerId: `player:${playerKey}`,
        clubId: playerKey.startsWith('a') ? homeClub.canonicalId : awayClub.canonicalId,
      })),
    },
    fieldMaps: [resultMap, primaryMap, corroboratingMap],
    sourceRuns: [
      run(resultRunId, 'official_afl', 'official-afl-results', resultMap.fieldMapId, 1),
      run(primaryRunId, 'afl_tables', 'afl-tables-player-stats', primaryMap.fieldMapId, 4),
      run(
        corroboratingRunId,
        'footywire',
        'footywire-player-stats',
        corroboratingMap.fieldMapId,
        4
      ),
    ],
    completedMatches: [
      {
        matchId,
        effectiveAt: `${seasonYear}-03-20T10:00:00.000Z`,
        homeClubId: homeClub.canonicalId,
        awayClubId: awayClub.canonicalId,
      },
    ],
    rows,
  };
}

/** Synthetic exhaustive denominators and source ancestry; never genuine admission or review evidence. */
export async function playerPavDatasetAdmissionFixture(
  options: {
    releaseId?: string;
    requestId?: string;
    environment?: FixtureEnvironment;
    knowledgeCutoffAt?: string;
    createdAt?: string;
    additionalSourceSeasons?: readonly number[];
  } = {}
) {
  const environment = options.environment ?? 'test_fixture';
  const sourceBytes = new TextEncoder().encode(
    '<html>Synthetic retained HPN method fixture</html>'
  );
  const method = createAflTradeHpnPavMethod({
    sourceArtifact: createAflTradeByteArtifactRef(
      sourceBytes,
      'text/html',
      '2026-08-08T00:00:00.000Z'
    ),
    sourceBytes,
    capturedAt: '2026-08-08T00:00:00.000Z',
  });
  const origins = [2005, 2009, 2013, 2017];
  const inputSets = [
    ...new Set([
      ...Array.from({ length: 18 }, (_, index) => 2003 + index),
      ...(options.additionalSourceSeasons ?? []),
    ]),
  ]
    .sort((a, b) => a - b)
    .map((season) =>
      createAflTradeHpnPavSeasonInputSet(seasonInput(season, method.methodId, environment))
    );
  const pavMeasurements = await Promise.all(
    inputSets.map(async (inputSet) => {
      const service = createAflTradeFinalizedHpnPavCalculationService({
        inputRepository: {
          async loadFinalizedSeasonInputSet() {
            return inputSet;
          },
          async registerFieldMap() {
            throw new Error('Fixture input sets are already constructed.');
          },
          async buildAndPersistSeasonInputSet() {
            throw new Error('Fixture input sets are already constructed.');
          },
        },
        methodAuthority: {
          async loadExact() {
            return { method, sourceBytes };
          },
        },
        clock: { now: () => '2026-08-11T00:00:00.000Z' },
      });
      const calculation = await service.calculate(
        {
          inputSetId: inputSet.inputSetId,
          environment,
          competition: 'AFLM',
          seasonYear: inputSet.content.seasonYear,
          methodId: method.methodId,
        },
        { environment }
      );
      return { inputSet, calculation, headRevision: 1 };
    })
  );
  const releaseId =
    options.releaseId ??
    createAflTradeContentAddress('outcome-release', { fixture: 'pav-dataset' });
  const requestId =
    options.requestId ??
    createAflTradeContentAddress('private-valuation-dispatch', { fixture: 'pav-dataset' });
  const roles = ['train', 'calibration', 'validation', 'final_test'] as const;
  const players = ['a1', 'a2', 'b1', 'b2'];
  const policy = createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v2',
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    competition: 'AFLM',
    policyVersion: 'synthetic-admission-pav-three-season-v2',
    featureHistorySeasons: 3,
    fixedHorizonSeasons: 3,
    methodId: method.methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: origins.map((year, index) => ({
      role: roles[index]!,
      fromPredictionSeason: year,
      throughPredictionSeason: year,
    })),
    approvalDecision: decision('review-decision', 'synthetic-pav-admission-policy'),
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  const predictions = origins.flatMap((predictionSeason, index) =>
    players.map((player) => {
      const original = acquisitionSpell(player, player.startsWith('a') ? 'club:a' : 'club:b');
      return {
        releaseId,
        partition: roles[index]!,
        predictionSeason,
        playerId: original.playerId,
        acquisitionSpell: {
          spellId: original.spellId,
          spellVersionId: original.spellVersionId,
          clubId: original.clubId,
          effectiveFrom: original.startDate,
          effectiveThrough: original.endDate,
          recordedAt: original.recordedAt,
        },
      };
    })
  );
  const pavObservationSet = materializeAflTradePlayerPavObservationSet({
    environment,
    competition: 'AFLM',
    createdAt: options.createdAt ?? '2026-09-01T00:00:00.000Z',
    knowledgeCutoffAt: options.knowledgeCutoffAt ?? '2026-08-31T23:59:59.999Z',
    releaseId,
    policy,
    predictions,
    calculations: pavMeasurements.map(({ calculation }) =>
      createAflTradePlayerPavCalculationEvidence({
        calculation,
        environment,
        competition: 'AFLM',
        methodId: method.methodId,
        seasonYears: inputSets.map((set) => set.content.seasonYear),
        knowledgeCutoffAt: '2026-08-31T23:59:59.999Z',
      })
    ),
  });
  const artifactBytes: { artifactId: string; bytes: Uint8Array }[] = [];
  const retain = (document: unknown, createdAt = '2026-09-01T00:00:00.000Z') => {
    const artifact = createAflTradeCanonicalJsonArtifactRef(document, createdAt);
    artifactBytes.push({
      artifactId: artifact.artifactId,
      bytes: new TextEncoder().encode(canonicalizeAflTradeJson(document)),
    });
    return artifact;
  };
  const artifact = retain(pavObservationSet, pavObservationSet.content.createdAt);
  retain(method, method.content.capturedAt);
  artifactBytes.push({ artifactId: method.content.sourceArtifact.artifactId, bytes: sourceBytes });
  pavMeasurements.forEach(({ inputSet, calculation }) => {
    retain(inputSet, inputSet.content.createdAt);
    retain(calculation, calculation.content.calculatedAt);
  });
  const sourceDocuments = inputSets.flatMap((inputSet) =>
    inputSet.content.sourceRuns.map((run) => {
      const rows = inputSet.content.rows.filter(
        (row) => row.source.normalizationRunId === run.normalizationRunId
      );
      const document = { rows: rows.map((row) => row.source.sourceValues) };
      const reference = retain(document, run.capturedAt);
      if (reference.artifactId !== run.sourceArtifactId)
        throw new Error('Synthetic source artifact mismatch.');
      return { run, rows, document, artifact: reference };
    })
  );
  const measurementReferences = pavObservationSet.content.observations.map((observation) => {
    const reference = (value: (typeof observation.featureValues)[number]) => {
      const authority = pavMeasurements.find(
        ({ calculation }) => calculation.calculationId === value.calculationId
      )!;
      const dates = authority.inputSet.content.rows
        .filter(
          (row) =>
            row.kind === 'completed_match_result' &&
            authority.inputSet.content.rows.some(
              (appearance) =>
                appearance.kind === 'player_match_stats' &&
                appearance.role === 'primary' &&
                appearance.acquisitionSpell.spellVersionId === value.spellVersionId &&
                appearance.match.canonicalId === row.match.canonicalId
            )
        )
        .map((row) => (row.kind === 'completed_match_result' ? row.effectiveAt : ''))
        .sort();
      return {
        kind: 'hpn_pav_measurement' as const,
        state: 'finalized' as const,
        memberId: createAflTradeContentAddress('hpn-pav-measurement', {
          calculationId: value.calculationId,
          spellVersionId: value.spellVersionId,
          playerSha256: value.playerSha256,
        }),
        recordSha256: value.playerSha256,
        headRevision: authority.headRevision,
        calculationId: value.calculationId,
        inputSetId: authority.inputSet.inputSetId,
        methodId: method.methodId,
        seasonYear: value.seasonYear,
        playerId: value.playerId,
        clubId: value.clubId,
        spellVersionId: value.spellVersionId,
        effectiveFrom: dates[0]!,
        effectiveThrough: value.effectiveThrough,
        recordedAt: value.calculatedAt,
      };
    };
    return {
      pavObservationId: observation.observationId,
      featureInputs: observation.featureValues.map(reference),
      targetInputs: observation.targetValues.map(reference),
    };
  });
  return {
    requestId,
    method,
    sourceBytes,
    policy,
    predictions,
    pavObservationSet,
    pavMeasurements,
    pavObservationSetBinding: {
      requestId,
      observationSetId: pavObservationSet.observationSetId,
      artifact,
    },
    measurementReferences,
    sourceDocuments,
    artifactBytes,
  };
}

/** Complete synthetic authority fixture; never evidence of genuine source admission. */
export async function fullPlayerPavDatasetAdmissionFixture(
  options: {
    environment?: FixtureEnvironment;
    buildPav?: typeof playerPavDatasetAdmissionFixture;
    sourceEvidenceFor?: (
      document: Awaited<
        ReturnType<typeof playerPavDatasetAdmissionFixture>
      >['sourceDocuments'][number]
    ) => ReturnType<typeof admissionSourceEvidence>;
  } = {}
) {
  const environment = options.environment ?? 'test_fixture';
  const buildPav = options.buildPav ?? playerPavDatasetAdmissionFixture;
  const seed = await buildPav({ environment });
  const sources = seed.sourceDocuments.map(options.sourceEvidenceFor ?? admissionSourceEvidence);
  const seal = <T extends object>(value: T) => ({
    ...value,
    recordSha256: sha256AflTradeCanonicalJson({ fixtureRecord: value }),
  });
  const spells = ['a1', 'a2', 'b1', 'b2'].map((key, index) =>
    acquisitionSpell(key, index < 2 ? 'club:a' : 'club:b')
  );
  const members = {
    sourceCaptures: seed.sourceDocuments.map(({ run }, index) =>
      seal({
        ordinal: index + 1,
        recordedAt: run.capturedAt,
        captureId: run.captureId,
        sourceSnapshotId: run.sourceSnapshotId,
        gate0aDecisionId: sources[index]!.proof.gateLedger.decisions[0]!.decisionId,
        consumedFieldSetSha256: sources[index]!.consumedFieldSet.content.fieldSetSha256,
      })
    ),
    eventVersions: spells.map((spell, index) =>
      seal({
        ordinal: index + 1,
        recordedAt: spell.recordedAt,
        eventVersionId: spell.startEventVersionId,
        eventId: `event:${spell.playerId}`,
      })
    ),
    lineageEdges: spells.map((spell, index) =>
      seal({
        ordinal: index + 1,
        recordedAt: spell.recordedAt,
        edgeId: createAflTradeContentAddress('lineage-edge', { fixture: spell.spellId }),
      })
    ),
    acquisitionSpells: spells.map((spell, index) =>
      seal({
        ordinal: index + 1,
        recordedAt: spell.recordedAt,
        spellVersionId: spell.spellVersionId,
        spellId: spell.spellId,
        playerId: spell.playerId,
        clubId: spell.clubId,
        startDate: spell.startDate,
        endDate: spell.endDate,
      })
    ),
    factualRuns: seed.pavMeasurements.map(({ inputSet }, index) =>
      seal({
        ordinal: index + 1,
        recordedAt: '2026-08-09T00:00:00.000Z',
        factualRunId: inputSet.content.factualUniverse.factualRunId,
        finalization: admissionReference('factual-reconciliation-finalization', String(index)),
        competition: 'AFLM' as const,
        seasonYear: inputSet.content.seasonYear,
      })
    ),
    reconciledMetrics: [],
    achievementRuns: [],
    reconciledAchievements: [],
    spellMetrics: [],
    reviewDecisions: [
      seal({
        ordinal: 1,
        recordedAt: admissionInstant(0),
        decisionId: 'review-decision:synthetic-pav-fixture',
        subjectType: 'factual_release_candidate',
      }),
    ],
  };
  const sortMembers = <T extends { ordinal: number; recordSha256: string }>(
    values: T[],
    id: (value: T) => string
  ) => {
    values.sort((a, b) => id(a).localeCompare(id(b)));
    values.forEach((value, index) => {
      value.ordinal = index + 1;
      const { recordSha256: _digest, ...content } = value;
      value.recordSha256 = sha256AflTradeCanonicalJson({ fixtureRecord: content });
    });
  };
  sortMembers(members.sourceCaptures, (member) => member.captureId);
  sortMembers(members.lineageEdges, (member) => member.edgeId);
  sortMembers(members.acquisitionSpells, (member) => member.spellVersionId);
  sortMembers(members.factualRuns, (member) => member.factualRunId);
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const release = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...createAflDraftTradeOutcomeReleaseFixture('f').release.content,
    environment,
    schemaVersion: 'afl-draft-trade-outcome-release/v2',
    factualCandidateSchemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    sourceMemberSetSha256: memberSetSha256,
    createdAt: admissionInstant(5),
    effectiveThrough: admissionInstant(5),
    outcomeRecordCount: 0,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
    sourceRightsBindings: sources
      .map((source, index) => ({
        sourceSnapshotId: seed.sourceDocuments[index]!.run.sourceSnapshotId,
        sourceRightsArtifactId: source.proof.rightsProposal.rightsArtifactId,
        gateDecisionId: source.proof.gateLedger.decisions[0]!.decisionId,
        sourceRightsProposal: source.proof.rightsProposal,
        gate0aReceipt: source.captureReceipt,
        consumedSourceFields: source.consumedFieldSet.content.fields.map(
          (field) => field.sourceField
        ),
      }))
      .sort((a, b) => a.sourceSnapshotId.localeCompare(b.sourceSnapshotId)),
  });
  const ref = (id: string) => ({ id, sha256: id.split(':').at(-1)! });
  const factualCandidate = createAflTradeFactualReleaseCandidate({
    schemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: AFL_DRAFT_TRADE_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    authorityBoundary: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment,
    scopeKey: release.content.scopeKey,
    competition: 'AFLM',
    validFromSeason: 2002,
    validThroughSeason: 2020,
    createdAt: admissionInstant(5),
    effectiveThrough: admissionInstant(5),
    targetRelease: ref(release.releaseId),
    targetReleaseManifest: release,
    archiveDataset: ref(release.content.archiveDatasetId),
    sourceSnapshotSet: ref(release.content.sourceSnapshotSetId),
    metricRegistryVersion: release.content.metricRegistryVersion,
    acquisitionSpellRule: ref(release.content.acquisitionSpellRuleId),
    members,
    memberSetSha256,
    counts: {
      sourceCaptures: 54,
      eventVersions: 4,
      lineageEdges: 4,
      acquisitionSpells: 4,
      factualRuns: 18,
      reconciledMetrics: 0,
      achievementRuns: 0,
      reconciledAchievements: 0,
      spellMetrics: 0,
      reviewDecisions: 1,
    },
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  });
  const projection = admissionFactualProjection(factualCandidate);
  let registry = registerAflDraftTradeOutcomeRelease(createAflDraftTradeOutcomeReleaseRegistry(), {
    expectedRevision: 0,
    manifest: release,
    actor: 'fixture-builder',
    evidenceId: factualCandidate.candidateId,
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'validate',
    releaseId: release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: admissionInstant(6),
    actor: 'fixture-reviewer',
    evidenceId: projection.projectionId,
    environment,
    projectionManifest: projection,
    gateDecisionLedger: {
      proposals: sources.flatMap((source) => source.proof.gateLedger.proposals),
      decisions: sources.flatMap((source) => source.proof.gateLedger.decisions),
    },
  });
  const review = createAflTradeGateDecisionFixture({
    environment,
    gate: 'gate_4_publication_api_readiness',
    decisionKey: 'fixture-pav-factual-approval',
    decidedAt: admissionInstant(7),
    revalidateAt: '2027-10-01T00:00:00.000Z',
    affectedArtifacts: [
      { kind: 'factual_release', artifactId: release.releaseId },
      { kind: 'factual_projection', artifactId: projection.projectionId },
    ],
  });
  registry = applyAflDraftTradeOutcomeReleaseCommand(registry, {
    action: 'approve',
    releaseId: release.releaseId,
    expectedRevision: registry.revision,
    occurredAt: admissionInstant(7),
    actor: 'fixture-reviewer',
    evidenceId: review.decisionId,
    environment,
    gateDecisionId: review.decisionId,
    gateDecisionLedger: review.ledger,
  });
  const record = registry.releases[release.releaseId]!;
  const approvalEvent = registry.events.at(-1)!;
  const corpusId = admissionReference('corpus', 'full-pav-fixture').id;
  const corpusLineage = createAflTradeCorpusFactualLineage({
    schemaVersion: AFL_TRADE_CORPUS_FACTUAL_LINEAGE_SCHEMA_VERSION,
    environment,
    scopeKey: release.content.scopeKey,
    competition: 'AFLM',
    createdAt: admissionInstant(7),
    corpusId,
    factualReleaseId: release.releaseId,
    factualCandidateId: factualCandidate.candidateId,
    sourceMemberSetSha256: memberSetSha256,
    memberMappings: admissionMemberMappings(members),
    sourceMappings: sources
      .map((source) => ({
        captureId: source.consumedFieldSet.content.captureId,
        sourceSnapshotId: source.consumedFieldSet.content.sourceSnapshotId,
        consumedFieldSetId: source.consumedFieldSet.fieldSetId,
        consumedFieldSetSha256: source.consumedFieldSet.content.fieldSetSha256,
      }))
      .sort((a, b) => a.captureId.localeCompare(b.captureId)),
    domainLineageMappings: spells.map((spell, index) => ({
      eventId: members.eventVersions[index]!.eventId,
      eventVersionId: spell.startEventVersionId,
      acquisitionSpellId: spell.spellId,
      acquisitionSpellVersionId: spell.spellVersionId,
      playerId: spell.playerId,
      clubId: spell.clubId,
      lineageEdgeIds: [members.lineageEdges[index]!.edgeId],
    })),
  });
  const pav = await buildPav({
    environment,
    releaseId: release.releaseId,
    knowledgeCutoffAt: admissionInstant(5),
    createdAt: admissionInstant(8),
  });
  const artifactBytes = pav.artifactBytes.filter(
    ({ artifactId }) => artifactId === pav.pavObservationSetBinding.artifact.artifactId
  );
  const artifact = (value: unknown) => {
    const bytes = Buffer.from(canonicalizeAflTradeJson(value));
    const result = createAflTradeCanonicalJsonArtifactRef(value, admissionInstant(8));
    artifactBytes.push({ artifactId: result.artifactId, bytes });
    return result;
  };
  const identityAuthorities = [
    ...spells.map((spell, index) =>
      admissionIdentityAuthority('player', spell.playerId, {
        environment,
        seasonYear: 2005 + index * 4,
        validFromSeason: 2002,
        validThroughSeason: 2020,
      })
    ),
    ...spells.map((spell, index) =>
      admissionIdentityAuthority('club', spell.clubId, {
        environment,
        seasonYear: 2005 + index * 4,
        validFromSeason: 2002,
        validThroughSeason: 2020,
      })
    ),
  ];
  const splitRoles = ['train', 'calibration', 'validation', 'final_test'] as const;
  const selectedObservations = pav.pavObservationSet.content.observations.filter(
    (observation) =>
      observation.predictionSeason ===
      2005 + ['player:a1', 'player:a2', 'player:b1', 'player:b2'].indexOf(observation.playerId) * 4
  );
  const inclusionPolicy = artifact({
    schemaVersion: 'afl-trade-player-pav-dataset-inclusion/v1',
    observationSetId: pav.pavObservationSet.observationSetId,
    selectionRule: 'sorted_leakage_components_round_robin',
    partitionOrder: [...splitRoles],
    selectionInputs: 'player_event_acquisition_spell_identities_only',
  });
  const includedObservationIds = selectedObservations
    .map((observation) => observation.observationId)
    .sort();
  const exclusionReport = artifact({
    schemaVersion: 'afl-trade-player-pav-dataset-exclusion/v1',
    observationSetId: pav.pavObservationSet.observationSetId,
    inclusionPolicyArtifactId: inclusionPolicy.artifactId,
    includedObservationIds,
    excludedObservations: pav.pavObservationSet.content.observations
      .filter((observation) => !includedObservationIds.includes(observation.observationId))
      .map((observation) => ({
        observationId: observation.observationId,
        assignedPartition:
          splitRoles[
            ['player:a1', 'player:a2', 'player:b1', 'player:b2'].indexOf(observation.playerId)
          ]!,
        reason: 'assigned_to_different_partition',
      }))
      .sort((a, b) => a.observationId.localeCompare(b.observationId)),
  });
  const specification = createAflTradeValuationDatasetSpecification({
    schemaVersion: 'afl-trade-valuation-dataset-specification/v1',
    environment,
    scopeKey: release.content.scopeKey,
    competition: 'AFLM',
    modelKind: 'player_contribution_and_availability',
    createdAt: admissionInstant(8),
    rowGrain: 'player_acquisition_spell_prediction',
    featurePolicy: {
      knowledgeJoin: 'retrospective_as_captured_at_dataset_creation',
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
    splits: splitRoles.map((role, index) => ({
      role,
      from: `${2005 + index * 4}-01-01`,
      to: `${2006 + index * 4}-01-01`,
    })),
    embargoDays: 7,
    leakageGroupKinds: ['acquisition_spell', 'event', 'player'],
    featureDefinitions: [artifact({ fixtureDefinition: 'PAV historical H3' })],
    targetDefinition: artifact({ fixtureDefinition: 'PAV future H3' }),
    valueUnitDefinition: artifact({ fixtureDefinition: 'PAV' }),
    roleTaxonomy: artifact({ fixtureDefinition: 'roles' }),
    eraDefinition: artifact({ fixtureDefinition: 'eras' }),
    censoringDefinition: artifact({ fixtureDefinition: 'censoring' }),
    inclusionPolicy,
  });
  const rows = selectedObservations.map((observation, index) => {
    const spell = spells.find(
      (candidate) => candidate.spellVersionId === observation.acquisitionSpell.spellVersionId
    )!;
    const mapping = corpusLineage.content.domainLineageMappings.find(
      (candidate) => candidate.acquisitionSpellVersionId === spell.spellVersionId
    )!;
    const player = identityAuthorities.find(
      (authority) =>
        authority.entityId === spell.playerId &&
        authority.decision.content.proposal.content.staging.seasonYear ===
          observation.predictionSeason
    )!;
    const club = identityAuthorities.find(
      (authority) =>
        authority.entityId === spell.clubId &&
        authority.decision.content.proposal.content.staging.seasonYear ===
          observation.predictionSeason
    )!;
    const inputs = pav.measurementReferences.find(
      (item) => item.pavObservationId === observation.observationId
    )!;
    return createAflTradeValuationDatasetRow({
      schemaVersion: 'afl-trade-valuation-dataset-row/v4',
      pavObservationId: observation.observationId,
      ordinal: index + 1,
      rowKey: `fixture:${index}:${observation.observationId}`,
      competition: 'AFLM',
      seasonYear: observation.predictionSeason,
      cohortIds: ['era:fixture', 'role:fixture'],
      predictionOriginAt: observation.predictionCutoffAt,
      featureKnownThrough: '2026-08-11T00:00:00.000Z',
      targetFrom: new Date(Date.parse(observation.predictionCutoffAt) + 1).toISOString(),
      targetThrough: observation.outcomeHorizonEndsAt,
      splitRole: splitRoles[index]!,
      leakageGroups: {
        acquisition_spell: spell.spellId,
        event: mapping.eventId,
        player: spell.playerId,
      },
      identity: {
        playerId: spell.playerId,
        playerResolutionDecisionId: player.decision.decisionId,
        playerAssignmentRevision: 1,
        clubId: spell.clubId,
        clubResolutionDecisionId: club.decision.decisionId,
        clubAssignmentRevision: 1,
      },
      lineage: {
        eventId: mapping.eventId,
        eventVersionId: mapping.eventVersionId,
        acquisitionSpellId: spell.spellId,
        acquisitionSpellVersionId: spell.spellVersionId,
        lineageEdgeIds: mapping.lineageEdgeIds,
      },
      featureInputs: [...inputs.featureInputs].sort((a, b) => a.memberId.localeCompare(b.memberId)),
      targetInputs: [...inputs.targetInputs].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    });
  });
  const factualParent = {
    corpusId,
    corpusToCandidateLineageId: corpusLineage.lineageId,
    factualReleaseId: release.releaseId,
    factualCandidateId: factualCandidate.candidateId,
    sourceMemberSetSha256: memberSetSha256,
    archiveDatasetId: factualCandidate.content.archiveDataset.id,
    sourceSnapshotSetId: factualCandidate.content.sourceSnapshotSet.id,
    metricRegistryVersion: factualCandidate.content.metricRegistryVersion,
    acquisitionSpellRuleId: factualCandidate.content.acquisitionSpellRule.id,
    factualEffectiveThrough: factualCandidate.content.effectiveThrough,
    releaseRecordStateId: createAflTradeContentAddress('outcome-release-record-state', record),
    releaseApprovalEventId: approvalEvent.eventId,
    releaseRegistryRevision: registry.revision,
  };
  const dataset = createAflTradeValuationDatasetCandidate({
    schemaVersion: 'afl-trade-valuation-dataset/v5',
    authorityBoundary:
      'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment,
    scopeKey: release.content.scopeKey,
    competition: 'AFLM',
    createdAt: admissionInstant(10),
    knowledgeCutoffAt: admissionInstant(5),
    factualParent,
    specification,
    requiredSourceUses: {
      operations: ['derived_feature_creation', 'model_training'],
      fieldUses: ['derived_feature', 'model_training'],
      publicDerivedOutput: 'not_authorized_by_dataset_admission',
      revalidateAtModelRunStart: true,
    },
    includedCohorts: ['era:fixture', 'role:fixture'],
    excludedCohorts: [],
    rows,
    exclusionReport,
    datasetArtifact: artifact(rows),
    extractor: {
      codeArtifact: artifact({ fixtureCode: 'PAV admission' }),
      configurationArtifact: artifact({ fixtureConfiguration: 'H3' }),
    },
    pavObservationSet: pav.pavObservationSetBinding,
  });
  const operation = (authorityKind: 'analytical_authority' | 'operational_authorization') => {
    const content = {
      schemaVersion: 'afl-trade-architecture-operation-authorization/v1' as const,
      operation: 'materialize_feature_dataset' as const,
      authorityKind,
      environment,
      scopeKey: release.content.scopeKey,
      datasetId: dataset.datasetId,
      factualReleaseId: release.releaseId,
      factualCandidateId: factualCandidate.candidateId,
      authorizedAt: admissionInstant(9),
      validThrough: '2027-10-01T00:00:00.000Z',
      principalRef: `synthetic-fixture-${authorityKind}`,
    };
    return {
      receiptId: createAflTradeContentAddress('architecture-operation-receipt', content),
      content,
    };
  };
  const evidence = {
    schemaVersion: 'afl-trade-dataset-admission-evidence/v6' as const,
    authenticatedAt: admissionInstant(20),
    factualCandidate,
    factualCandidateFinalizedAt: admissionInstant(5),
    releaseRegistry: registry,
    corpusLineage,
    consumedFieldSets: sources.map((source) => source.consumedFieldSet),
    gate2Ledger: admissionGateLedger({
      environment,
      gate: 'gate_2_corpus_lineage',
      decisionKey: 'fixture-pav-corpus-lineage',
      decidedAt: admissionInstant(8),
      affectedArtifacts: [
        { kind: 'corpus_manifest', artifactId: corpusId },
        { kind: 'corpus_factual_lineage', artifactId: corpusLineage.lineageId },
        { kind: 'factual_release', artifactId: release.releaseId },
        { kind: 'factual_release_candidate', artifactId: factualCandidate.candidateId },
      ],
      dimensions: [{ name: 'scope', values: [release.content.scopeKey] }],
    }),
    gate2DecisionKey: 'fixture-pav-corpus-lineage',
    sourceRights: sources.map((source) => source.proof),
    identityAuthorities,
    domainLineageAuthorities: corpusLineage.content.domainLineageMappings.map((mapping) => ({
      eventId: mapping.eventId,
      eventVersionId: mapping.eventVersionId,
      acquisitionSpellId: mapping.acquisitionSpellId,
      acquisitionSpellVersionId: mapping.acquisitionSpellVersionId,
      playerId: mapping.playerId,
      clubId: mapping.clubId,
      eventRecordSha256: members.eventVersions.find(
        (event) => event.eventVersionId === mapping.eventVersionId
      )!.recordSha256,
      lineageEdges: mapping.lineageEdgeIds.map((edgeId) => ({
        edgeId,
        recordSha256: members.lineageEdges.find((edge) => edge.edgeId === edgeId)!.recordSha256,
      })),
      authenticatedAt: admissionInstant(9),
    })),
    rowAuthorities: rows.map((row) => ({
      rowId: row.rowId,
      identity: row.content.identity,
      ...row.content.lineage,
    })),
    artifactBytes,
    analyticalAuthority: operation('analytical_authority'),
    operationalAuthorization: operation('operational_authorization'),
    pavObservationSet: pav.pavObservationSet,
    pavMeasurements: pav.pavMeasurements,
  };
  return {
    dataset,
    evidence,
    artifactBytes,
    pav,
    factual: {
      factualCandidate,
      registry,
      record,
      approvalEvent,
      corpusId,
      corpusLineage,
      members,
      sources,
      projection,
      review,
    },
  };
}
