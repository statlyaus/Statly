import { createHash } from 'node:crypto';

import { createAflTradeArtifactCustodyProfile } from '../artifacts/artifactCustodyProfile';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeFitzRoyCaptureAdmission } from '../source/fitzRoyCaptureAdmission';
import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  createAflTradeFitzRoyInvocation,
  type AflTradeFitzRoyCaptureDiagnostics,
  type AflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';
import {
  type AflTradeFitzRoyCaptureDependencies,
  type AflTradeFitzRoyCaptureCommand,
} from '../source/fitzRoyCaptureRuntime';
import {
  AFL_TRADE_FITZROY_DECODER_VERSION,
  type AflTradeFitzRoyDecoderExecutor,
} from '../source/fitzRoyObservationDecodeRuntime';
import {
  AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import {
  AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
  createAflTradeFitzRoyEgressExecutionReceipt,
} from '../source/fitzRoyEgressExecutionReceipt';
import { createApprovedAflTradeFitzRoyGateRecords } from '../source/approvedFitzRoyGateRecords';
import { createApprovedAflTradeFitzRoySourcePolicies } from '../source/approvedFitzRoySourcePolicies';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA,
} from './localFiveSeasonAflTablesAuthority';

type RehearsalProfile =
  'completed_match_result' | 'appearance_only' | 'match_only' | 'hpn_player_stats';

/** Explicit synthetic upstream columns for the public HPN input regression. */
export const LOCAL_FITZROY_REHEARSAL_HPN_VALUES = {
  totalPoints: 12,
  hitOuts: 1,
  goalAssists: 2,
  inside50s: 3,
  marks: 4,
  marksInside50: 1,
  freeKicksFor: 2,
  freeKicksAgainst: 1,
  rebound50s: 2,
  onePercenters: 1,
  clearances: 3,
  tackles: 4,
} as const;

const sha = (character: string) => character.repeat(64);
const encoded = (value: unknown) => new TextEncoder().encode(canonicalizeAflTradeJson(value));
const digestBytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export const LOCAL_FITZROY_REHEARSAL_INSTANTS = {
  gateDecidedAt: '2026-08-12T00:00:00.000Z',
  captureStartedAt: '2026-08-12T00:01:00.000Z',
  captureCompletedAt: '2026-08-12T00:01:01.000Z',
  effectiveAt: '2026-03-20T10:00:00.000Z',
  normalizationStartedAt: '2026-08-12T00:02:00.000Z',
  normalizationCompletedAt: '2026-08-12T00:02:01.000Z',
  factBatchCreatedAt: '2026-08-12T00:03:30.000Z',
  reconciliationStartedAt: '2026-08-12T00:04:00.000Z',
  reconciliationCompletedAt: '2026-08-12T00:04:01.000Z',
  candidateCreatedAt: '2026-08-12T00:05:00.000Z',
} as const;

export const LOCAL_FITZROY_REHEARSAL_RUNTIME = {
  rVersion: '4.5.1' as const,
  dependencyLockSha256: sha('b'),
  imageDigest: `sha256:${sha('c')}` as const,
};

