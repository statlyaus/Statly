import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import {
  createPostgresAflTradeGateDecisionLedgerRepository,
  type AflTradeGateDecisionLedgerRepository,
} from '../governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  captureDraftguruSource,
  parseDraftguruTradeDetail,
  parseDraftguruTradeIndexEvidence,
} from '../source/draftguruSourceAdapter';
import { createAflTradeExternalCaptureAdmission } from '../source/externalDraftTradeCaptureAdmission';
import type { IngestAflTradeExternalPageResult } from '../source/externalDraftTradeIngestion';
import { ingestAuthorizedAflTradeExternalPage } from '../source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';
import { PostgresAflTradeExternalCaptureRegistry } from '../source/postgresExternalCaptureRegistry';
import { PostgresAflTradeExternalEvidenceRepository } from '../source/postgresExternalEvidenceRepository';
import {
  DRAFTGURU_TRADE_PARSER_VERSIONS,
  type DraftguruTradeCapability,
} from './localDraftguruTradeAuthorityProposal';
import {
  createDraftguruTradeCaptureCommand,
  createDraftguruTradeGateRequest,
  type DraftguruTradeAuthority,
} from './localDraftguruTradeCaptureCommand';
import { createLocalFileCaptureAdmissionStore } from './localFileCaptureAdmissionStore';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';

/**
 * The exact pacing, cache and retention the owner's narrow decision records. The runner enforces
 * these itself and refuses a recorded authority that says anything else, rather than adapting.
 */
export const LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY = {
  upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
  cacheSeconds: 86_400,
  maximumLeaseMs: 120_000,
  rawRetentionDays: 365,
} as const;

export const LOCAL_DRAFTGURU_TRADE_MAXIMUM_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAXIMUM_ADMISSION_ATTEMPTS = 5;
const DRAFTGURU_TRADE_INDEX_URL = 'https://www.draftguru.com.au/trades';

export class LocalDraftguruTradeCaptureError extends Error {
  constructor(
    readonly code: 'AUTHORITY_MISMATCH' | 'INVALID_TARGET' | 'ADMISSION_EXHAUSTED',
    message: string
  ) {
    super(message);
    this.name = 'LocalDraftguruTradeCaptureError';
  }
}

export function draftguruTradeDecisionKey(capabilityId: DraftguruTradeCapability): string {
  return `${capabilityId}-issue-579-private-non_production`;
}

export interface RecordedDraftguruTradeAuthority {
  authority: DraftguruTradeAuthority;
  decisionId: string;
  egressPolicyEvidenceId: string;
}

function mismatch(message: string): never {
  throw new LocalDraftguruTradeCaptureError('AUTHORITY_MISMATCH', message);
}

/**
 * Loads the owner's recorded narrow decision, its proposal and its source rights from the Gate ledger
 * and checks that they describe exactly the capability and pacing this runner enforces.
 */
export async function loadRecordedDraftguruTradeAuthority(
  ledger: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'resolveAuthorization'>,
  capabilityId: DraftguruTradeCapability,
  evaluatedAt: string
): Promise<RecordedDraftguruTradeAuthority> {
  const decisionKey = draftguruTradeDecisionKey(capabilityId);
  const stored = await ledger.load();
  const resolution = resolveAflTradeGateEligibility(stored.ledger, {
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    environment: 'non_production',
    evaluatedAt,
  });
  const decision = resolution.decision;
  if (resolution.status !== 'mechanically_eligible' || decision === null) {
    mismatch(
      `No effective ${decisionKey} decision: ${resolution.blockers.map(({ code }) => code).join(', ')}`
    );
  }
  const rightsIds = decision.content.affectedArtifacts
    .filter(({ kind }) => kind === 'source_rights')
    .map(({ artifactId }) => artifactId);
  const proposal = stored.ledger.proposals.find(
    ({ proposalId }) => proposalId === decision.content.proposalId
  );
  if (
    rightsIds.length !== 1 ||
    proposal === undefined ||
    proposal.content.decisionKey !== decisionKey ||
    !proposal.content.affectedArtifacts.some(
      ({ kind, artifactId }) => kind === 'source_rights' && artifactId === rightsIds[0]
    )
  ) {
    mismatch(`The ${decisionKey} decision does not pin exactly one proposed source-rights record.`);
  }
  const { sourceRights } = await ledger.resolveAuthorization(rightsIds[0]!);
  const rights = sourceRights.content;
  const policy = LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY;
  const rate = rights.automatedAccess.rateLimit;
  if (
    sourceRights.rightsArtifactId !== rightsIds[0] ||
    rights.provider !== 'draftguru' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== capabilityId ||
    rights.acquisition.clientVersion !== DRAFTGURU_TRADE_PARSER_VERSIONS[capabilityId] ||
    rights.scope.seasonRanges.length !== 1 ||
    rate === null ||
    rate.requests !== policy.upstreamRate.requests ||
    rate.perSeconds !== policy.upstreamRate.perSeconds ||
    rate.burst !== policy.upstreamRate.burst ||
    rights.automatedAccess.cache.maximumSeconds !== policy.cacheSeconds ||
    rights.retention.rawEvidence.maximumDays !== policy.rawRetentionDays
  ) {
    mismatch(
      `The recorded ${capabilityId} source rights differ from the parser, pacing, cache or retention this runner enforces.`
    );
  }
  const egress = rights.conditions.find(
    ({ conditionId }) => conditionId === 'provider-egress-control'
  );
  if (egress === undefined || egress.verificationEvidenceIds.length !== 1) {
    mismatch('The recorded rights must name exactly one provider-egress-control evidence record.');
  }
  return {
    authority: { sourceRights, proposal },
    decisionId: decision.decisionId,
    egressPolicyEvidenceId: egress.verificationEvidenceIds[0]!,
  };
}

