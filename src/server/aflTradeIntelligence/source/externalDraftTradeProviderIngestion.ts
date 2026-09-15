import {
  reviewedOfficialAflPlayerContinuity,
  OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION,
} from './officialAflPlayerContinuityFacts';
import {
  reviewedOfficialAflPlayerDeparture,
  OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION,
} from './officialAflPlayerDepartureFacts';
import { reviewedOfficialAflCompensationArticle } from './officialAflCompensationArticleFacts';
import {
  reviewedOfficialAflCompensationPdf,
  OFFICIAL_AFL_COMPENSATION_PARSER_VERSION,
} from './officialAflCompensationPdfFacts';
import { reviewedOfficialAflDraft2010Source } from './officialAflDraft2010SourceScope';
import { OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION } from './officialAflDraftSessionAdapter';
import { reviewedOfficialAflMiniDraft2012EffectiveYear } from './officialAflMiniDraft2012SessionFacts';
import { reviewedOfficialAflMiniDraft2011EffectiveYear } from './officialAflMiniDraft2011SessionFacts';
import { reviewedOfficialAflDraft2011EffectiveYear } from './officialAflDraft2011SessionFacts';
import { reviewedOfficialAflDraft2012EffectiveYear } from './officialAflDraft2012SessionFacts';
import { reviewedOfficialAflDraft2014EffectiveYear } from './officialAflDraft2014SessionFacts';
import { reviewedOfficialAflDraft2013EffectiveYear } from './officialAflDraft2013SessionFacts';
import {
  isReviewedOfficialIssuingAwardUrl,
  OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION,
} from './officialAflIssuingAwardAdapter';
import { DRAFTGURU_YEAR_PARSER_VERSION } from './draftguruEventYear';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflTradeResolvedGateAuthorization } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflTradeGate0ARequest } from './gate0aEvaluation';
import { evaluateAflTradeGate0A } from './gate0aEvaluation';
import { createAflTradeGate0AReceipt } from './gate0aReceipt';
import { isReviewedOfficialAflDraftSessionUrl } from './officialAflDraftSessionAdapter';
import { reviewedOfficialAflDraft2016EffectiveYear } from './officialAflDraft2016SessionFacts';
import type {
  AflTradeExternalCaptureAdmission,
  AflTradeExternalCaptureAdmissionPolicy,
  AflTradeExternalCaptureProvider,
} from './externalDraftTradeCaptureAdmission';
import {
  createAflTradeExternalCaptureExecutionReceipt,
  ingestAflTradeExternalPage,
  type AflTradeExternalPageIngestionDependencies,
  type IngestAflTradeExternalPageRequest,
  type IngestAflTradeExternalPageResult,
} from './externalDraftTradeIngestion';

export interface AflTradeExternalProviderIngestionCommand {
  request: IngestAflTradeExternalPageRequest;
  gateRequest: AflTradeGate0ARequest;
}

export type AflTradeExternalProviderIngestionResult =
  | { status: 'deferred'; retryAt: string }
  | { status: 'completed'; result: IngestAflTradeExternalPageResult };

export interface AflTradeExternalProviderIngestionDependencies {
  admission: AflTradeExternalCaptureAdmission;
  policyFor(
    provider: AflTradeExternalCaptureProvider
  ): AflTradeExternalCaptureAdmissionPolicy & { rawRetentionDays: number };
  resolveAuthorization(rightsArtifactId: string): Promise<AflTradeResolvedGateAuthorization>;
  ingestion: Omit<AflTradeExternalPageIngestionDependencies, 'authorizeCapture'>;
  clock: { now(): string };
}

export class AflTradeExternalProviderIngestionError extends Error {
  constructor(
    readonly code: 'INVALID_SCOPE' | 'SOURCE_NOT_AUTHORIZED',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalProviderIngestionError';
  }
}

const footywirePathwayCode = {
  national: 'N',
  rookie: 'R',
  pre_season: 'P',
  mid_season: 'M',
} as const;

