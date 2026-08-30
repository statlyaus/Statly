import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { generateKeyPairSync, sign } from 'node:crypto';

import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  createAflTradeFitzRoyInvocation,
  type AflTradeFitzRoyCaptureDiagnostics,
} from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import {
  AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
  createAflTradeFitzRoyEgressExecutionReceipt,
} from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';
import { createAflTradeEd25519EgressExecutionVerifier } from '@/server/aflTradeIntelligence/source/fitzRoyHttpEgressExecutor';
import {
  AFL_TRADE_FITZROY_DECODER_VERSION,
  type AflTradeFitzRoyDecoderExecutor,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationDecodeRuntime';
import {
  AFL_TRADE_FITZROY_DECODED_TABLE_SCHEMA_VERSION,
  createAflTradeFitzRoyFieldMapSha256,
  type AflTradeDecodedScalar,
} from '@/server/aflTradeIntelligence/source/fitzRoyObservationContracts';
import { stageAflTradeFitzRoySourceSnapshot } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureToStaging';
import { captureAuthorizedAflTradeFitzRoyProviderSeason } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';
import { PostgresAflTradeProviderObservationRepository } from '@/server/aflTradeIntelligence/source/postgresProviderObservationRepository';
import { PostgresAflTradeSourceCaptureRepository } from '@/server/aflTradeIntelligence/source/postgresSourceCaptureRepository';
import {
  createLocalAflTradeAflTablesResultsAuthority,
  createLocalAflTradeFiveSeasonAflTablesAuthority,
  LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA,
  LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA,
} from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesAuthority';
import { LOCAL_AFL_TRADE_FITZROY_RUNTIME } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesStaging';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  createLocalAflTradeOfficialAfl2026Authority,
  LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA,
} from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Authority';
import {
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES,
  type AflTradeCurrentValuationEvidenceSource,
} from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import {
  createPostgresAflTradeCurrentValuationEvidenceSourceRuntime,
  retainAflTradeCurrentValuationObservedCapture,
} from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationEvidenceOrchestration';

const FIXTURE_AT = '2026-08-29T12:00:00.000Z';
const encoded = (value: unknown) => new TextEncoder().encode(canonicalizeAflTradeJson(value));
const digestBytes = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

type SourceAuthority = ReturnType<typeof createLocalAflTradeFiveSeasonAflTablesAuthority>;
type FieldDescriptor = (typeof LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA)[number];

function authorityFor(source: AflTradeCurrentValuationEvidenceSource): SourceAuthority {
  if (source.capabilityId === 'official-afl-player-stats') {
    return createLocalAflTradeOfficialAfl2026Authority();
  }
  if (source.capabilityId === 'afl-tables-results') {
    return createLocalAflTradeAflTablesResultsAuthority(source.seasonYear);
  }
  return createLocalAflTradeFiveSeasonAflTablesAuthority(source.seasonYear);
}

function fieldsFor(source: AflTradeCurrentValuationEvidenceSource): readonly FieldDescriptor[] {
  if (source.capabilityId === 'official-afl-player-stats') {
    return LOCAL_OFFICIAL_AFL_2026_PLAYER_STATS_FIELD_SCHEMA;
  }
  if (source.capabilityId === 'afl-tables-results') {
    return LOCAL_AFL_TABLES_RESULTS_FIELD_SCHEMA;
  }
  return LOCAL_AFL_TABLES_PLAYER_STATS_FIELD_SCHEMA;
}

function text(value: string): AflTradeDecodedScalar {
  return { kind: 'text', value };
}

function integer(value: number): AflTradeDecodedScalar {
  return { kind: 'integer', value: String(value) };
}

function finite(value: number): AflTradeDecodedScalar {
  return { kind: 'finite_number', value: String(value) };
}

function date(value: string): AflTradeDecodedScalar {
  return { kind: 'date', value, rawDays: '19000' };
}