export interface LocalDraftguruTradeCaptureTarget {
  capabilityId: DraftguruTradeCapability;
  season: number;
  discoveryFromSeason?: number;
  sourceUrl: string;
}

/** Index: the whole `/trades` page bounded to seasons. Detail: one page per exact trade URL. */
export function createLocalDraftguruTradeCaptureTargets(
  input:
    | { capabilityId: 'draftguru-trade-index'; season: number; fromSeason?: number }
    | { capabilityId: 'draftguru-trade-detail'; urls: readonly string[] }
): LocalDraftguruTradeCaptureTarget[] {
  if (input.capabilityId === 'draftguru-trade-index') {
    return [
      {
        capabilityId: input.capabilityId,
        season: input.season,
        discoveryFromSeason: input.fromSeason ?? input.season,
        sourceUrl: DRAFTGURU_TRADE_INDEX_URL,
      },
    ];
  }
  if (input.urls.length === 0 || new Set(input.urls).size !== input.urls.length) {
    throw new LocalDraftguruTradeCaptureError(
      'INVALID_TARGET',
      'Trade-detail capture requires one or more distinct trade URLs.'
    );
  }
  return input.urls.map((sourceUrl) => {
    let pathname: string;
    try {
      pathname = new URL(sourceUrl).pathname;
    } catch {
      pathname = '';
    }
    const match = /^\/trades\/(\d{4})-[^/]+$/.exec(pathname);
    if (!match) {
      throw new LocalDraftguruTradeCaptureError(
        'INVALID_TARGET',
        `Not a Draftguru trade-detail URL: ${sourceUrl}`
      );
    }
    return { capabilityId: input.capabilityId, season: Number(match[1]), sourceUrl };
  });
}

export type LocalDraftguruTradeCaptureResult = LocalDraftguruTradeCaptureTarget &
  IngestAflTradeExternalPageResult;

export interface LocalDraftguruTradeCaptureOptions {
  sql: AflOutcomeSqlClient;
  artifactRootDirectory: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

function identifiedFetch(fetchImpl: typeof fetch, userAgent: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', userAgent);
    return fetchImpl(input, { ...init, headers });
  };
}

/**
 * Captures Draftguru trade pages on the owner's machine through the governed ingestion boundary:
 * recorded Gate 0A authority, local file-backed provider pacing, local non-production raw custody,
 * and PostgreSQL capture/execution receipts. Targets run sequentially and stop at the first failure.
 */