export const LOCAL_FITZROY_REHEARSAL_FIELDS: Array<{
  name: string;
  storageType: string;
  classes: string[];
  levels: string[] | null;
  timezone: string | null;
}> = [
  { name: 'season', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
  {
    name: 'match_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'match_date',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'status',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'player_name',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'club_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'home_club_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  {
    name: 'away_club_id',
    storageType: 'character',
    classes: ['character'],
    levels: null,
    timezone: null,
  },
  { name: 'home', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'away', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'round', storageType: 'character', classes: ['character'], levels: null, timezone: null },
  { name: 'goals', storageType: 'integer', classes: ['integer'], levels: null, timezone: null },
];

function approvedSourceAuthority(
  captureRequest: AflTradeFitzRoyCaptureRequest,
  fields = LOCAL_FITZROY_REHEARSAL_FIELDS
): AflTradeFitzRoyCaptureCommand {
  const field = (sourceField: string) => ({
    sourceField,
    normalizedField: sourceField,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature: 'allowed' as const,
      public_display: 'allowed' as const,
    },
    attributionRequired: true,
    notes: 'Source-independent non-production rehearsal field.',
  });
  const fieldNames = fields.map(({ name }) => name);
  const rateLimitEvidenceId = `artifact:${sha('d')}`;
  let sourceRights = createApprovedAflTradeFitzRoySourcePolicies({
    fieldSets: {
      'afl-tables-player-stats': fieldNames.map(field),
      'footywire-player-stats': fieldNames.map(field),
      'fryzigg-player-stats': fieldNames.map(field),
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': `artifact:${sha('2')}`,
        'zero-provenance-review': `artifact:${sha('3')}`,
      },
      'footywire-player-stats': {
        'full-season-custody': `artifact:${sha('4')}`,
        'html-schema-fingerprint': `artifact:${sha('5')}`,
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': `artifact:${sha('6')}`,
        'reconciliation-promotion-review': `artifact:${sha('7')}`,
      },
    },
    evidence: {
      terms: `artifact:${sha('e')}`,
      authority: `artifact:${sha('f')}`,
      rateLimit: rateLimitEvidenceId,
    },
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-08-01T00:00:00.000Z',
    proposedAt: '2026-08-11T23:50:00.000Z',
    proposedBy: 'local-rehearsal-owner',
  }).find(
    ({ content }) => content.provider === createAflTradeFitzRoyInvocation(captureRequest).provider
  );
  if (sourceRights === undefined) throw new Error('Synthetic rehearsal source policy is missing.');
  if (captureRequest.capabilityId === 'afl-tables-results') {
    const content = {
      ...sourceRights.content,
      registerId: 'synthetic-afl-tables-results-rehearsal',
      dataset: 'AFL Tables completed match results through fitzRoy',
      acquisition: {
        ...sourceRights.content.acquisition,
        capabilities: [
          {
            capabilityId: 'afl-tables-results',
            provider: 'afl_tables',
            directFunction: 'fetch_results_afltables',
          },
        ],
      },
    };
    sourceRights = aflTradeSourceRightsProposalSchema.parse({
      rightsArtifactId: createAflTradeContentAddress('source-rights', content),
      content,
    });
  }
  const { proposal, decision } = createApprovedAflTradeFitzRoyGateRecords({
    sourceRights,
    environment: 'non_production',
    version: 1,
    supersedesDecisionId: null,
    decidedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.gateDecidedAt,
    effectiveAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.gateDecidedAt,
    revalidateAt: '2027-08-01T00:00:00.000Z',
    accountableOwner: 'local-rehearsal-owner',
    reviewer: {
      id: 'local-rehearsal-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: `artifact:${sha('1')}`,
    },
    authorityEvidenceId: `artifact:${sha('f')}`,
    rateLimitEvidenceId,
  });
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'public_derived_output',
    'public_fact_display',
  ] as const;
  return {
    sourceRights,
    ledger: { proposals: [proposal], decisions: [decision] },
    gateRequest: {
      decisionKey: proposal.content.decisionKey,
      environment: 'non_production',
      rightsArtifactId: sourceRights.rightsArtifactId,
      competition: 'AFLM',
      season: captureRequest.authorizationSeason,
      accessMechanism: 'automated_web',
      capabilityId: captureRequest.capabilityId,
      geography: 'global',
      commercialContext: 'public-research',
      audience: 'public',
      operations,
      fieldUses: fieldNames.map((sourceField) => ({
        sourceField,
        use: 'public_display' as const,
      })),
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86_400,
    },
    captureRequest,
  };
}