function fixtureValues(
  source: AflTradeCurrentValuationEvidenceSource
): Readonly<Record<string, AflTradeDecodedScalar>> {
  if (source.capabilityId === 'official-afl-player-stats') {
    return {
      providerId: text('fixture-official-match-2026-1'),
      utcStartTime: text('2026-03-15T04:15:00.000Z'),
      status: text('CONCLUDED'),
      'compSeason.shortName': text('2026'),
      'round.name': text('Round 1'),
      'home.team.name': text('Carlton'),
      'away.team.name': text('Richmond'),
      goals: finite(1),
      'player.playerId': text('fixture-official-player-1'),
      'player.givenName': text('Fixture'),
      'player.surname': text('Player'),
      teamId: text('fixture-carlton'),
      'team.name': text('Carlton'),
    };
  }
  if (source.capabilityId === 'afl-tables-results') {
    return {
      Game: finite(1),
      Date: date('2026-03-20'),
      Round: text('Round 1'),
      'Home.Team': text('Carlton'),
      'Away.Team': text('Richmond'),
      Season: finite(2026),
    };
  }
  return {
    Season: integer(source.seasonYear),
    Round: text('Round 1'),
    Date: date(`${source.seasonYear}-03-20`),
    ID: integer(source.seasonYear * 1000 + 1),
    'Playing.for': text('Carlton'),
    Goals: integer(1),
    'Home.team': text('Carlton'),
    'Away.team': text('Richmond'),
    Player: text(`Fixture Player ${source.seasonYear}`),
  };
}

function captureDiagnostics(
  source: AflTradeCurrentValuationEvidenceSource,
  authority: SourceAuthority,
  row: readonly AflTradeDecodedScalar[]
): AflTradeFitzRoyCaptureDiagnostics {
  const invocation = createAflTradeFitzRoyInvocation(authority.capture.captureRequest);
  return {
    schemaVersion: 'afl-trade-fitzroy-diagnostics/v1',
    capabilityId: invocation.capabilityId,
    fitzRoyVersion: invocation.fitzRoyVersion,
    directFunction: invocation.directFunction,
    invocationSha256: sha256AflTradeCanonicalJson(invocation),
    runtime: { ...LOCAL_AFL_TRADE_FITZROY_RUNTIME, platform: 'fixture-linux' },
    rowCount: 1,
    duplicateRowCount: 0,
    fields: fieldsFor(source).map((field, index) => ({
      ...field,
      missingCount: row[index]?.kind === 'missing' ? 1 : 0,
      nanCount: 0,
      positiveInfinityCount: 0,
      negativeInfinityCount: 0,
    })),
    observedSeasonValues:
      source.capabilityId === 'official-afl-player-stats' ? [] : [String(source.seasonYear)],
    observedRoundValues: ['Round 1'],
    observedDateRange: null,
    originObservation: 'not_exposed_by_fitzroy',
    conditions: [],
  };
}

function decoder(
  source: AflTradeCurrentValuationEvidenceSource,
  row: readonly AflTradeDecodedScalar[]
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
          rVersion: LOCAL_AFL_TRADE_FITZROY_RUNTIME.rVersion,
          dependencyLockSha256: context.dependencyLockSha256,
          imageDigest: context.imageDigest,
        },
        frame: { classes: ['data.frame'], rowNames: ['1'] },
        fields: fieldsFor(source),
        rows: [row],
      });
    },
  };
}

async function retainReviewedFieldMap(
  client: AflOutcomeSqlClient,
  authority: SourceAuthority
): Promise<void> {
  const fieldMapSha256 = createAflTradeFitzRoyFieldMapSha256(authority.fieldMap);
  await client.query(
    `INSERT INTO outcome_review_decision
      (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
     VALUES ($1,'provider_field_map',$2,'approved',$3,
             jsonb_build_object('fieldMapSha256',$4::text),$5,$6)
     ON CONFLICT (decision_id) DO NOTHING`,
    [
      authority.fieldMap.approvalDecisionId,
      authority.fieldMap.mapId,
      'Governed exact field-map fixture for current valuation orchestration.',
      fieldMapSha256,
      'fixture-source-governance-reviewer',
      authority.fieldMap.approvedAt,
    ]
  );
  await client.query(
    `INSERT INTO outcome_provider_field_map
      (field_map_id,capability_id,fitzroy_version,source_schema_sha256,
       field_map_sha256,approval_decision_id,approved_at,map_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (field_map_id) DO NOTHING`,
    [
      authority.fieldMap.mapId,
      authority.fieldMap.capabilityId,
      authority.fieldMap.fitzRoyVersion,
      authority.fieldMap.sourceSchemaSha256,
      fieldMapSha256,
      authority.fieldMap.approvalDecisionId,
      authority.fieldMap.approvedAt,
      canonicalizeAflTradeJson(authority.fieldMap),
    ]
  );
}