export function validateAflTradeExternalCaptureScope(
  request: IngestAflTradeExternalPageRequest
): void {
  const url = new URL(request.sourceUrl);
  const invalid = () => {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      'External capability, provider, season, pathway and source URL do not exactly match.'
    );
  };
  if (request.capabilityId === 'draftguru-trade-index') {
    if (
      request.provider !== 'draftguru' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear === null ||
      request.discoveryFromSeasonYear === undefined ||
      request.discoveryFromSeasonYear > request.anchorSeasonYear ||
      request.anchorSeasonYear - request.discoveryFromSeasonYear > 100 ||
      url.hostname !== 'www.draftguru.com.au' ||
      !['/trades', '/trades/'].includes(url.pathname) ||
      url.search ||
      url.hash
    )
      invalid();
    return;
  }
  if (
    request.capabilityId === 'draftguru-trade-detail' ||
    request.capabilityId === 'draftguru-player-trade-detail'
  ) {
    if (
      request.provider !== 'draftguru' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear != null ||
      url.hostname !== 'www.draftguru.com.au' ||
      !new RegExp(`^/trades/${request.anchorSeasonYear}-[a-z0-9_-]+$`).test(url.pathname) ||
      url.search ||
      url.hash
    )
      invalid();
    return;
  }
  if (
    request.capabilityId === 'draftguru-year-page' ||
    request.capabilityId === 'draftguru-national-year-page'
  ) {
    if (
      request.provider !== 'draftguru' ||
      request.draftPathway !==
        (request.capabilityId === 'draftguru-national-year-page' ? 'national' : null) ||
      request.discoveryFromSeasonYear != null ||
      url.hostname !== 'www.draftguru.com.au' ||
      url.pathname !== `/years/${request.anchorSeasonYear}` ||
      url.search ||
      url.hash
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'footywire-draft-results') {
    if (
      request.provider !== 'footywire' ||
      request.draftPathway === null ||
      request.draftPathway === 'mini_draft' ||
      request.discoveryFromSeasonYear != null ||
      url.hostname !== 'www.footywire.com' ||
      url.pathname !== '/afl/footy/ft_drafts' ||
      url.searchParams.get('year') !== String(request.anchorSeasonYear) ||
      url.searchParams.get('t') !== footywirePathwayCode[request.draftPathway] ||
      [...url.searchParams.keys()].some((key) => !['year', 't'].includes(key)) ||
      url.hash
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-indicative-draft-order') {
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !== 'national' ||
      request.discoveryFromSeasonYear != null ||
      url.hostname !== 'www.afl.com.au' ||
      !/^\/news\/\d+\/[a-z0-9-]+(?:\/amp)?$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      new Date(request.effectiveAt).getUTCFullYear() !== request.anchorSeasonYear
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-player-continuity') {
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear != null ||
      request.parserVersion !== OFFICIAL_AFL_PLAYER_CONTINUITY_PARSER_VERSION ||
      !reviewedOfficialAflPlayerContinuity(request.sourceUrl, request.anchorSeasonYear) ||
      !Number.isFinite(Date.parse(request.effectiveAt)) ||
      new Date(request.effectiveAt).getUTCFullYear() < request.anchorSeasonYear
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-player-departure') {
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear != null ||
      request.parserVersion !== OFFICIAL_AFL_PLAYER_DEPARTURE_PARSER_VERSION ||
      !reviewedOfficialAflPlayerDeparture(request.sourceUrl, request.anchorSeasonYear) ||
      !Number.isFinite(Date.parse(request.effectiveAt)) ||
      new Date(request.effectiveAt).getUTCFullYear() < request.anchorSeasonYear
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-compensation-lifecycle') {
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear != null ||
      request.parserVersion !== OFFICIAL_AFL_COMPENSATION_PARSER_VERSION ||
      !(
        reviewedOfficialAflCompensationArticle(request.sourceUrl, request.anchorSeasonYear) ||
        reviewedOfficialAflCompensationPdf(request.sourceUrl, request.anchorSeasonYear)
      ) ||
      !Number.isFinite(Date.parse(request.effectiveAt)) ||
      new Date(request.effectiveAt).getUTCFullYear() < request.anchorSeasonYear
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-issuing-award') {
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !== null ||
      request.discoveryFromSeasonYear != null ||
      request.parserVersion !== OFFICIAL_AFL_ISSUING_AWARD_PARSER_VERSION ||
      !isReviewedOfficialIssuingAwardUrl(request.sourceUrl, request.anchorSeasonYear) ||
      !Number.isFinite(Date.parse(request.effectiveAt)) ||
      new Date(request.effectiveAt).getUTCFullYear() < request.anchorSeasonYear
    )
      invalid();
    return;
  }
  if (request.capabilityId === 'official-afl-completed-draft-session') {
    const reviewed2010 = reviewedOfficialAflDraft2010Source(request.sourceUrl);
    if (reviewed2010) {
      const expectedTime = reviewed2010.effectiveAt ?? request.capturedAt;
      if (
        request.provider !== 'official_afl' ||
        request.anchorSeasonYear !== 2010 ||
        request.draftPathway !== 'national' ||
        request.discoveryFromSeasonYear != null ||
        request.parserVersion !== OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION ||
        !Number.isFinite(Date.parse(expectedTime)) ||
        Date.parse(request.effectiveAt) !== Date.parse(expectedTime)
      )
        invalid();
      return;
    }

    const reviewedMini2012EffectiveYear =
      request.anchorSeasonYear === 2012
        ? reviewedOfficialAflMiniDraft2012EffectiveYear(request.sourceUrl)
        : null;
    const reviewedMini2011EffectiveYear =
      request.anchorSeasonYear === 2011
        ? reviewedOfficialAflMiniDraft2011EffectiveYear(request.sourceUrl)
        : null;
    const reviewed2011EffectiveYear =
      request.anchorSeasonYear === 2011
        ? reviewedOfficialAflDraft2011EffectiveYear(request.sourceUrl)
        : null;
    const reviewed2012EffectiveYear =
      request.anchorSeasonYear === 2012
        ? reviewedOfficialAflDraft2012EffectiveYear(request.sourceUrl)
        : null;
    const reviewed2014EffectiveYear =
      request.anchorSeasonYear === 2014
        ? reviewedOfficialAflDraft2014EffectiveYear(request.sourceUrl)
        : null;
    const reviewed2013EffectiveYear =
      request.anchorSeasonYear === 2013
        ? reviewedOfficialAflDraft2013EffectiveYear(request.sourceUrl)
        : null;
    const reviewed2016EffectiveYear =
      request.anchorSeasonYear === 2016
        ? reviewedOfficialAflDraft2016EffectiveYear(request.sourceUrl)
        : null;
    if (
      request.provider !== 'official_afl' ||
      request.draftPathway !==
        (reviewedMini2011EffectiveYear !== null || reviewedMini2012EffectiveYear !== null
          ? 'mini_draft'
          : 'national') ||
      request.discoveryFromSeasonYear != null ||
      request.parserVersion !== OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION ||
      !isReviewedOfficialAflDraftSessionUrl(request.sourceUrl, request.anchorSeasonYear) ||
      new Date(request.effectiveAt).getUTCFullYear() !==
        (reviewedMini2012EffectiveYear ??
          reviewedMini2011EffectiveYear ??
          reviewed2011EffectiveYear ??
          reviewed2012EffectiveYear ??
          reviewed2014EffectiveYear ??
          reviewed2013EffectiveYear ??
          reviewed2016EffectiveYear ??
          request.anchorSeasonYear)
    )
      invalid();
    return;
  }
  invalid();
}