function durableRepository(artifactClass: 'raw_source' | 'capture_metadata') {
  const fixture = createAflTradeFixtureArtifactRepository({ artifactClass });
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: `local-rehearsal-${artifactClass}`,
    environment: 'non_production',
    artifactClass,
    maximumObjectBytes: 65_536,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: { mode: 'customer_managed', keyReferenceSha256: sha('8') },
    },
    retention: {
      deletion: {
        kind: 'maximum_age',
        maximumDays: 365,
        enforcement: 'provider_lifecycle_required',
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [`storage-policy:${sha('9')}`],
  });
  return { ...fixture, assurance: 'durable_object_storage' as const, custodyProfile };
}

function captureDiagnostics(
  invocation: ReturnType<typeof createAflTradeFitzRoyInvocation>,
  fields = LOCAL_FITZROY_REHEARSAL_FIELDS,
  missingCompletionStatus = false,
  seasonYear = 2026
): AflTradeFitzRoyCaptureDiagnostics {
  return {
    schemaVersion: 'afl-trade-fitzroy-diagnostics/v1',
    capabilityId: invocation.capabilityId,
    fitzRoyVersion: invocation.fitzRoyVersion,
    directFunction: invocation.directFunction,
    invocationSha256: sha256AflTradeCanonicalJson(invocation),
    runtime: { ...LOCAL_FITZROY_REHEARSAL_RUNTIME, platform: 'x86_64-pc-linux-gnu' },
    rowCount: 1,
    duplicateRowCount: 0,
    fields: fields.map((field) => ({
      ...field,
      missingCount: missingCompletionStatus && field.name === 'status' ? 1 : 0,
      nanCount: 0,
      positiveInfinityCount: 0,
      negativeInfinityCount: 0,
    })),
    observedSeasonValues: [String(seasonYear)],
    observedRoundValues: ['Round 1'],
    observedDateRange: null,
    originObservation: 'not_exposed_by_fitzroy',
    conditions: [],
  };
}

function captureAdmission(): AflTradeFitzRoyCaptureAdmission {
  return {
    async acquire(request) {
      return {
        status: 'admitted',
        lease: {
          provider: request.provider,
          capabilityId: request.capabilityId,
          invocationSha256: request.invocationSha256,
          token: 'local-rehearsal-lease',
          providerKey: `local-rehearsal:${request.provider}`,
          requestKey: `local-rehearsal:${request.capabilityId}:${request.invocationSha256}`,
          expiresAtMs: request.nowMs + request.policy.maximumLeaseMs,
          providerCooldownMs: 3_000,
          successRequestCooldownMs: 86_400_000,
          egressPolicyEvidenceId: request.policy.egressPolicyEvidenceId,
        },
      };
    },
    async complete() {},
  };
}