export async function createGovernedCurrentValuationEvidenceSourceFixture(input: {
  readonly client: AflOutcomeSqlClient;
  readonly artifactRoot: string;
  readonly capturedSourceKeys: string[];
}) {
  await input.client.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     SELECT 'AFLM',season_year FROM unnest($1::smallint[]) seasons(season_year)
     ON CONFLICT DO NOTHING`,
    [[2021, 2022, 2023, 2024, 2025, 2026]]
  );
  await input.client.query(
    `INSERT INTO outcome_metric_definition
      (metric_code,definition_version,display_name,value_type,canonical_unit,
       non_negative,definition_json,status)
     VALUES
      ('goals','goals/v1','Goals','numeric','goals',true,'{}'::jsonb,'approved'),
      ('games','games/v1','Games','numeric','games',true,'{}'::jsonb,'approved')
     ON CONFLICT DO NOTHING`
  );
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(input.client);
  const gateAuthorities = [
    createLocalAflTradeFiveSeasonAflTablesAuthority(2021),
    createLocalAflTradeOfficialAfl2026Authority(),
    createLocalAflTradeAflTablesResultsAuthority(2026),
  ];
  const gate = await gateRepository.load();
  await gateRepository.appendBatch({
    expectedRevision: gate.revision,
    records: gateAuthorities.map((authority) => ({
      sourceRights: authority.capture.sourceRights,
      proposal: authority.capture.ledger.proposals[0]!,
      decision: authority.capture.ledger.decisions[0]!,
    })),
  });
  for (const source of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES) {
    await retainReviewedFieldMap(input.client, authorityFor(source));
  }

  const rawArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: input.artifactRoot,
    repositoryId: 'current-valuation-e2e-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: 1_024 * 1_024,
  });
  const metadataArtifactRepository = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: input.artifactRoot,
    repositoryId: 'current-valuation-e2e-metadata',
    artifactClass: 'capture_metadata',
    maximumObjectBytes: 1_024 * 1_024,
  });
  const sourceCaptureRepository = new PostgresAflTradeSourceCaptureRepository(input.client);
  const providerObservationRepository = new PostgresAflTradeProviderObservationRepository(
    input.client
  );
  const signingKeyId = 'current-valuation-e2e-fixture';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const egressExecutionVerifier = createAflTradeEd25519EgressExecutionVerifier({
    [signingKeyId]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
  let captureSequence = 0;
  let fixtureNow = FIXTURE_AT;
  const stagingDependencies = (source: AflTradeCurrentValuationEvidenceSource) => {
    const fields = fieldsFor(source);
    const values = fixtureValues(source);
    const row = fields.map(({ name }) => values[name] ?? ({ kind: 'missing' } as const));
    return {
      rawArtifactRepository,
      sourceCaptureRepository,
      providerObservationRepository,
      decoderExecutor: decoder(source, row),
      clock: { now: () => fixtureNow },
      dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024 * 1_024,
      maximumRows: 10,
      maximumFields: 120,
      maximumCells: 1_200,
      maximumCellBytes: 8_192,
      maximumOutputBytes: 1_024 * 1_024,
      egressExecutionVerifier,
    } as const;
  };
  return createPostgresAflTradeCurrentValuationEvidenceSourceRuntime({
    client: input.client,
    gateRepository,
    clock: { now: () => fixtureNow },
    normalizationRuntime: {
      dependencyLockSha256: LOCAL_AFL_TRADE_FITZROY_RUNTIME.dependencyLockSha256,
      imageDigest: LOCAL_AFL_TRADE_FITZROY_RUNTIME.imageDigest,
    },
    capture: async ({ source, authority, request, authoritySha256 }) => {
      captureSequence += 1;
      fixtureNow = new Date(Date.parse(FIXTURE_AT) + captureSequence).toISOString();
      input.capturedSourceKeys.push(source.sourceKey);
      const fields = fieldsFor(source);
      const values = fixtureValues(source);
      const row = fields.map(({ name }) => values[name] ?? ({ kind: 'missing' } as const));
      const diagnostics = captureDiagnostics(source, authority, row);
      const sourceBytes = Uint8Array.from([
        88,
        10,
        0,
        0,
        0,
        AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.indexOf(source) + 1,
      ]);
      const diagnosticsBytes = encoded(diagnostics);
      const rate = authority.capture.sourceRights.content.automatedAccess.rateLimit!;
      const egressPolicyEvidenceId = authority.capture.sourceRights.content.conditions.find(
        ({ conditionId }) => conditionId === 'provider-egress-control'
      )!.verificationEvidenceIds[0]!;
      const captured = await captureAuthorizedAflTradeFitzRoyProviderSeason(
        {
          capture: authority.capture,
          fieldMapId: authority.fieldMap.mapId,
          fieldMap: authority.fieldMap,
          effectiveAt: FIXTURE_AT,
        },
        {
          capture: {
            rawArtifactRepository,
            metadataArtifactRepository,
            executor: {
              executionBoundary: 'local_rate_limited_docker',
              egressPolicyEvidenceIds: [egressPolicyEvidenceId],
              async execute(invocation) {
                const content = {
                  schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
                  executionBoundary: 'local_non_production_docker' as const,
                  enforcementScope: 'capture_admission_only' as const,
                  provider: invocation.provider,
                  capabilityId: invocation.capabilityId,
                  directFunction: invocation.directFunction,
                  fitzRoyVersion: invocation.fitzRoyVersion,
                  invocationSha256: sha256AflTradeCanonicalJson(invocation),
                  sourceOutput: {
                    contentSha256: digestBytes(sourceBytes),
                    byteLength: sourceBytes.byteLength,
                  },
                  diagnosticsOutput: {
                    contentSha256: digestBytes(diagnosticsBytes),
                    byteLength: diagnosticsBytes.byteLength,
                  },
                  runtime: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
                  enforcedPolicy: {
                    upstreamRate: rate,
                    cacheSeconds: authority.capture.gateRequest.cacheSeconds!,
                    egressPolicyEvidenceId,
                  },
                  startedAt: fixtureNow,
                  completedAt: fixtureNow,
                  status: 'succeeded' as const,
                };
                const valueBase64Url = sign(
                  null,
                  Buffer.from(canonicalizeAflTradeJson(content), 'utf8'),
                  privateKey
                ).toString('base64url');
                return {
                  sourceBytes,
                  diagnostics,
                  egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
                    content,
                    signature: {
                      algorithm: 'Ed25519',
                      keyId: signingKeyId,
                      valueBase64Url,
                    },
                  }),
                };
              },
            },
            egressExecutionVerifier,
            authorizationResolver: gateRepository,
            clock: { now: () => fixtureNow },
            runtimeIdentity: LOCAL_AFL_TRADE_FITZROY_RUNTIME,
            timeoutMs: 30_000,
            maximumSourceBytes: 1_024 * 1_024,
            maximumDiagnosticsBytes: 1_024 * 1_024,
          },
          staging: stagingDependencies(source),
          clock: { now: () => fixtureNow },
        }
      );
      const persisted = await sourceCaptureRepository.persist(captured.snapshot, {
        afterPersist: async ({ transaction, capture, sourceContentSha256 }) => {
          await retainAflTradeCurrentValuationObservedCapture(transaction, {
            request,
            source,
            observedCaptureId: capture.captureId,
            sourceContentSha256,
            authoritySha256,
          });
        },
      });
      return {
        captureId: persisted.captureId,
        sourceContentSha256: captured.snapshot.content.sourceArtifact.contentSha256,
        snapshot: captured.snapshot,
      };
    },
    resumeNormalization: async ({ source, authority, snapshot }) => {
      const staging = await stageAflTradeFitzRoySourceSnapshot(
        { snapshot, fieldMapId: authority.fieldMap.mapId, fieldMap: authority.fieldMap },
        stagingDependencies(source)
      );
      return {
        state: 'ready',
        sourceKey: source.sourceKey,
        observedCaptureId: staging.capture.captureId,
        effectiveCaptureId: staging.capture.captureId,
        normalizationRunId: staging.normalization.normalizationRunId,
      };
    },
  });
}
