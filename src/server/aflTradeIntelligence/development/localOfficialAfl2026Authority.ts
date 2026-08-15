import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { createApprovedAflTradeFitzRoyGateRecords } from '../source/approvedFitzRoyGateRecords';
import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  createAflTradeFitzRoyInvocation,
  parseAflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import {
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import {
  AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_PINNED_VERSION,
} from '../source/fitzRoyProviderCapabilities';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';

type LocalOfficialAflFieldDescriptor = Readonly<{
  name: string;
  storageType: 'character' | 'double' | 'integer' | 'logical';
  classes: string[];
  levels: null;
  timezone: null;
}>;

const character = (name: string): LocalOfficialAflFieldDescriptor => ({
  name,
  storageType: 'character',
  classes: ['character'],
  levels: null,
  timezone: null,
});
const integer = (name: string): LocalOfficialAflFieldDescriptor => ({
  name,
  storageType: 'integer',
  classes: ['integer'],
  levels: null,
  timezone: null,
});
const number = (name: string): LocalOfficialAflFieldDescriptor => ({
  name,
  storageType: 'double',
  classes: ['numeric'],
  levels: null,
  timezone: null,
});
const logical = (name: string): LocalOfficialAflFieldDescriptor => ({
  name,
  storageType: 'logical',
  classes: ['logical'],
  levels: null,
  timezone: null,
});

export const LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA = [
  ...[
    'providerId',
    'utcStartTime',
    'status',
    'compSeason.shortName',
    'round.name',
  ].map(character),
  integer('round.roundNumber'),
  ...[
    'venue.name',
    'home.team.name',
    'home.team.club.name',
    'away.team.name',
    'away.team.club.name',
  ].map(character),
  integer('player.jumperNumber'),
  character('player.photoURL'),
  character('player.player.position'),
  character('player.player.player.playerId'),
  logical('player.player.player.captain'),
  integer('player.player.player.playerJumperNumber'),
  character('player.player.player.givenName'),
  character('player.player.player.surname'),
  character('teamId'),
  logical('gamesPlayed'),
  ...[
    'timeOnGroundPercentage',
    'goals',
    'behinds',
  ].map(number),
  logical('superGoals'),
  ...[
    'kicks',
    'handballs',
    'disposals',
    'marks',
    'bounces',
    'tackles',
    'contestedPossessions',
    'uncontestedPossessions',
    'totalPossessions',
    'inside50s',
    'marksInside50',
    'contestedMarks',
    'hitouts',
    'onePercenters',
    'disposalEfficiency',
    'clangers',
    'freesFor',
    'freesAgainst',
    'dreamTeamPoints',
    'rebound50s',
    'goalAssists',
    'goalAccuracy',
    'ratingPoints',
  ].map(number),
  logical('ranking'),
  logical('lastUpdated'),
  ...[
    'turnovers',
    'intercepts',
    'tacklesInside50',
    'shotsAtGoal',
  ].map(number),
  logical('goalEfficiency'),
  logical('shotEfficiency'),
  logical('interchangeCounts'),
  ...[
    'scoreInvolvements',
    'metresGained',
    'clearances.centreClearances',
    'clearances.stoppageClearances',
    'clearances.totalClearances',
    'extendedStats.effectiveKicks',
    'extendedStats.kickEfficiency',
    'extendedStats.kickToHandballRatio',
    'extendedStats.effectiveDisposals',
    'extendedStats.marksOnLead',
    'extendedStats.interceptMarks',
    'extendedStats.contestedPossessionRate',
    'extendedStats.hitoutsToAdvantage',
    'extendedStats.hitoutWinPercentage',
    'extendedStats.hitoutToAdvantageRate',
    'extendedStats.groundBallGets',
    'extendedStats.f50GroundBallGets',
    'extendedStats.scoreLaunches',
    'extendedStats.pressureActs',
    'extendedStats.defHalfPressureActs',
    'extendedStats.spoils',
    'extendedStats.ruckContests',
    'extendedStats.contestDefOneOnOnes',
    'extendedStats.contestDefLosses',
    'extendedStats.contestDefLossPercentage',
    'extendedStats.contestOffOneOnOnes',
    'extendedStats.contestOffWins',
    'extendedStats.contestOffWinsPercentage',
    'extendedStats.centreBounceAttendances',
    'extendedStats.kickins',
    'extendedStats.kickinsPlayon',
  ].map(number),
  character('player.playerId'),
  logical('player.captain'),
  integer('player.playerJumperNumber'),
  character('player.givenName'),
  character('player.surname'),
  character('teamStatus'),
  logical('extendedStats'),
  character('team.name'),
] satisfies readonly LocalOfficialAflFieldDescriptor[];

function artifact(label: string): string {
  return `artifact:${sha256AflTradeCanonicalJson({
    boundary: 'local-official-afl-2026',
    label,
  })}`;
}

function sourceFieldUse(sourceField: string) {
  return {
    sourceField,
    normalizedField: sourceField,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature: 'blocked' as const,
      public_display: 'blocked' as const,
    },
    attributionRequired: true,
    notes: 'Exact official AFL field approved for the disposable local 2026 rehearsal.',
  };
}