function decodedTableExecutor(
  goals: string,
  profile?: RehearsalProfile,
  missingCompletionStatus = false,
  mixedCaseResultFields = false,
  hpnPlayerSide: 'home' | 'away' = 'home',
  seasonYear = 2026
): AflTradeFitzRoyDecoderExecutor {
  return {
    executionBoundary: 'offline_container_no_network',
    async decode({ context }) {
      return encoded({
        schemaVersion: AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
        captureReceiptSha256: context.captureReceiptSha256,
        capabilityId: context.capabilityId,
        fitzRoyVersion: context.fitzRoyVersion,
        authorizationCompetition: context.authorizationCompetition,
        authorizationSeason: context.authorizationSeason,
        invocationSha256: context.invocationSha256,
        invocationArgumentsSha256: context.invocationArgumentsSha256,
        diagnosticsSha256: context.diagnosticsSha256,
        sourceRdsSha256: context.sourceRdsSha256,
        sourceSchemaSha256: context.sourceSchemaSha256,
        decoderRuntime: {
          decoderVersion: AFL_TRADE_FITZROY_DECODER_VERSION,
          rVersion: '4.5.1',
          dependencyLockSha256: context.dependencyLockSha256,
          imageDigest: context.imageDigest,
        },
        frame: { classes: ['data.frame'], rowNames: ['1'] },
        fields: rehearsalFields(profile, mixedCaseResultFields),
        rows:
          profile === 'match_only'
            ? [
                [
                  { kind: 'finite_number', value: '1001' },
                  { kind: 'date', value: `${seasonYear}-03-20`, rawDays: String(Date.UTC(seasonYear, 2, 20) / 86_400_000) },
                  { kind: 'text', value: 'Round 1' },
                  { kind: 'text', value: 'Carlton' },
                  { kind: 'integer', value: '12' },
                  { kind: 'integer', value: '12' },
                  { kind: 'integer', value: '84' },
                  { kind: 'text', value: 'Fremantle' },
                  { kind: 'integer', value: '10' },
                  { kind: 'integer', value: '12' },
                  { kind: 'integer', value: '72' },
                  { kind: 'text', value: 'Synthetic Venue' },
                  { kind: 'integer', value: '12' },
                  { kind: 'finite_number', value: String(seasonYear) },
                  { kind: 'text', value: 'Regular' },
                  { kind: 'integer', value: '1' },
                ],
              ]
            : [
                [
                  { kind: 'integer', value: String(seasonYear) },
                  { kind: 'text', value: 'provider-match-1' },
                  { kind: 'text', value: `${seasonYear}-03-20T08:00:00.000Z` },
                  missingCompletionStatus ? { kind: 'missing' } : { kind: 'text', value: 'Final' },
                  {
                    kind: 'text',
                    value: hpnPlayerSide === 'away' ? 'provider-player-2' : 'provider-player-1',
                  },
                  { kind: 'text', value: hpnPlayerSide === 'away' ? 'Player Two' : 'Player One' },
                  {
                    kind: 'text',
                    value: hpnPlayerSide === 'away' ? 'provider-club-2' : 'provider-club-1',
                  },
                  { kind: 'text', value: 'provider-club-1' },
                  { kind: 'text', value: 'provider-club-2' },
                  { kind: 'text', value: 'Carlton' },
                  { kind: 'text', value: 'Fremantle' },
                  { kind: 'text', value: 'Round 1' },
                  { kind: 'integer', value: profile === 'appearance_only' ? '76' : goals },
                  ...(profile === 'hpn_player_stats'
                    ? Object.values(LOCAL_FITZROY_REHEARSAL_HPN_VALUES).map((value) => ({
                        kind: 'integer',
                        value: String(value),
                      }))
                    : []),
                  ...(profile === 'completed_match_result'
                    ? [
                        { kind: 'integer', value: '84' },
                        { kind: 'integer', value: '72' },
                      ]
                    : []),
                ],
              ],
      });
    },
  };
}

export type LocalFitzRoyFactualRehearsalGeneration = 'baseline' | 'replacement';
export type LocalFitzRoyFactualRehearsalProvider = 'footywire' | 'afl_tables';

function rehearsalFields(profile?: RehearsalProfile, mixedCaseResultFields = false) {
  if (profile === 'match_only') return LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA;
  if (profile === 'hpn_player_stats')
    return [
      ...LOCAL_FITZROY_REHEARSAL_FIELDS,
      ...Object.keys(LOCAL_FITZROY_REHEARSAL_HPN_VALUES).map((name) => ({
        name,
        storageType: 'integer',
        classes: ['integer'],
        levels: null,
        timezone: null,
      })),
    ];
  if (profile === 'appearance_only')
    return LOCAL_FITZROY_REHEARSAL_FIELDS.map((field) =>
      field.name === 'goals' ? { ...field, name: 'Time.on.Ground' } : field
    );
  return profile === 'completed_match_result'
    ? [
        ...LOCAL_FITZROY_REHEARSAL_FIELDS,
        {
          name: mixedCaseResultFields ? 'Match_id' : 'home_points',
          storageType: 'integer',
          classes: ['integer'],
          levels: null,
          timezone: null,
        },
        {
          name: mixedCaseResultFields ? 'MI5' : 'away_points',
          storageType: 'integer',
          classes: ['integer'],
          levels: null,
          timezone: null,
        },
      ]
    : LOCAL_FITZROY_REHEARSAL_FIELDS;
}

