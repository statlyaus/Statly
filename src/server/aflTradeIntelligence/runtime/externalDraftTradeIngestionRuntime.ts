import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

import { createAflTradeArtifactCustodyProfile } from '../artifacts/artifactCustodyProfile';
import { createAflTradeDurableObjectArtifactRepository } from '../artifacts/durableObjectArtifactRepository';
import { createAflTradeS3ConditionalObjectStore } from '../artifacts/s3ConditionalObjectStore';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '../outcomes/pgOutcomeSqlClient';
import { parseOfficialAflIndicativeDraftOrder } from '../source/draftCorroborationAdapter';
import {
  captureDraftguruSource,
  parseDraftguruPlayerTradeDetail,
  parseDraftguruTradeDetail,
  parseDraftguruTradeIndexEvidence,
  parseDraftguruYearSelections,
} from '../source/draftguruSourceAdapter';
import { createAflTradeExternalCaptureAdmission } from '../source/externalDraftTradeCaptureAdmission';
import type { AflTradeExternalPageCapture } from '../source/externalDraftTradeIngestion';
import {
  ingestAuthorizedAflTradeExternalPage,
  type AflTradeExternalProviderIngestionCommand,
  type AflTradeExternalProviderIngestionResult,
} from '../source/externalDraftTradeProviderIngestion';
import {
  captureFootywireDraftSource,
  parseFootywireDraftSelections,
} from '../source/footywireDraftSourceAdapter';
import { createAflTradeIoredisCaptureAdmissionStore } from '../source/fitzRoyRedisCaptureAdmissionStore';
import { PostgresAflTradeExternalCaptureRegistry } from '../source/postgresExternalCaptureRegistry';
import { PostgresAflTradeExternalEvidenceRepository } from '../source/postgresExternalEvidenceRepository';
import type { AflTradeExternalIngestionConfig } from './externalDraftTradeIngestionConfig';

export interface AflTradeExternalIngestionRuntime {
  ingest(
    command: AflTradeExternalProviderIngestionCommand
  ): Promise<AflTradeExternalProviderIngestionResult>;
  close(): Promise<void>;
}

export function createAflTradeExternalIngestionCustodyProfile(
  config: AflTradeExternalIngestionConfig
) {
  return createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: `${config.objectStorage.repositoryId}-raw-source`,
    environment: config.environment,
    artifactClass: 'raw_source',
    maximumObjectBytes: config.limits.maximumSourceBytes,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: {
        mode: 'customer_managed',
        keyReferenceSha256: createHash('sha256')
          .update(config.objectStorage.kmsKeyId, 'utf8')
          .digest('hex'),
      },
    },
    retention: {
      deletion: {
        kind: 'maximum_age',
        maximumDays: config.limits.rawRetentionDays,
        enforcement: 'provider_lifecycle_required',
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: config.objectStorage.allowedJurisdictions,
      crossJurisdictionTransfer: 'approved_jurisdictions_only',
    },
    infrastructureEvidenceIds: config.objectStorage.infrastructureEvidenceIds,
  });
}

function identifiedFetch(userAgent: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', userAgent);
    return fetch(input, { ...init, headers });
  };
}

