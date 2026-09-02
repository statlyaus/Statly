import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  createAflTradeFitzRoyInvocation,
  parseAflTradeFitzRoyCaptureRequest,
  type AflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import {
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import { createApprovedAflTradeFitzRoyGateRecords } from '../source/approvedFitzRoyGateRecords';
import { createApprovedAflTradeFitzRoySourcePolicies } from '../source/approvedFitzRoySourcePolicies';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import { createLocalAflTradeFiveSeasonCapturePlan } from './localFiveSeasonFitzRoyOutcomeLoad';

type LocalAflTablesFieldDescriptor = Readonly<{
  name: string;
  storageType: 'character' | 'double' | 'integer';
  classes: string[];
  levels: null;
  timezone: null;
}>;

const character = (name: string): LocalAflTablesFieldDescriptor => ({
  name,
  storageType: 'character',
  classes: ['character'],
  levels: null,
  timezone: null,
});
const integer = (name: string): LocalAflTablesFieldDescriptor => ({
  name,
  storageType: 'integer',
  classes: ['integer'],
  levels: null,
  timezone: null,
});
const number = (name: string): LocalAflTablesFieldDescriptor => ({
  name,
  storageType: 'double',
  classes: ['numeric'],
  levels: null,
  timezone: null,
});

export const LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA = [
  integer('Season'),
  character('Round'),
  { ...number('Date'), classes: ['Date'] },
  integer('Local.start.time'),
  character('Venue'),
  integer('Attendance'),
  character('First.name'),
  character('Surname'),
  integer('ID'),
  character('Jumper.No.'),
  character('Playing.for'),
  ...[
    'Kicks',
    'Marks',
    'Handballs',
    'Disposals',
    'Goals',
    'Behinds',
    'Hit.Outs',
    'Tackles',
    'Rebounds',
    'Inside.50s',
    'Clearances',
    'Clangers',
    'Frees.For',
    'Frees.Against',
    'Brownlow.Votes',
    'Contested.Possessions',
    'Uncontested.Possessions',
    'Contested.Marks',
    'Marks.Inside.50',
    'One.Percenters',
    'Bounces',
    'Goal.Assists',
    'Time.on.Ground',
  ].map(integer),
  character('Substitute'),
  character('Umpire.1'),
  character('Umpire.2'),
  character('Umpire.3'),
  character('Umpire.4'),
  character('Home.team'),
  ...[
    'HQ1G',
    'HQ1B',
    'HQ2G',
    'HQ2B',
    'HQ3G',
    'HQ3B',
    'HQ4G',
    'HQ4B',
    'HQETG',
    'HQETB',
    'Home.score',
  ].map(integer),
  character('Away.team'),
  ...[
    'AQ1G',
    'AQ1B',
    'AQ2G',
    'AQ2B',
    'AQ3G',
    'AQ3B',
    'AQ4G',
    'AQ4B',
    'AQETG',
    'AQETB',
    'Away.score',
    'HQ1P',
    'HQ2P',
    'HQ3P',
    'HQ4P',
    'HQETP',
    'AQ1P',
    'AQ2P',
    'AQ3P',
    'AQ4P',
    'AQETP',
  ].map(integer),
  character('Player'),
  character('Team'),
  character('url'),
  number('Age'),
  integer('Career.Games'),
  character('Coach'),
  character('DOB'),
  character('Home.Away'),
] satisfies readonly LocalAflTablesFieldDescriptor[];

export const LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA = [
  number('Game'),
  { ...number('Date'), classes: ['Date'] },
  character('Round'),
  character('Home.Team'),
  integer('Home.Goals'),
  integer('Home.Behinds'),
  integer('Home.Points'),
  character('Away.Team'),
  integer('Away.Goals'),
  integer('Away.Behinds'),
  integer('Away.Points'),
  character('Venue'),
  integer('Margin'),
  number('Season'),
  character('Round.Type'),
  integer('Round.Number'),
] satisfies readonly LocalAflTablesFieldDescriptor[];

function artifact(label: string): string {
  return `artifact:${sha256AflTradeCanonicalJson({
    boundary: 'local-five-season-afl-tables',
    label,
  })}`;
}

function sourceFieldUse(sourceField: string, modelTraining = false) {
  return {
    sourceField,
    normalizedField: sourceField,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: modelTraining ? ('allowed' as const) : ('blocked' as const),
      derived_feature: 'allowed' as const,
      public_display: 'blocked' as const,
    },
    attributionRequired: true,
    notes: modelTraining
      ? 'Exact private AFL Tables field approved for retained non-production feature construction and model training.'
      : 'Exact AFL Tables field approved for the disposable local factual-release rehearsal.',
  };
}