export function createLocalAflTradeFitzRoyFactualRehearsalFixture(options?: {
  hpnPlayerSide?: 'home' | 'away';
  goals?: string;
  generation?: LocalFitzRoyFactualRehearsalGeneration;
  provider?: LocalFitzRoyFactualRehearsalProvider;
  profile?: RehearsalProfile;
  missingCompletionStatus?: boolean;
  mixedCaseResultFields?: boolean;
  seasonYear?: number;
}) {
  if (options?.hpnPlayerSide && options.profile !== 'hpn_player_stats')
    throw new TypeError('An explicit player side requires the synthetic HPN profile.');
  const generation = options?.generation ?? 'replacement';
  const seasonYear = options?.seasonYear ?? 2026;
  if (!Number.isInteger(seasonYear) || seasonYear < 2018 || seasonYear > 2026)
    throw new TypeError('The synthetic rehearsal season is unsupported.');
  const provider = options?.provider ?? 'footywire';
  if (
    options?.profile === 'match_only' &&
    (provider !== 'afl_tables' || options.missingCompletionStatus)
  )
    throw new TypeError(
      'Match-only results require explicit AFL Tables without a synthetic status column.'
    );
  if (options?.profile === 'appearance_only' && provider !== 'afl_tables')
    throw new TypeError('The appearance-only synthetic profile is explicitly AFL Tables.');
  if (options?.mixedCaseResultFields && options.profile !== 'completed_match_result')
    throw new TypeError('Mixed-case result fields require the synthetic completed-result profile.');
  const fields = rehearsalFields(options?.profile, options?.mixedCaseResultFields);
  const capabilityId =
    options?.profile === 'match_only'
      ? 'afl-tables-results'
      : provider === 'footywire'
        ? 'footywire-player-stats'
        : 'afl-tables-player-stats';
  const captureRequest: AflTradeFitzRoyCaptureRequest =
    options?.profile === 'match_only'
      ? {
          schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
          capabilityId: 'afl-tables-results',
          competition: 'AFLM',
          authorizationSeason: seasonYear,
          parameters: { season: seasonYear, roundNumber: null },
        }
      : ({
          schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
          capabilityId,
          competition: 'AFLM',
          authorizationSeason: seasonYear,
          parameters:
            provider === 'footywire'
              ? { season: seasonYear, checkExisting: generation === 'replacement' }
              : { season: seasonYear, rescrape: generation === 'replacement', rescrapeStartSeason: seasonYear },
        } as const);
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const sourceBytes = Uint8Array.from([
    88,
    10,
    0,
    0,
    provider === 'footywire' ? 0 : 1,
    generation === 'baseline' ? 2 : 3,
    ...(options?.profile === 'completed_match_result' ? [4] : []),
    ...(options?.profile === 'appearance_only' ? [5] : []),
    ...(options?.missingCompletionStatus ? [6] : []),
    ...(options?.profile === 'match_only' ? [7] : []),
    ...(options?.mixedCaseResultFields ? [8] : []),
    ...(options?.profile === 'hpn_player_stats' ? [9] : []),
    ...(options?.hpnPlayerSide === 'away' ? [10] : []),
  ]);
  const command = approvedSourceAuthority(captureRequest, fields);
  const upstreamRate = command.sourceRights.content.automatedAccess.rateLimit;
  if (upstreamRate === null)
    throw new Error('The synthetic capture requires an explicit provider rate.');
  const rawArtifactRepository = durableRepository('raw_source');
  const metadataArtifactRepository = durableRepository('capture_metadata');
  const diagnostics = captureDiagnostics(invocation, fields, options?.missingCompletionStatus, seasonYear);
  const diagnosticsBytes = encoded(diagnostics);
  const egressCondition = command.sourceRights.content.conditions.find(
    ({ conditionId }) => conditionId === 'provider-egress-control'
  );
  const egressPolicyEvidenceId = egressCondition?.verificationEvidenceIds[0];
  if (egressPolicyEvidenceId === undefined) {
    throw new Error('The rehearsal requires one provider-egress-control evidence ID.');
  }
  const captureClockValues = [
    '2026-08-12T00:00:10.000Z',
    '2026-08-12T00:00:20.000Z',
    '2026-08-12T00:00:21.000Z',
    '2026-08-12T00:00:22.000Z',
    LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt,
    '2026-08-12T00:01:02.000Z',
  ];
  const executor: AflTradeFitzRoyCaptureDependencies['executor'] = {
    executionBoundary: 'attested_rate_limited',
    egressPolicyEvidenceIds: [egressPolicyEvidenceId],
    async execute(runtimeInvocation) {
      return {
        sourceBytes,
        diagnostics,
        egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
          content: {
            schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
            executionBoundary: 'attested_provider_egress',
            provider: runtimeInvocation.provider,
            capabilityId: runtimeInvocation.capabilityId,
            directFunction: runtimeInvocation.directFunction,
            fitzRoyVersion: runtimeInvocation.fitzRoyVersion,
            invocationSha256: sha256AflTradeCanonicalJson(runtimeInvocation),
            sourceOutput: {
              contentSha256: digestBytes(sourceBytes),
              byteLength: sourceBytes.byteLength,
            },
            diagnosticsOutput: {
              contentSha256: digestBytes(diagnosticsBytes),
              byteLength: diagnosticsBytes.byteLength,
            },
            runtime: LOCAL_FITZROY_REHEARSAL_RUNTIME,
            enforcedPolicy: {
              upstreamRate,
              cacheSeconds: 86_400,
              egressPolicyEvidenceId,
            },
            startedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.captureStartedAt,
            completedAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt,
            status: 'succeeded',
          },
          signature: {
            algorithm: 'Ed25519',
            keyId: 'local-rehearsal-key',
            valueBase64Url: 'A'.repeat(86),
          },
        }),
      };
    },
  };
  const fieldMap = parseAflTradeFitzRoyFieldMap(
    options?.profile === 'match_only'
      ? {
          ...createLocalAflTradeAflTablesResultsAuthority(seasonYear).fieldMap,
          mapId: 'synthetic-afl-tables-match-only-v1',
          approvedAt: '2026-08-11T23:59:00.000Z',
          approvalDecisionId: 'synthetic-afl-tables-match-only-review',
        }
      : {
          schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
          mapId:
            (options?.profile === 'hpn_player_stats' ? 'hpn-player-stats-' : '') +
            (options?.hpnPlayerSide === 'away' ? 'away-' : '') +
            (options?.mixedCaseResultFields ? 'mixed-case-results-' : '') +
            (options?.missingCompletionStatus ? 'missing-completion-' : '') +
            (options?.profile === 'appearance_only'
              ? `${capabilityId}-local-rehearsal-appearance-${generation}-v1`
              : options?.profile === 'completed_match_result'
                ? `${capabilityId}-local-rehearsal-results-${generation}-v1`
                : generation === 'baseline'
                  ? `${capabilityId}-local-rehearsal-baseline-v1`
                  : `${capabilityId}-local-rehearsal-v1`),
          capabilityId: captureRequest.capabilityId,
          fitzRoyVersion: '1.7.0',
          sourceSchemaSha256: createDecodedFieldSchemaSha256(fields),
          exactOrderedFields: fields.map(({ name }) => name),
          observationKind: 'player_stat',
          ...(options?.profile === 'appearance_only'
            ? {
                statisticalInterpretation: 'raw_evidence_only',
                appearanceEvidence: 'requires_independent_review',
              }
            : {}),
          competition: 'AFLM',
          invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
          validFromSeason: seasonYear,
          validThroughSeason: seasonYear,
          seasonField: { sourceField: 'season', required: true },
          roundLabelField: { sourceField: 'round', required: true },
          observedDateField: { sourceField: 'match_date', required: true },
          naturalKeyFields: ['match_id', 'player_id'],
          approvedAt: '2026-08-11T23:59:00.000Z',
          approvalDecisionId:
            (options?.profile === 'hpn_player_stats' ? 'hpn-player-stats-' : '') +
            (options?.hpnPlayerSide === 'away' ? 'away-' : '') +
            (options?.mixedCaseResultFields ? 'mixed-case-results-' : '') +
            (options?.profile === 'appearance_only' ? 'appearance-only-' : '') +
            (options?.missingCompletionStatus ? 'missing-completion-' : '') +
            (options?.profile === 'completed_match_result' ? 'completed-result-' : '') +
            (provider === 'footywire' ? '' : 'afl-tables-') +
            (generation === 'baseline'
              ? 'local-rehearsal-field-map-review-baseline'
              : 'local-rehearsal-field-map-review'),
          identity: {
            nativeId: { sourceField: 'player_id', required: true },
            recordedName: { sourceField: 'player_name', required: true },
            recordedClubNativeId: { sourceField: 'club_id', required: true },
            recordedClubName: { sourceField: options?.hpnPlayerSide ?? 'home', required: true },
          },
          match: {
            nativeMatchId: { sourceField: 'match_id', required: true },
            season: { sourceField: 'season', required: true },
            roundLabel: { sourceField: 'round', required: true },
            matchDate: { sourceField: 'match_date', required: true },
            homeClubNativeId: { sourceField: 'home_club_id', required: true },
            homeClubName: { sourceField: 'home', required: true },
            awayClubNativeId: { sourceField: 'away_club_id', required: true },
            awayClubName: { sourceField: 'away', required: true },
            status: { sourceField: 'status', required: !options?.missingCompletionStatus },
          },
          metrics:
            options?.profile === 'appearance_only'
              ? []
              : [
                  {
                    metricCode: 'goals',
                    sourceField: 'goals',
                    definitionVersion: 'goals/v1',
                    unit: 'goals',
                    zeroSemantics:
                      provider === 'afl_tables'
                        ? 'provider_zero_may_mean_missing'
                        : 'measured_zero',
                  },
                ],
          achievement: null,
        }
  );
  return {
    command: {
      capture: command,
      fieldMapId: fieldMap.mapId,
      fieldMap,
      effectiveAt: LOCAL_FITZROY_REHEARSAL_INSTANTS.effectiveAt,
    },
    rawArtifactRepository,
    metadataArtifactRepository,
    captureDependencies: {
      rawArtifactRepository,
      metadataArtifactRepository,
      executor,
      captureAdmission: captureAdmission(),
      egressExecutionVerifier: {
        async verify() {
          return true;
        },
      },
      authorizationResolver: {
        async resolveAuthorization() {
          return { ledger: command.ledger, sourceRights: command.sourceRights };
        },
      },
      clock: {
        now: () =>
          captureClockValues.shift() ?? LOCAL_FITZROY_REHEARSAL_INSTANTS.captureCompletedAt,
      },
      runtimeIdentity: LOCAL_FITZROY_REHEARSAL_RUNTIME,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumDiagnosticsBytes: 65_536,
    } satisfies AflTradeFitzRoyCaptureDependencies,
    decoderExecutor: decodedTableExecutor(
      options?.goals ?? '2',
      options?.profile,
      options?.missingCompletionStatus,
      options?.mixedCaseResultFields,
      options?.hpnPlayerSide,
      seasonYear
    ),
    gateDecisionId: command.ledger.decisions[0]!.decisionId,
  };
}