function requireExactScope(
  request: IngestAflTradeExternalPageRequest,
  gateRequest: AflTradeGate0ARequest,
  authorization: AflTradeResolvedGateAuthorization,
  executionPolicy: AflTradeExternalCaptureAdmissionPolicy & { rawRetentionDays: number },
  evaluatedAt: string
) {
  const rights = authorization.sourceRights.content;
  const effectiveGateRequest = { ...gateRequest, evaluatedAt };
  const reviewedRate = rights.automatedAccess.rateLimit;
  const reviewedCacheSeconds = rights.automatedAccess.cache.maximumSeconds;
  const reviewedRawDays = rights.retention.rawEvidence.maximumDays;
  const egressCondition = rights.conditions.find(
    ({ conditionId }) => conditionId === 'provider-egress-control'
  );
  if (
    gateRequest.environment !== request.environment ||
    gateRequest.competition !== request.competition ||
    gateRequest.season !== request.anchorSeasonYear ||
    gateRequest.accessMechanism !== request.accessMechanism ||
    gateRequest.capabilityId !== null ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== request.capabilityId ||
    rights.provider !== request.provider ||
    rights.dataset !== request.dataset ||
    rights.datasetVersion !== request.datasetVersion ||
    rights.acquisition.clientVersion !== request.parserVersion ||
    request.fieldManifestSha256 !== sha256AflTradeCanonicalJson(rights.fields) ||
    reviewedRate === null ||
    reviewedRate.requests !== executionPolicy.upstreamRate.requests ||
    reviewedRate.perSeconds !== executionPolicy.upstreamRate.perSeconds ||
    reviewedRate.burst !== executionPolicy.upstreamRate.burst ||
    reviewedCacheSeconds !== executionPolicy.cacheSeconds ||
    gateRequest.cacheSeconds !== executionPolicy.cacheSeconds ||
    reviewedRawDays !== executionPolicy.rawRetentionDays ||
    gateRequest.rawRetentionDays !== executionPolicy.rawRetentionDays ||
    egressCondition === undefined ||
    !egressCondition.verificationEvidenceIds.includes(executionPolicy.egressPolicyEvidenceId) ||
    !gateRequest.operations.includes('bounded_evaluation_capture') ||
    !gateRequest.operations.includes('raw_evidence_retention')
  ) {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      'External capture, Gate request, and durable source-rights scope do not exactly match.'
    );
  }
  const evaluation = evaluateAflTradeGate0A(
    authorization.ledger,
    authorization.sourceRights,
    effectiveGateRequest
  );
  if (evaluation.status !== 'mechanically_eligible') {
    throw new AflTradeExternalProviderIngestionError(
      'SOURCE_NOT_AUTHORIZED',
      `External capture is blocked by current Gate 0A authority: ${evaluation.blockers
        .map(({ code }) => code)
        .join(', ')}`
    );
  }
  if (evaluation.decisionId === null) {
    throw new AflTradeExternalProviderIngestionError(
      'SOURCE_NOT_AUTHORIZED',
      'External capture has no effective Gate 0A decision.'
    );
  }
  if (request.provider === 'fitzroy_official_afl_player_details') {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      'fitzRoy player details cannot produce an external web-capture receipt.'
    );
  }
  return {
    sourceRights: authorization.sourceRights,
    gate0aReceipt: createAflTradeGate0AReceipt(
      authorization.ledger,
      authorization.sourceRights,
      effectiveGateRequest,
      evaluatedAt
    ),
    ledgerRevision: authorization.revision,
    executionPolicy,
  };
}

