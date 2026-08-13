import { createHash } from 'node:crypto';

import { createAflTradeArtifactCustodyProfile } from '../artifacts/artifactCustodyProfile';
import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
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
  captureRequest: AflTradeFitzRoyCaptureRequest
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
  const fieldNames = LOCAL_FITZROY_REHEARSAL_FIELDS.map(({ name }) => name);
  const rateLimitEvidenceId = `artifact:${sha('d')}`;
  const sourceRights = createApprovedAflTradeFitzRoySourcePolicies({
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
  }).find(({ content }) => content.provider === 'footywire');
  if (sourceRights === undefined) throw new Error('Footywire rehearsal policy is missing.');
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
      season: 2026,
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
  invocation: ReturnType<typeof createAflTradeFitzRoyInvocation>
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
    fields: LOCAL_FITZROY_REHEARSAL_FIELDS.map((field) => ({
      ...field,
      missingCount: 0,
      nanCount: 0,
      positiveInfinityCount: 0,
      negativeInfinityCount: 0,
    })),
    observedSeasonValues: ['2026'],
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

function decodedTableExecutor(goals: string): AflTradeFitzRoyDecoderExecutor {
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
        fields: LOCAL_FITZROY_REHEARSAL_FIELDS,
        rows: [
          [
            { kind: 'integer', value: '2026' },
            { kind: 'text', value: 'provider-match-1' },
            { kind: 'text', value: '2026-03-20T08:00:00.000Z' },
            { kind: 'text', value: 'Final' },
            { kind: 'text', value: 'provider-player-1' },
            { kind: 'text', value: 'Player One' },
            { kind: 'text', value: 'provider-club-1' },
            { kind: 'text', value: 'provider-club-1' },
            { kind: 'text', value: 'provider-club-2' },
            { kind: 'text', value: 'Carlton' },
            { kind: 'text', value: 'Fremantle' },
            { kind: 'text', value: 'Round 1' },
            { kind: 'integer', value: goals },
          ],
        ],
      });
    },
  };
}

export type LocalFitzRoyFactualRehearsalGeneration = 'baseline' | 'replacement';

export function createLocalAflTradeFitzRoyFactualRehearsalFixture(options?: {
  goals?: string;
  generation?: LocalFitzRoyFactualRehearsalGeneration;
}) {
  const generation = options?.generation ?? 'replacement';
  const captureRequest = {
    schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
    capabilityId: 'footywire-player-stats',
    competition: 'AFLM',
    authorizationSeason: 2026,
    parameters: { season: 2026, checkExisting: generation === 'replacement' },
  } as const;
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const sourceBytes = Uint8Array.from([88, 10, 0, 0, 0, generation === 'baseline' ? 2 : 3]);
  const command = approvedSourceAuthority(captureRequest);
  const rawArtifactRepository = durableRepository('raw_source');
  const metadataArtifactRepository = durableRepository('capture_metadata');
  const diagnostics = captureDiagnostics(invocation);
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
              upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
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
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId:
      generation === 'baseline'
        ? 'footywire-player-stats-local-rehearsal-baseline-v1'
        : 'footywire-player-stats-local-rehearsal-v1',
    capabilityId: captureRequest.capabilityId,
    fitzRoyVersion: '1.7.0',
    sourceSchemaSha256: createDecodedFieldSchemaSha256(LOCAL_FITZROY_REHEARSAL_FIELDS),
    exactOrderedFields: LOCAL_FITZROY_REHEARSAL_FIELDS.map(({ name }) => name),
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: 2026,
    validThroughSeason: 2026,
    seasonField: { sourceField: 'season', required: true },
    roundLabelField: { sourceField: 'round', required: true },
    observedDateField: { sourceField: 'match_date', required: true },
    naturalKeyFields: ['match_id', 'player_id'],
    approvedAt: '2026-08-11T23:59:00.000Z',
    approvalDecisionId:
      generation === 'baseline'
        ? 'local-rehearsal-field-map-review-baseline'
        : 'local-rehearsal-field-map-review',
    identity: {
      nativeId: { sourceField: 'player_id', required: true },
      recordedName: { sourceField: 'player_name', required: true },
      recordedClubNativeId: { sourceField: 'club_id', required: true },
      recordedClubName: { sourceField: 'home', required: true },
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
    decoderExecutor: decodedTableExecutor(options?.goals ?? '2'),
    gateDecisionId: command.ledger.decisions[0]!.decisionId,
  };
}
