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
  DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION,
  parseDraftguruNationalYearSelections,
  parseDraftguruTradeDetail,
  parseDraftguruTradeIndexEvidence,
} from '../source/draftguruSourceAdapter';
import { createAflTradeExternalCaptureAdmission } from '../source/externalDraftTradeCaptureAdmission';
import type {
  AflTradeExternalPageIngestionDependencies,
  IngestAflTradeExternalPageResult,
} from '../source/externalDraftTradeIngestion';
import {
  ingestAuthorizedAflTradeExternalPage,
  type AflTradeExternalProviderIngestionCommand,
} from '../source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0A } from '../source/gate0aEvaluation';
import {
  OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
  parseOfficialAflDraftOrderTable,
} from '../source/draftCorroborationAdapter';
import {
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
  parseOfficialAflDraftSession,
} from '../source/officialAflDraftSessionAdapter';
import { captureOfficialAflPage } from '../source/officialAflPageCapture';
import { PostgresAflTradeExternalCaptureRegistry } from '../source/postgresExternalCaptureRegistry';
import { PostgresAflTradeExternalEvidenceRepository } from '../source/postgresExternalEvidenceRepository';
import {
  DRAFTGURU_TRADE_PARSER_VERSIONS,
  type DraftguruTradeCapability,
} from './localDraftguruTradeAuthorityProposal';
import {
  createDraftguruTradeCaptureCommand,
  type DraftguruTradeAuthority,
} from './localDraftguruTradeCaptureCommand';
import {
  createDraftguruNationalYearCaptureCommand,
  DRAFTGURU_NATIONAL_YEAR_CAPABILITY,
  DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION,
  draftguruNationalYearDecisionKey,
  type LocalDraftguruNationalYearTarget,
} from './localDraftguruNationalYearCapture';
import { createLocalFileCaptureAdmissionStore } from './localFileCaptureAdmissionStore';
import { createLocalAflTradeNonProductionArtifactRepository } from './localFileConditionalObjectStore';
import { bindLocalAflTradeArtifactRepository } from './localArtifactStoreBinding';
import {
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';
import {
  createOfficialAflDraftSessionCaptureCommand,
  OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY,
  officialAflDraftSessionDecisionKey,
  type LocalOfficialAflDraftSessionTarget,
} from './localOfficialAflDraftSessionCapture';
import {
  createOfficialAflDraftOrderCaptureCommand,
  OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY,
  officialAflDraftOrderDecisionKey,
  type LocalOfficialAflDraftOrderTarget,
} from './localOfficialAflDraftOrderCapture';

export { LocalExternalCaptureError } from './localNarrowCaptureAuthority';

type ParsePageInput = Parameters<
  NonNullable<AflTradeExternalPageIngestionDependencies['parsePage']>
>[0];

/**
 * The exact pacing, cache and retention the owner's narrow decisions record for each provider. The
 * runner enforces these itself and refuses a recorded authority that says anything else, rather than
 * adapting.
 */
export const LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY = {
  upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
  cacheSeconds: 86_400,
  maximumLeaseMs: 120_000,
  rawRetentionDays: 365,
} as const;

/** The national-year rights record a one-hour cache, unlike the one-day trade-page cache. */
export const LOCAL_DRAFTGURU_NATIONAL_YEAR_CAPTURE_POLICY = {
  upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
  cacheSeconds: 3_600,
  maximumLeaseMs: 120_000,
  rawRetentionDays: 365,
} as const;

export const LOCAL_OFFICIAL_AFL_SESSION_CAPTURE_POLICY = {
  upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
  cacheSeconds: 3_600,
  maximumLeaseMs: 120_000,
  rawRetentionDays: 365,
} as const;

export const LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MAXIMUM_ADMISSION_ATTEMPTS = 5;
const DRAFTGURU_TRADE_INDEX_URL = 'https://www.draftguru.com.au/trades';

export type LocalExternalCaptureCapability =
  | DraftguruTradeCapability
  | typeof DRAFTGURU_NATIONAL_YEAR_CAPABILITY
  | typeof OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY
  | typeof OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY;

type CapturePolicy =
  | typeof LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY
  | typeof LOCAL_DRAFTGURU_NATIONAL_YEAR_CAPTURE_POLICY
  | typeof LOCAL_OFFICIAL_AFL_SESSION_CAPTURE_POLICY;

/** What the runner requires of each capability's recorded authority, and where it keeps raw bytes. */
const CAPABILITY_PROFILES: Record<
  LocalExternalCaptureCapability,
  {
    provider: 'draftguru' | 'official_afl';
    parserVersion: string;
    policy: CapturePolicy;
    rawRepositoryId: string;
    decisionKey(season: number): string;
  }
> = {
  'draftguru-trade-index': {
    provider: 'draftguru',
    parserVersion: DRAFTGURU_TRADE_PARSER_VERSIONS['draftguru-trade-index'],
    policy: LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY,
    rawRepositoryId: 'draftguru-trade-raw',
    decisionKey: () => draftguruTradeDecisionKey('draftguru-trade-index'),
  },
  'draftguru-trade-detail': {
    provider: 'draftguru',
    // v2 adds each received pick's stated outcome; it has its own recorded decision.
    parserVersion: DRAFTGURU_TRADE_DISPOSITION_PARSER_VERSION,
    policy: LOCAL_DRAFTGURU_TRADE_CAPTURE_POLICY,
    rawRepositoryId: 'draftguru-trade-raw',
    decisionKey: () =>
      `${draftguruTradeDecisionKey('draftguru-trade-detail')}-${DRAFTGURU_TRADE_DISPOSITION_DECISION_SUFFIX}`,
  },
  [DRAFTGURU_NATIONAL_YEAR_CAPABILITY]: {
    provider: 'draftguru',
    parserVersion: DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION,
    policy: LOCAL_DRAFTGURU_NATIONAL_YEAR_CAPTURE_POLICY,
    rawRepositoryId: 'draftguru-national-raw',
    decisionKey: draftguruNationalYearDecisionKey,
  },
  [OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY]: {
    provider: 'official_afl',
    parserVersion: OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
    policy: LOCAL_OFFICIAL_AFL_SESSION_CAPTURE_POLICY,
    rawRepositoryId: 'official-afl-session-raw',
    decisionKey: officialAflDraftSessionDecisionKey,
  },
  [OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY]: {
    provider: 'official_afl',
    parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
    policy: LOCAL_OFFICIAL_AFL_SESSION_CAPTURE_POLICY,
    rawRepositoryId: 'official-afl-order-raw',
    decisionKey: officialAflDraftOrderDecisionKey,
  },
};

export function isLocalExternalCaptureCapability(
  value: string | undefined
): value is LocalExternalCaptureCapability {
  return value !== undefined && Object.hasOwn(CAPABILITY_PROFILES, value);
}

/** Suffix of the trade-detail decision key that authorises `draftguru-trade-parser/v2`. */
export const DRAFTGURU_TRADE_DISPOSITION_DECISION_SUFFIX = 'parser-v2';

export function draftguruTradeDecisionKey(capabilityId: DraftguruTradeCapability): string {
  return `${capabilityId}-issue-579-private-non_production`;
}

export interface RecordedLocalCaptureAuthority {
  authority: LocalNarrowCaptureAuthority;
  decisionId: string;
  egressPolicyEvidenceId: string;
}

function mismatch(message: string): never {
  throw new LocalExternalCaptureError('AUTHORITY_MISMATCH', message);
}

/**
 * Loads the owner's recorded narrow decision for one capability and season, its proposal and its
 * source rights from the Gate ledger, and checks that they describe exactly the provider, parser
 * and pacing this runner enforces.
 */
export async function loadRecordedLocalCaptureAuthority(
  ledger: Pick<AflTradeGateDecisionLedgerRepository, 'load' | 'resolveAuthorization'>,
  capabilityId: LocalExternalCaptureCapability,
  season: number,
  evaluatedAt: string
): Promise<RecordedLocalCaptureAuthority> {
  const profile = CAPABILITY_PROFILES[capabilityId];
  const decisionKey = profile.decisionKey(season);
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
  const policy = profile.policy;
  const rate = rights.automatedAccess.rateLimit;
  if (
    sourceRights.rightsArtifactId !== rightsIds[0] ||
    rights.provider !== profile.provider ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== capabilityId ||
    rights.acquisition.clientVersion !== profile.parserVersion ||
    rights.scope.seasonRanges.length !== 1 ||
    rate === null ||
    rate.requests !== policy.upstreamRate.requests ||
    rate.perSeconds !== policy.upstreamRate.perSeconds ||
    rate.burst !== policy.upstreamRate.burst ||
    rights.automatedAccess.cache.maximumSeconds !== policy.cacheSeconds ||
    rights.retention.rawEvidence.maximumDays !== policy.rawRetentionDays
  ) {
    mismatch(
      `The recorded ${decisionKey} source rights differ from the provider, parser ${profile.parserVersion}, pacing, cache or retention this runner enforces.`
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

export type LocalExternalCaptureTarget =
  | LocalDraftguruTradeCaptureTarget
  | LocalDraftguruNationalYearTarget
  | LocalOfficialAflDraftSessionTarget
  | LocalOfficialAflDraftOrderTarget;

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
    throw new LocalExternalCaptureError(
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
      throw new LocalExternalCaptureError(
        'INVALID_TARGET',
        `Not a Draftguru trade-detail URL: ${sourceUrl}`
      );
    }
    return { capabilityId: input.capabilityId, season: Number(match[1]), sourceUrl };
  });
}

export type LocalExternalCaptureResult = LocalExternalCaptureTarget &
  IngestAflTradeExternalPageResult;

export interface LocalExternalCaptureOptions {
  sql: AflOutcomeSqlClient;
  artifactRootDirectory: string;
  /**
   * The registered local store to write raw pages into. Its root must be `artifactRootDirectory`;
   * each page's custody row then records its location. Without it pages are written unlocated.
   */
  storeId?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

/** A raw-page repository in the registered store, which must be rooted at the capture root. */
async function bindStoreRepository(
  sql: AflOutcomeSqlClient,
  storeId: string,
  root: string,
  repositoryId: string
) {
  const store = await sql.query<{ root_locator: string }>(
    `SELECT root_locator FROM outcome_artifact_store WHERE store_id=$1`,
    [storeId]
  );
  if (store.rows[0] === undefined || resolve(store.rows[0].root_locator) !== root) {
    throw new TypeError(
      `Artifact store ${storeId} must be registered with root ${root} to capture into it.`
    );
  }
  return bindLocalAflTradeArtifactRepository(sql, {
    storeId,
    repositoryId,
    artifactClass: 'raw_source',
    maximumObjectBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
  });
}

function identifiedFetch(fetchImpl: typeof fetch, userAgent: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', userAgent);
    return fetchImpl(input, { ...init, headers });
  };
}

function createCommand(
  recorded: RecordedLocalCaptureAuthority,
  target: LocalExternalCaptureTarget,
  capturedAt: string
): AflTradeExternalProviderIngestionCommand {
  if (target.capabilityId === OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY) {
    return createOfficialAflDraftOrderCaptureCommand(recorded.authority, {
      target,
      capturedAt,
      maximumBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
    });
  }
  if (target.capabilityId === OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY) {
    return createOfficialAflDraftSessionCaptureCommand(recorded.authority, {
      target,
      capturedAt,
      maximumBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
    });
  }
  if (target.capabilityId === DRAFTGURU_NATIONAL_YEAR_CAPABILITY) {
    return createDraftguruNationalYearCaptureCommand(recorded.authority, {
      target,
      capturedAt,
      maximumBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
    });
  }
  return createDraftguruTradeCaptureCommand(recorded.authority as DraftguruTradeAuthority, {
    season: target.season,
    ...(target.discoveryFromSeason === undefined
      ? {}
      : { discoveryFromSeason: target.discoveryFromSeason }),
    sourceUrl: target.sourceUrl,
    capturedAt,
    // Draftguru records no transaction instant, so each claim is effective as observed.
    effectiveAt: capturedAt,
    maximumBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
  });
}

function parsePage(
  target: LocalExternalCaptureTarget,
  command: AflTradeExternalProviderIngestionCommand,
  { html, capture }: ParsePageInput
) {
  switch (target.capabilityId) {
    case 'draftguru-trade-index':
      return parseDraftguruTradeIndexEvidence(html, {
        capture,
        fromYear: target.discoveryFromSeason ?? target.season,
        throughYear: target.season,
      });
    case 'draftguru-trade-detail':
      return parseDraftguruTradeDetail(html, {
        capture,
        draftYear: target.season,
        effectiveAt: command.request.effectiveAt,
      });
    case DRAFTGURU_NATIONAL_YEAR_CAPABILITY:
      return parseDraftguruNationalYearSelections(html, { capture, draftYear: target.season });
    case OFFICIAL_AFL_DRAFT_SESSION_CAPABILITY:
      return parseOfficialAflDraftSession(html, { capture, anchorSeasonYear: target.season });
    case OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY:
      return parseOfficialAflDraftOrderTable(html, {
        capture,
        draftYear: target.season,
        observedAt: command.request.effectiveAt,
      });
  }
}

/**
 * Captures reviewed provider pages on the owner's machine through the governed ingestion boundary:
 * recorded Gate 0A authority, local file-backed provider pacing, local non-production raw custody,
 * and PostgreSQL capture/execution receipts. Targets run sequentially and stop at the first failure.
 */
export async function runLocalExternalCapture(
  options: LocalExternalCaptureOptions,
  targets: readonly LocalExternalCaptureTarget[],
  onResult?: (result: LocalExternalCaptureResult) => void
): Promise<LocalExternalCaptureResult[]> {
  if (!isAbsolute(options.artifactRootDirectory)) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Local capture requires one absolute artifact root.'
    );
  }
  if (
    options.userAgent.trim().length < 20 ||
    options.userAgent.length > 500 ||
    !/contact\s*:/i.test(options.userAgent)
  ) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Local capture requires an identifying user agent with a contact.'
    );
  }
  const capabilities = new Set(targets.map(({ capabilityId }) => capabilityId));
  if (targets.length === 0 || capabilities.size !== 1) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'One run captures one or more targets of exactly one capability.'
    );
  }
  const capabilityId = targets[0]!.capabilityId;
  const profile = CAPABILITY_PROFILES[capabilityId];
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const root = resolve(options.artifactRootDirectory);
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(options.sql);
  // Every target's decision must be recorded before any page is fetched.
  const recordedBySeason = new Map<number, RecordedLocalCaptureAuthority>();
  for (const season of new Set(targets.map((target) => target.season))) {
    recordedBySeason.set(
      season,
      await loadRecordedLocalCaptureAuthority(ledger, capabilityId, season, now())
    );
  }
  const rawArtifacts =
    options.storeId === undefined
      ? createLocalAflTradeNonProductionArtifactRepository({
          rootDirectory: root,
          repositoryId: profile.rawRepositoryId,
          artifactClass: 'raw_source',
          maximumObjectBytes: LOCAL_EXTERNAL_CAPTURE_MAXIMUM_BYTES,
        })
      : await bindStoreRepository(options.sql, options.storeId, root, profile.rawRepositoryId);
  const admission = createAflTradeExternalCaptureAdmission({
    redis: createLocalFileCaptureAdmissionStore({ directory: join(root, 'capture-admission') }),
    createToken: randomUUID,
  });
  const fetchImpl = identifiedFetch(options.fetchImpl ?? fetch, options.userAgent);
  const captureRegistry = new PostgresAflTradeExternalCaptureRegistry(
    options.sql,
    rawArtifacts.storeLocation === undefined ? {} : { storeLocation: rawArtifacts.storeLocation }
  );
  const staging = new PostgresAflTradeExternalEvidenceRepository(options.sql);

  async function captureOne(target: LocalExternalCaptureTarget) {
    const recorded = recordedBySeason.get(target.season)!;
    const executionPolicy = {
      ...profile.policy,
      egressPolicyEvidenceId: recorded.egressPolicyEvidenceId,
    };
    for (let attempt = 1; attempt <= MAXIMUM_ADMISSION_ATTEMPTS; attempt += 1) {
      const at = now();
      const command = createCommand(recorded, target, at);
      const { ledger: currentLedger, sourceRights } = await ledger.resolveAuthorization(
        command.gateRequest.rightsArtifactId
      );
      const evaluation = evaluateAflTradeGate0A(currentLedger, sourceRights, command.gateRequest);
      if (
        evaluation.status !== 'mechanically_eligible' ||
        evaluation.decisionId !== recorded.decisionId
      ) {
        mismatch(
          `Gate 0A no longer admits ${target.sourceUrl}: ${evaluation.blockers.map(({ code }) => code).join(', ') || 'decision changed'}`
        );
      }
      const outcome = await ingestAuthorizedAflTradeExternalPage(command, {
        admission,
        policyFor: (provider) => {
          if (provider !== profile.provider) {
            mismatch(`The ${capabilityId} capture is limited to ${profile.provider}.`);
          }
          return executionPolicy;
        },
        resolveAuthorization: (rightsArtifactId) => ledger.resolveAuthorization(rightsArtifactId),
        clock: { now },
        ingestion: {
          rawArtifacts,
          captureRegistry,
          staging,
          capturePage: ({ url, validators, maximumBytes }) =>
            (profile.provider === 'draftguru' ? captureDraftguruSource : captureOfficialAflPage)({
              url,
              validators,
              maximumBytes,
              timeoutMs: TIMEOUT_MS,
              fetchImpl,
            }),
          parsePage: (input) => parsePage(target, command, input),
        },
      });
      if (outcome.status === 'completed') return outcome.result;
      const waitMs = Math.max(0, Date.parse(outcome.retryAt) - Date.parse(now())) + 50;
      // A lease or provider cooldown never outlasts one lease; a longer deferral is the reviewed
      // per-request cache period, which the runner reports instead of waiting out or refetching.
      if (waitMs > executionPolicy.maximumLeaseMs + 10_000) {
        throw new LocalExternalCaptureError(
          'REQUEST_COOLDOWN',
          `${target.sourceUrl} was captured within the reviewed ${executionPolicy.cacheSeconds}-second cache period; retry after ${outcome.retryAt}.`
        );
      }
      await sleep(waitMs);
    }
    throw new LocalExternalCaptureError(
      'ADMISSION_EXHAUSTED',
      `Provider admission did not admit ${target.sourceUrl}; another capture may hold the lease.`
    );
  }

  const results: LocalExternalCaptureResult[] = [];
  for (const target of targets) {
    const result = { ...target, ...(await captureOne(target)) };
    results.push(result);
    onResult?.(result);
  }
  return results;
}