async function authorize(
  command: AflTradeExternalProviderIngestionCommand,
  dependencies: AflTradeExternalProviderIngestionDependencies,
  evaluatedAt: string
) {
  if (
    command.request.provider === 'statly_local_fixture' ||
    command.request.provider === 'fitzroy_official_afl_player_details'
  ) {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      'Fixture and fitzRoy player-detail evidence cannot use the external web-capture boundary.'
    );
  }
  const authorization = await dependencies.resolveAuthorization(
    command.gateRequest.rightsArtifactId
  );
  return requireExactScope(
    command.request,
    command.gateRequest,
    authorization,
    dependencies.policyFor(command.request.provider),
    evaluatedAt
  );
}

export async function ingestAuthorizedAflTradeExternalPage(
  command: AflTradeExternalProviderIngestionCommand,
  dependencies: AflTradeExternalProviderIngestionDependencies
): Promise<AflTradeExternalProviderIngestionResult> {
  const provider = command.request.provider;
  if (provider === 'statly_local_fixture' || provider === 'fitzroy_official_afl_player_details') {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      'Fixture and fitzRoy player-detail evidence must use their non-web ingestion boundaries.'
    );
  }
  validateAflTradeExternalCaptureScope(command.request);
  if (
    command.request.capabilityId === 'draftguru-year-page' &&
    command.request.parserVersion !== DRAFTGURU_YEAR_PARSER_VERSION
  ) {
    throw new AflTradeExternalProviderIngestionError(
      'INVALID_SCOPE',
      `General Draftguru year parser version must be ${DRAFTGURU_YEAR_PARSER_VERSION}; create a new approved schedule and run.`
    );
  }
  await authorize(command, dependencies, dependencies.clock.now());
  const executionPolicy = dependencies.policyFor(provider);
  const requestSha256 = sha256AflTradeCanonicalJson(command.request);
  const admitted = await dependencies.admission.acquire({
    provider,
    capabilityId: command.request.capabilityId,
    requestSha256,
    policy: executionPolicy,
    nowMs: Date.parse(dependencies.clock.now()),
  });
  if (admitted.status === 'deferred') {
    return { status: 'deferred', retryAt: new Date(admitted.retryAtMs).toISOString() };
  }
  const startedAt = dependencies.clock.now();
  let outcome: 'succeeded' | 'failed' = 'failed';
  try {
    const result = await ingestAflTradeExternalPage(command.request, {
      ...dependencies.ingestion,
      authorizeCapture: async (request, observation) => {
        if (sha256AflTradeCanonicalJson(request) !== requestSha256) {
          throw new AflTradeExternalProviderIngestionError(
            'INVALID_SCOPE',
            'The staged capture request changed after distributed admission.'
          );
        }
        const completedAt = dependencies.clock.now();
        const exactAuthorization = await authorize(command, dependencies, completedAt);
        const leaseTokenSha256 = sha256AflTradeCanonicalJson({ token: admitted.lease.token });
        const leaseExpiresAt = new Date(admitted.lease.expiresAtMs).toISOString();
        const leaseId = createAflTradeContentAddress('external-capture-lease', {
          provider: admitted.lease.provider,
          capabilityId: admitted.lease.capabilityId,
          requestSha256,
          leaseTokenSha256,
          leaseExpiresAt,
        });
        return createAflTradeExternalCaptureExecutionReceipt({
          schemaVersion: 'afl-trade-external-capture-execution/v2',
          sourceRights: exactAuthorization.sourceRights,
          gate0aReceipt: exactAuthorization.gate0aReceipt,
          ledgerRevision: exactAuthorization.ledgerRevision,
          request: { ...request, provider },
          requestSha256,
          admission: {
            leaseId,
            leaseTokenSha256,
            leaseExpiresAt,
            startedAt,
            upstreamRate: exactAuthorization.executionPolicy.upstreamRate,
            cacheSeconds: exactAuthorization.executionPolicy.cacheSeconds,
            rawRetentionDays: exactAuthorization.executionPolicy.rawRetentionDays,
            egressPolicyEvidenceId: exactAuthorization.executionPolicy.egressPolicyEvidenceId,
          },
          outcome: {
            status: observation.capture.status,
            completedAt,
            sourceUrl: observation.capture.sourceUrl,
            contentSha256:
              observation.capture.status === 'captured' ? observation.capture.contentSha256 : null,
            observedArtifactId:
              observation.capture.status === 'captured'
                ? `artifact:${observation.capture.contentSha256}`
                : observation.validators!.priorArtifactId,
            priorCaptureId: observation.validators?.priorCaptureId ?? null,
            eTag: observation.capture.eTag,
            lastModified: observation.capture.lastModified,
          },
        });
      },
    });
    outcome = 'succeeded';
    return { status: 'completed', result };
  } finally {
    await dependencies.admission.complete(admitted.lease, {
      outcome,
      completedAtMs: Date.parse(dependencies.clock.now()),
    });
  }
}
