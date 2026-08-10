import { createAflTradeCanonicalJsonArtifactRef } from '../artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
  AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
  createAflTradeFactualReleaseCandidate,
} from '../outcomes/factualReleaseCandidateContracts';
import { createAflTradeFactualProjectionItemSet } from '../outcomes/factualProjectionItemSetContracts';
import {
  createAflDraftTradeOutcomeFactualProjectionManifest,
  createAflDraftTradeOutcomeFactualReleaseManifest,
  type AflDraftTradeOutcomeReleaseManifest,
} from '../outcomes/outcomeReleaseContracts';
import { createLocalAflTradeArchiveFixture } from './localSourceArchiveFixture';

const captureId = 'local-draftguru-capture-v1';
const draftEventId = 'local-national-draft-2025';
const draftEventVersionId = 'local-national-draft-2025-v1';
const candidateCreatedAt = '2026-08-09T09:05:00.000Z';
const projectionCreatedAt = '2026-08-09T09:10:00.000Z';

const artifact = (name: string) =>
  createAflTradeCanonicalJsonArtifactRef({ localFixture: name }, projectionCreatedAt);

export function localPlayerDecisionId(playerId: string): string {
  return `local-review-${playerId}`;
}

export function localDraftPlayerAssetVersionId(pickId: string): string {
  return `${pickId}-selected-player-v1`;
}

export function localAcquisitionSpellVersionId(playerId: string, clubId: string): string {
  return createAflTradeContentAddress('acquisition-spell-version', {
    fixture: 'local-source-native-acquisition',
    playerId,
    clubId,
    draftEventVersionId,
  });
}

function unavailableGamesCheck() {
  return {
    metric: 'games' as const,
    status: 'unavailable' as const,
    recordedValue: null,
    observedValue: null,
    delta: null,
    coverageRatio: null,
    scopeLabel: null,
    effectiveThrough: null,
    sources: [] as const,
    message: 'Reviewed AFL appearance evidence has not been captured for this acquisition yet.',
  };
}