async function readBounded(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('External source response body is absent.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('bounded source limit exceeded');
        throw new Error('External source response exceeds the configured byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function captureOfficialAflPage(input: {
  url: string;
  validators: { eTag: string | null; lastModified: string | null } | null;
  maximumBytes: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<AflTradeExternalPageCapture> {
  const url = new URL(input.url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.afl.com.au' ||
    !/^\/news\/\d+\/[a-z0-9-]+(?:\/amp)?$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new TypeError('Official AFL capture URL is outside the approved article path.');
  }
  const headers = new Headers({ Accept: 'text/html,application/xhtml+xml' });
  if (input.validators?.eTag) headers.set('If-None-Match', input.validators.eTag);
  if (input.validators?.lastModified)
    headers.set('If-Modified-Since', input.validators.lastModified);
  const response = await input.fetchImpl(url.href, {
    method: 'GET',
    redirect: 'error',
    headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  const eTag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  if (response.status === 304)
    return { status: 'not_modified', sourceUrl: url.href, eTag, lastModified };
  if (response.status !== 200) throw new Error(`Official AFL capture returned ${response.status}.`);
  const mediaType = response.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(mediaType))
    throw new Error('Official AFL capture returned unsupported content type.');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > input.maximumBytes)
    throw new Error('Official AFL response exceeds the configured byte limit.');
  const bytes = await readBounded(response, input.maximumBytes);
  return {
    status: 'captured',
    sourceUrl: url.href,
    bytes,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    mediaType,
    eTag,
    lastModified,
  };
}

export function createAflTradeExternalIngestionRuntime(
  config: AflTradeExternalIngestionConfig
): AflTradeExternalIngestionRuntime {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });
  const s3 = new S3Client({ region: config.objectStorage.region });
  const sql = createPgAflOutcomeSqlClient(pool);
  const gateRepository = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  const rawArtifacts = createAflTradeDurableObjectArtifactRepository({
    objectStore: createAflTradeS3ConditionalObjectStore({
      client: s3,
      bucket: config.objectStorage.bucket,
      keyPrefix: config.objectStorage.keyPrefix,
      kmsKeyId: config.objectStorage.kmsKeyId,
    }),
    custodyProfile: createAflTradeExternalIngestionCustodyProfile(config),
  });
  const captureRegistry = new PostgresAflTradeExternalCaptureRegistry(sql);
  const staging = new PostgresAflTradeExternalEvidenceRepository(sql);
  const admission = createAflTradeExternalCaptureAdmission({
    redis: createAflTradeIoredisCaptureAdmissionStore(redis),
    createToken: randomUUID,
  });
  const fetchImpl = identifiedFetch(config.userAgent);
  const clock = { now: () => new Date().toISOString() };

  return {
    async ingest(command) {
      const capturedAt = clock.now();
      if (
        command.request.environment !== config.environment ||
        command.request.maximumBytes > config.limits.maximumSourceBytes ||
        Date.parse(command.request.effectiveAt) > Date.parse(capturedAt)
      ) {
        throw new TypeError(
          'External ingestion requires a bounded request matching the configured authority environment.'
        );
      }
      const effectiveCommand = {
        ...command,
        request: { ...command.request, capturedAt },
      };
      const parsePage = ({
        html,
        capture,
      }: Parameters<
        NonNullable<
          import('../source/externalDraftTradeIngestion').AflTradeExternalPageIngestionDependencies['parsePage']
        >
      >[0]) => {
        switch (command.request.capabilityId) {
          case 'draftguru-trade-index':
            return parseDraftguruTradeIndexEvidence(html, {
              capture,
              fromYear: command.request.discoveryFromSeasonYear ?? command.request.anchorSeasonYear,
              throughYear: command.request.anchorSeasonYear,
            });
          case 'draftguru-trade-detail':
            return parseDraftguruTradeDetail(html, {
              capture,
              draftYear: command.request.anchorSeasonYear,
              effectiveAt: command.request.effectiveAt,
            });
          case 'draftguru-player-trade-detail':
            return parseDraftguruPlayerTradeDetail(html, {
              capture,
              draftYear: command.request.anchorSeasonYear,
              effectiveAt: command.request.effectiveAt,
            });
          case 'draftguru-year-page':
            return parseDraftguruYearSelections(html, {
              capture,
              draftYear: command.request.anchorSeasonYear,
            });
          case 'footywire-draft-results':
            return parseFootywireDraftSelections(html, { capture });
          case 'official-afl-indicative-draft-order':
            return parseOfficialAflIndicativeDraftOrder(html, {
              capture,
              draftYear: command.request.anchorSeasonYear,
              observedAt: command.request.effectiveAt,
            });
          default:
            throw new TypeError('External ingestion capability is not implemented.');
        }
      };
      return ingestAuthorizedAflTradeExternalPage(effectiveCommand, {
        admission,
        policyFor: (provider) => ({
          ...config.providerPolicies[provider],
          rawRetentionDays: config.limits.rawRetentionDays,
        }),
        resolveAuthorization: (rightsArtifactId) =>
          gateRepository.resolveAuthorization(rightsArtifactId),
        ingestion: {
          rawArtifacts,
          captureRegistry,
          staging,
          capturePage: ({ url, validators, maximumBytes }) => {
            const common = {
              url,
              validators,
              maximumBytes,
              timeoutMs: config.limits.timeoutMs,
              fetchImpl,
            };
            if (effectiveCommand.request.provider === 'draftguru')
              return captureDraftguruSource(common);
            if (effectiveCommand.request.provider === 'footywire')
              return captureFootywireDraftSource(common);
            return captureOfficialAflPage(common);
          },
          parsePage,
        },
        clock,
      });
    },
    async close() {
      s3.destroy();
      await Promise.all([pool.end(), redis.quit()]);
    },
  };
}