export function createLocalAflTradeOfficialAfl2026Authority() {
  const captureRequest = parseAflTradeFitzRoyCaptureRequest({
    schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    authorizationSeason: 2026,
    parameters: { season: 2026, roundNumber: null },
  });
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const exactFields = LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA.map(({ name }) => name);
  const fields = exactFields.map(sourceFieldUse);
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'official-afl-player-stats-local-2026-fitzroy-1.7.0',
    provider: 'official_afl',
    dataset: 'Official AFL 2026 player match statistics',
    datasetVersion: `fitzroy-${AFL_TRADE_FITZROY_PINNED_VERSION}`,
    intendedPurpose:
      'Current-season concluded AFL player appearances and goals for the disposable local factual-release rehearsal.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'provider_api' as const,
    },
    acquisition: {
      kind: 'fitzroy' as const,
      capabilitySchemaVersion: AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
      fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
      capabilities: [
        {
          capabilityId: 'official-afl-player-stats',
          provider: 'official_afl' as const,
          directFunction: 'fetch_player_stats_afl',
        },
      ],
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'blocked' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: 'Statly local factual-release rehearsal through fitzRoy.',
      rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
      cache: { permitted: true, maximumSeconds: 3_600 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Retain exact local source evidence only for this disposable rehearsal.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Retain local provenance hashes and governance evidence for audit.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Retain derived evidence only while the disposable rehearsal is active.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: {
      required: true,
      text: 'Current-season player statistics sourced through fitzRoy from official AFL data.',
      placement: 'Private local identity, match, and factual review only.',
    },
    restrictions: {
      geographic: [],
      commercial: ['internal-evaluation'],
      audience: ['internal'],
    },
    fields,
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description:
          'Enforce the reviewed provider request rate, burst, cache, and local egress boundary.',
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [artifact('rate-limit')],
      },
      {
        conditionId: 'concluded-match-status-review',
        description:
          'Promote appearances only from rows whose official match status is concluded.',
        appliesToOperations: ['internal_quality_evaluation' as const],
        verificationEvidenceIds: [artifact('concluded-match-review')],
      },
    ],
    rightsEvidenceIds: [artifact('terms'), artifact('local-user-approval')],
    termsEffectiveAt: '2026-08-14T00:00:00.000Z',
    termsExpireAt: '2027-08-14T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions:
        'Stop capture and remove local source or derived bytes marked for withdrawal deletion.',
      retainableAuditMaterial:
        'Retain permitted hashes, decision history, provenance metadata, and rollback evidence.',
    },
    proposedAt: '2026-08-14T00:00:01.000Z',
    proposedBy: 'local-factual-release-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const gate = createApprovedAflTradeFitzRoyGateRecords({
    sourceRights,
    environment: 'non_production',
    version: 1,
    supersedesDecisionId: null,
    decidedAt: '2026-08-14T00:00:02.000Z',
    effectiveAt: '2026-08-14T00:00:02.000Z',
    revalidateAt: '2027-08-13T00:00:00.000Z',
    accountableOwner: 'local-factual-release-owner',
    reviewer: {
      id: 'local-source-governance-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: artifact('source-governance-review'),
    },
    authorityEvidenceId: artifact('local-user-approval'),
    rateLimitEvidenceId: artifact('rate-limit'),
  });
  const capture: AflTradeFitzRoyCaptureCommand = {
    sourceRights,
    ledger: { proposals: [gate.proposal], decisions: [gate.decision] },
    gateRequest: {
      decisionKey: gate.proposal.content.decisionKey,
      environment: 'non_production',
      rightsArtifactId: sourceRights.rightsArtifactId,
      competition: 'AFLM',
      season: 2026,
      accessMechanism: 'provider_api',
      capabilityId: 'official-afl-player-stats',
      geography: 'global',
      commercialContext: 'internal-evaluation',
      audience: 'internal',
      operations: [
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
      ],
      fieldUses: exactFields.map((sourceField) => ({
        sourceField,
        use: 'archive_fact' as const,
      })),
      rawRetentionDays: 30,
      metadataRetentionDays: null,
      cacheSeconds: 3_600,
    },
    captureRequest,
  };
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: 'official-afl-player-stats-local-2026-v1',
    capabilityId: 'official-afl-player-stats',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    sourceSchemaSha256: createDecodedFieldSchemaSha256(
      LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA
    ),
    exactOrderedFields: exactFields,
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: 2026,
    validThroughSeason: 2026,
    seasonField: null,
    roundLabelField: { sourceField: 'round.name', required: true },
    observedDateField: { sourceField: 'utcStartTime', required: true },
    naturalKeyFields: ['providerId', 'player.playerId'],
    approvedAt: '2026-08-14T00:00:03.000Z',
    approvalDecisionId: 'local-official-afl-2026-field-map-review',
    identity: {
      nativeId: { sourceField: 'player.playerId', required: true },
      recordedName: { sourceField: 'player.givenName', required: true },
      recordedSurname: { sourceField: 'player.surname', required: true },
      recordedClubNativeId: { sourceField: 'teamId', required: true },
      recordedClubName: { sourceField: 'team.name', required: true },
    },
    match: {
      nativeMatchId: { sourceField: 'providerId', required: true },
      season: { sourceField: 'compSeason.shortName', required: true },
      roundLabel: { sourceField: 'round.name', required: true },
      matchDate: { sourceField: 'utcStartTime', required: true },
      homeClubNativeId: null,
      homeClubName: { sourceField: 'home.team.name', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'away.team.name', required: true },
      status: { sourceField: 'status', required: true },
    },
    metrics: [
      {
        metricCode: 'goals',
        sourceField: 'goals',
        definitionVersion: 'goals/v1',
        unit: 'goals',
        zeroSemantics: 'measured_zero',
      },
    ],
    achievement: null,
  });
  return { capture, fieldMap, gateDecisionId: gate.decision.decisionId };
}