export async function runLocalDraftguruTradeCapture(
  options: LocalDraftguruTradeCaptureOptions,
  targets: readonly LocalDraftguruTradeCaptureTarget[],
  onResult?: (result: LocalDraftguruTradeCaptureResult) => void
): Promise<LocalDraftguruTradeCaptureResult[]> {
  if (!isAbsolute(options.artifactRootDirectory)) {
    throw new LocalDraftguruTradeCaptureError(
      'INVALID_TARGET',
      'Local Draftguru capture requires one absolute artifact root.'
    );
  }
  if (
    options.userAgent.trim().length < 20 ||
    options.userAgent.length > 500 ||
    !/contact\s*:/i.test(options.userAgent)
  ) {
    throw new LocalDraftguruTradeCaptureError(
      'INVALID_TARGET',
      'Local Draftguru capture requires an identifying user agent with a contact.'
    );
  }
  const capabilities = new Set(targets.map(({ capabilityId }) => capabilityId));
  if (targets.length === 0 || capabilities.size !== 1) {
    throw new LocalDraftguruTradeCaptureError(
      'INVALID_TARGET',
      'One run captures one or more targets of exactly one capability.'
    );
  }
  const capabilityId = targets[0]!.capabilityId;
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const root = resolve(options.artifactRootDirectory);
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(options.sql);
  const recorded = await loadRecordedDraftguruTradeAuthority(ledger, capabilityId, now());
  const rawArtifacts = createLocalAflTradeNonProductionArtifactRepository({
    rootDirectory: root,
    repositoryId: 'draftguru-trade-raw',
    artifactClass: 'raw_source',
    maximumObjectBytes: LOCAL_DRAFTGURU_TRADE_MAXIMUM_BYTES,
  });
  const admission = createAflTradeExternalCaptureAdmission({
    redis: createLocalFileCaptureAdmissionStore({ directory: join(root, 'capture-admission') }),
    createToken: randomUUID,
  });
  const fetchImpl = identifiedFetch(options.fetchImpl ?? fetch, options.userAgent);
  const captureRegistry = new PostgresAflTradeExternalCaptureRegistry(options.sql);
  const staging = new PostgresAflTradeExternalEvidenceRepository(options.sql);
  const executionPolicy = {
    ...LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY,
    egressPolicyEvidenceId: recorded.egressPolicyEvidenceId,
  };

  async function captureOne(target: LocalDraftguruTradeCaptureTarget) {
    for (let attempt = 1; attempt <= MAXIMUM_ADMISSION_ATTEMPTS; attempt += 1) {
      const at = now();
      const gateRequest = createDraftguruTradeGateRequest(recorded.authority, target.season, {
        evaluatedAt: at,
      });
      const { ledger: currentLedger, sourceRights } = await ledger.resolveAuthorization(
        gateRequest.rightsArtifactId
      );
      const evaluation = evaluateAflTradeGate0A(currentLedger, sourceRights, gateRequest);
      if (
        evaluation.status !== 'mechanically_eligible' ||
        evaluation.decisionId !== recorded.decisionId
      ) {
        mismatch(
          `Gate 0A no longer admits ${target.sourceUrl}: ${evaluation.blockers.map(({ code }) => code).join(', ') || 'decision changed'}`
        );
      }
      const command = createDraftguruTradeCaptureCommand(recorded.authority, {
        season: target.season,
        ...(target.discoveryFromSeason === undefined
          ? {}
          : { discoveryFromSeason: target.discoveryFromSeason }),
        sourceUrl: target.sourceUrl,
        capturedAt: at,
        // Draftguru records no transaction instant, so each claim is effective as observed.
        effectiveAt: at,
        maximumBytes: LOCAL_DRAFTGURU_TRADE_MAXIMUM_BYTES,
      });
      const outcome = await ingestAuthorizedAflTradeExternalPage(command, {
        admission,
        policyFor: (provider) => {
          if (provider !== 'draftguru') mismatch('The local runner captures Draftguru only.');
          return executionPolicy;
        },
        resolveAuthorization: (rightsArtifactId) => ledger.resolveAuthorization(rightsArtifactId),
        clock: { now },
        ingestion: {
          rawArtifacts,
          captureRegistry,
          staging,
          capturePage: ({ url, validators, maximumBytes }) =>
            captureDraftguruSource({
              url,
              validators,
              maximumBytes,
              timeoutMs: TIMEOUT_MS,
              fetchImpl,
            }),
          parsePage: ({ html, capture }) =>
            target.capabilityId === 'draftguru-trade-index'
              ? parseDraftguruTradeIndexEvidence(html, {
                  capture,
                  fromYear: target.discoveryFromSeason ?? target.season,
                  throughYear: target.season,
                })
              : parseDraftguruTradeDetail(html, {
                  capture,
                  draftYear: target.season,
                  effectiveAt: command.request.effectiveAt,
                }),
        },
      });
      if (outcome.status === 'completed') return outcome.result;
      const waitMs = Math.max(0, Date.parse(outcome.retryAt) - Date.parse(now())) + 50;
      if (waitMs > executionPolicy.maximumLeaseMs + 10_000) break;
      await sleep(waitMs);
    }
    throw new LocalDraftguruTradeCaptureError(
      'ADMISSION_EXHAUSTED',
      `Provider admission did not admit ${target.sourceUrl}; another capture may hold the lease.`
    );
  }

  const results: LocalDraftguruTradeCaptureResult[] = [];
  for (const target of targets) {
    const result = { ...target, ...(await captureOne(target)) };
    results.push(result);
    onResult?.(result);
  }
  return results;
}