function requireCaptureRequest(season: number): AflTradeFitzRoyCaptureRequest {
  const captureRequest = createLocalAflTradeFiveSeasonCapturePlan().find(
    ({ authorizationSeason }) => authorizationSeason === season
  );
  if (captureRequest) return captureRequest;
  if (season === 2026) {
    return parseAflTradeFitzRoyCaptureRequest({
      schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
      capabilityId: 'afl-tables-player-stats',
      competition: 'AFLM',
      authorizationSeason: season,
      parameters: { season, rescrape: false, rescrapeStartSeason: null },
    });
  }
  throw new TypeError('The local AFL Tables authority is limited to seasons 2021 through 2026.');
}

export function createLocalAflTradeFiveSeasonAflTablesAuthority(season: number) {
  const captureRequest = requireCaptureRequest(season);
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const exactFields = LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA.map(({ name }) => name);
  const fields = exactFields.map((sourceField) => sourceFieldUse(sourceField, true));
  const approvedPolicy = createApprovedAflTradeFitzRoySourcePolicies({
    fieldSets: {
      'afl-tables-player-stats': fields,
      'footywire-player-stats': [sourceFieldUse('not-used-by-local-afl-tables-load')],
      'fryzigg-player-stats': [sourceFieldUse('not-used-by-local-afl-tables-load')],
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': artifact('full-season-custody'),
        'zero-provenance-review': artifact('zero-provenance-review'),
      },
      'footywire-player-stats': {
        'full-season-custody': artifact('unused-footywire-full-season-custody'),
        'html-schema-fingerprint': artifact('unused-footywire-schema'),
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': artifact('unused-fryzigg-rds'),
        'reconciliation-promotion-review': artifact('unused-fryzigg-review'),
      },
    },
    evidence: {
      terms: artifact('terms'),
      authority: artifact('local-user-approval'),
      rateLimit: artifact('rate-limit'),
    },
    termsEffectiveAt: '2026-08-14T00:00:00.000Z',
    termsExpireAt: '2027-08-14T00:00:00.000Z',
    proposedAt: '2026-08-14T00:00:01.000Z',
    proposedBy: 'local-factual-release-owner',
  }).find(({ content }) => content.provider === 'afl_tables');
  if (!approvedPolicy) {
    throw new TypeError('The reviewed AFL Tables source authority is unavailable.');
  }
  const rightsContent = {
    ...approvedPolicy.content,
    intendedPurpose:
      'Private identity, factual review, derived feature construction, and retained non-production player-model training.',
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      ...approvedPolicy.content.automatedAccess,
      identification: 'Statly private local factual-release rehearsal through fitzRoy.',
    },
    redistribution: {
      rawFieldsPermitted: false,
      publicDerivedOutputPermitted: false,
    },
    attribution: {
      ...approvedPolicy.content.attribution,
      placement:
        'Private local identity, match, factual review, feature construction, and model training only.',
    },
    restrictions: {
      geographic: [] as string[],
      commercial: ['internal-evaluation'],
      audience: ['internal'],
    },
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
      season,
      accessMechanism: 'automated_web',
      capabilityId: 'afl-tables-player-stats',
      geography: 'global',
      commercialContext: 'internal-evaluation',
      audience: 'internal',
      operations: [
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
        'model_training',
        'derived_feature_creation',
      ],
      fieldUses: exactFields.flatMap((sourceField) => [
        { sourceField, use: 'archive_fact' as const },
        { sourceField, use: 'derived_feature' as const },
        { sourceField, use: 'model_training' as const },
      ]),
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86_400,
    },
    captureRequest,
  };
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: `afl-tables-player-stats-local-${season}-v2`,
    capabilityId: 'afl-tables-player-stats',
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: createDecodedFieldSchemaSha256(LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA),
    exactOrderedFields: exactFields,
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: season,
    validThroughSeason: season,
    seasonField: { sourceField: 'Season', required: true },
    roundLabelField: { sourceField: 'Round', required: true },
    observedDateField: { sourceField: 'Date', required: true },
    naturalKeyFields: ['Season', 'Round', 'Date', 'Home.team', 'Away.team', 'ID', 'Playing.for'],
    approvedAt: '2026-09-02T00:00:03.000Z',
    approvalDecisionId: `local-afl-tables-field-map-review-${season}-v2`,
    identity: {
      nativeId: { sourceField: 'ID', required: true },
      recordedName: { sourceField: 'Player', required: true },
      recordedClubNativeId: null,
      recordedClubName: { sourceField: 'Playing.for', required: true },
    },
    match: {
      nativeMatchId: null,
      season: { sourceField: 'Season', required: true },
      roundLabel: { sourceField: 'Round', required: true },
      matchDate: { sourceField: 'Date', required: true },
      homeClubNativeId: null,
      homeClubName: { sourceField: 'Home.team', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'Away.team', required: true },
      status: null,
    },
    metrics: [
      {
        metricCode: 'goals',
        sourceField: 'Goals',
        definitionVersion: 'goals/v1',
        unit: 'goals',
        zeroSemantics: 'provider_zero_may_mean_missing',
      },
      {
        metricCode: 'brownlow_votes',
        sourceField: 'Brownlow.Votes',
        definitionVersion: 'brownlow-votes/v1',
        unit: 'votes',
        zeroSemantics: 'provider_zero_may_mean_missing',
      },
    ],
    achievement: null,
  });
  return { capture, fieldMap, gateDecisionId: gate.decision.decisionId };
}