export function createLocalAflTradeFactualOutcomePublication(
  legacyTemplate: AflDraftTradeOutcomeReleaseManifest
) {
  const fixture = createLocalAflTradeArchiveFixture();
  const trade = fixture.trades[0];
  const rightsBinding = legacyTemplate.content.sourceRightsBindings[0];
  if (!trade || !rightsBinding) {
    throw new TypeError('The local factual publication requires one trade and one rights binding.');
  }
  const exercisedPicks = trade.assets
    .filter((asset) => asset.kind === 'current_pick')
    .sort((left, right) => left.selectedPlayerId.localeCompare(right.selectedPlayerId));
  const memberRecord = (value: unknown) => sha256AflTradeCanonicalJson(value);
  const members = {
    sourceCaptures: [
      {
        ordinal: 1,
        recordSha256: memberRecord({ captureId, source: fixture.sourceRefs }),
        recordedAt: '2026-08-09T08:02:00.000Z',
        captureId,
        sourceSnapshotId: rightsBinding.sourceSnapshotId,
        gate0aDecisionId: rightsBinding.gateDecisionId,
        consumedFieldSetSha256: sha256AflTradeCanonicalJson(rightsBinding.consumedSourceFields),
      },
    ],
    eventVersions: [
      {
        ordinal: 1,
        recordSha256: memberRecord({ eventVersionId: trade.versionId }),
        recordedAt: '2026-08-09T08:04:00.000Z',
        eventVersionId: trade.versionId,
        eventId: trade.id,
      },
      {
        ordinal: 2,
        recordSha256: memberRecord({ eventVersionId: draftEventVersionId }),
        recordedAt: '2026-08-09T08:05:00.000Z',
        eventVersionId: draftEventVersionId,
        eventId: draftEventId,
      },
    ]
      .sort((left, right) => left.eventVersionId.localeCompare(right.eventVersionId))
      .map((member, index) => ({ ...member, ordinal: index + 1 })),
    lineageEdges: [],
    acquisitionSpells: exercisedPicks
      .map((asset) => ({
        ordinal: 0,
        recordSha256: memberRecord({ playerId: asset.selectedPlayerId, pickId: asset.id }),
        recordedAt: '2026-08-09T08:06:00.000Z',
        spellVersionId: localAcquisitionSpellVersionId(asset.selectedPlayerId, asset.toClubId),
        spellId: `local-acquisition-spell-${asset.selectedPlayerId}-${asset.toClubId}`,
        playerId: asset.selectedPlayerId,
        clubId: asset.toClubId,
        startDate: '2025-11-19',
        endDate: null,
      }))
      .sort((left, right) => left.spellVersionId.localeCompare(right.spellVersionId))
      .map((member, index) => ({ ...member, ordinal: index + 1 })),
    factualRuns: [],
    reconciledMetrics: [],
    achievementRuns: [],
    reconciledAchievements: [],
    spellMetrics: [],
    reviewDecisions: exercisedPicks
      .map((asset) => ({
        ordinal: 0,
        recordSha256: memberRecord({ decisionId: localPlayerDecisionId(asset.selectedPlayerId) }),
        recordedAt: '2026-08-09T08:03:00.000Z',
        decisionId: localPlayerDecisionId(asset.selectedPlayerId),
        subjectType: 'player_identity',
      }))
      .sort((left, right) => left.decisionId.localeCompare(right.decisionId))
      .map((member, index) => ({ ...member, ordinal: index + 1 })),
  };
  const memberSetSha256 = sha256AflTradeCanonicalJson(members);
  const release = createAflDraftTradeOutcomeFactualReleaseManifest({
    ...legacyTemplate.content,
    schemaVersion: 'afl-draft-trade-outcome-release/v2',
    factualCandidateSchemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    sourceMemberSetSha256: memberSetSha256,
    supportedScope: ['Normalized AFL trade, draft selection, and acquisition identity facts'],
    excludedScope: ['Player outcomes not yet captured', 'Numerical valuation and grades'],
    outcomeRecordCount: 0,
  });
  const counts = Object.fromEntries(
    Object.entries(members).map(([kind, values]) => [kind, values.length])
  ) as {
    [Kind in keyof typeof members]: number;
  };
  const candidate = createAflTradeFactualReleaseCandidate({
    schemaVersion: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_SCHEMA_VERSION,
    publicAssetBoundary: release.content.publicAssetBoundary,
    authorityBoundary: AFL_TRADE_FACTUAL_RELEASE_CANDIDATE_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    environment: 'test_fixture',
    scopeKey: release.content.scopeKey,
    competition: 'AFLM',
    validFromSeason: 2025,
    validThroughSeason: 2025,
    createdAt: candidateCreatedAt,
    effectiveThrough: release.content.effectiveThrough,
    targetRelease: {
      id: release.releaseId,
      sha256: release.releaseId.slice('outcome-release:'.length),
    },
    targetReleaseManifest: release,
    archiveDataset: {
      id: release.content.archiveDatasetId,
      sha256: release.content.archiveDatasetId.slice('archive-dataset:'.length),
    },
    sourceSnapshotSet: {
      id: release.content.sourceSnapshotSetId,
      sha256: release.content.sourceSnapshotSetId.slice('source-snapshot-set:'.length),
    },
    metricRegistryVersion: release.content.metricRegistryVersion,
    acquisitionSpellRule: {
      id: release.content.acquisitionSpellRuleId,
      sha256: release.content.acquisitionSpellRuleId.slice('acquisition-spell-rule:'.length),
    },
    members,
    memberSetSha256,
    counts,
    exceptionCount: 0,
    unresolvedIdentityCount: 0,
    unresolvedLineageCount: 0,
  });
  const itemSet = createAflTradeFactualProjectionItemSet(
    exercisedPicks.map((asset, index) => {
      const club = fixture.clubs.find(({ id }) => id === asset.toClubId);
      if (!club) throw new TypeError(`The selected player club ${asset.toClubId} is missing.`);
      return {
        ordinal: index + 1,
        itemKey: `${draftEventId}:${asset.id}`,
        item: {
          eventId: draftEventId,
          tradeId: trade.id,
          assetId: asset.id,
          year: 2025,
          acquisitionType: 'National Draft',
          aflClubId: club.id,
          clubName: club.name,
          player: {
            aflPlayerId: asset.selectedPlayerId,
            displayName: asset.selectedPlayer,
            identityStatus: 'resolved' as const,
          },
          checks: [unavailableGamesCheck()],
          achievements: [],
        },
      };
    })
  );
  const logicalDatasetSha256 = sha256AflTradeCanonicalJson(itemSet.members.map(({ item }) => item));
  const projectionContent = {
    schemaVersion: 'afl-draft-trade-outcome-projection/v2' as const,
    publicAssetBoundary: release.content.publicAssetBoundary,
    environment: 'test_fixture' as const,
    scopeKey: release.content.scopeKey,
    createdAt: projectionCreatedAt,
    releaseId: release.releaseId,
    archiveDatasetId: release.content.archiveDatasetId,
    metricRegistryVersion: release.content.metricRegistryVersion,
    effectiveThrough: release.content.effectiveThrough,
    metricDefinitionIds: release.content.metricDefinitions.map(
      ({ metricDefinitionId }) => metricDefinitionId
    ),
    viewArtifacts: {
      list: artifact('local-list-v2'),
      tradeDetail: artifact('local-detail-v2'),
      club: artifact('local-club-v2'),
      player: artifact('local-player-v2'),
      year: artifact('local-year-v2'),
      dashboard: artifact('local-dashboard-v2'),
    },
    exportArtifacts: {
      json: artifact('local-json-v2'),
      csv: artifact('local-csv-v2'),
      xlsx: artifact('local-unused-tabular-export-v2'),
    },
    parityReport: {
      artifact: artifact('local-parity-v2'),
      status: 'passed' as const,
      checkCount: 3,
      failureCount: 0 as const,
      checkedOutcomeRecordCount: 0,
      logicalDatasetSha256,
    },
    documentCount: itemSet.itemCount,
    factualCandidateId: candidate.candidateId,
    sourceMemberSetSha256: candidate.content.memberSetSha256,
    publicListItemSetSha256: itemSet.itemSetSha256,
    derivationSha256: '',
  };
  projectionContent.derivationSha256 = sha256AflTradeCanonicalJson({
    factualCandidateId: projectionContent.factualCandidateId,
    logicalDatasetSha256,
    publicListItemSetSha256: projectionContent.publicListItemSetSha256,
    sourceMemberSetSha256: projectionContent.sourceMemberSetSha256,
  });
  const projection = createAflDraftTradeOutcomeFactualProjectionManifest(projectionContent);
  return { release, candidate, projection, itemSet };
}