export function createLocalAflTradeAflTablesResultsAuthority(season: number) {
  const playerAuthority = createLocalAflTradeFiveSeasonAflTablesAuthority(season);
  const captureRequest = parseAflTradeFitzRoyCaptureRequest({
    schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
    capabilityId: 'afl-tables-results',
    competition: 'AFLM',
    authorizationSeason: season,
    parameters: { season, roundNumber: null },
  });
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const exactFields = LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA.map(({ name }) => name);
  const rightsContent = {
    ...playerAuthority.capture.sourceRights.content,
    registerId: `afl-tables-results-local-${season}-fitzroy-1.7.0`,
    dataset: 'AFL Tables completed match results through fitzRoy',
    intendedPurpose:
      'Private completed-match universe for the non-production HPN calculation input.',
    operations: {
      ...playerAuthority.capture.sourceRights.content.operations,
      model_training: 'blocked' as const,
    },
    acquisition: {
      ...playerAuthority.capture.sourceRights.content.acquisition,
      capabilities: [
        {
          capabilityId: 'afl-tables-results',
          provider: 'afl_tables' as const,
          directFunction: 'fetch_results_afltables',
        },
      ],
    },
    fields: exactFields.map((sourceField) => sourceFieldUse(sourceField)),
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
      evidenceId: artifact('results-source-governance-review'),
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
      season,
      accessMechanism: 'automated_web',
      capabilityId: 'afl-tables-results',
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
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86_400,
    },
    captureRequest,
  };
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: `afl-tables-results-local-${season}-v2`,
    capabilityId: 'afl-tables-results',
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: createDecodedFieldSchemaSha256(LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA),
    exactOrderedFields: exactFields,
    observationKind: 'match_universe',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: season,
    validThroughSeason: season,
    seasonField: { sourceField: 'Season', required: true },
    roundLabelField: { sourceField: 'Round', required: true },
    observedDateField: { sourceField: 'Date', required: true },
    naturalKeyFields: ['Season', 'Round', 'Date', 'Home.Team', 'Away.Team'],
    approvedAt: '2026-08-26T00:00:03.000Z',
    approvalDecisionId: `local-afl-tables-results-field-map-review-${season}-v2`,
    identity: null,
    match: {
      nativeMatchId: { sourceField: 'Game', required: true },
      season: { sourceField: 'Season', required: true },
      roundLabel: { sourceField: 'Round', required: true },
      matchDate: { sourceField: 'Date', required: true },
      homeClubNativeId: null,
      homeClubName: { sourceField: 'Home.Team', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'Away.Team', required: true },
      status: null,
    },
    metrics: [],
    achievement: null,
  });
  return { capture, fieldMap, gateDecisionId: gate.decision.decisionId };
}
