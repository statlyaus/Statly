import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import type { AflTradeGate0ARequest } from '../source/gate0aEvaluation';
import {
  DRAFTGURU_TRADE_PARSER_VERSIONS,
  DRAFTGURU_TRADE_PERMITTED_OPERATIONS,
  type createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from './localDraftguruTradeAuthorityProposal';

export type DraftguruTradeAuthority = ReturnType<typeof createDraftguruTradeAuthorityProposal>;

function capabilityOf(authority: DraftguruTradeAuthority): DraftguruTradeCapability {
  const acquisition = authority.sourceRights.content.acquisition;
  const capabilityId = acquisition.kind === 'provider_web' ? acquisition.capabilityId : null;
  if (capabilityId !== 'draftguru-trade-index' && capabilityId !== 'draftguru-trade-detail') {
    throw new TypeError('The authority is not a Draftguru trade capability.');
  }
  return capabilityId;
}

/**
 * Requests exactly what the narrow trade authority permits: the four internal operations and archive
 * use of each reviewed field. The broader local helper also requests training and derived-feature
 * uses, which this authority blocks, so its requests can never pass the narrow decision.
 */
export function createDraftguruTradeGateRequest(
  authority: DraftguruTradeAuthority,
  season: number,
  input: Readonly<{ evaluatedAt: string }>
): AflTradeGate0ARequest {
  const range = authority.sourceRights.content.scope.seasonRanges[0]!;
  if (!Number.isSafeInteger(season) || season < range.from || season > range.to) {
    throw new TypeError(
      `The Draftguru trade authority is limited to seasons ${range.from} through ${range.to}.`
    );
  }
  return {
    decisionKey: authority.proposal.content.decisionKey,
    environment: 'non_production',
    rightsArtifactId: authority.sourceRights.rightsArtifactId,
    evaluatedAt: input.evaluatedAt,
    competition: 'AFLM',
    season,
    accessMechanism: 'automated_web',
    capabilityId: null,
    geography: 'global',
    commercialContext: 'internal-evaluation',
    audience: 'internal',
    operations: [...DRAFTGURU_TRADE_PERMITTED_OPERATIONS],
    fieldUses: authority.sourceRights.content.fields.map(({ sourceField }) => ({
      sourceField,
      use: 'archive_fact' as const,
    })),
    rawRetentionDays: 365,
    metadataRetentionDays: null,
    cacheSeconds: 86_400,
  };
}

/** A capture command whose request matches the rights record's exact provider scope. */
export function createDraftguruTradeCaptureCommand(
  authority: DraftguruTradeAuthority,
  input: Readonly<{
    season: number;
    discoveryFromSeason?: number;
    sourceUrl: string;
    capturedAt: string;
    effectiveAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const capabilityId = capabilityOf(authority);
  const gateRequest = createDraftguruTradeGateRequest(authority, input.season, {
    evaluatedAt: input.capturedAt,
  });
  const range = authority.sourceRights.content.scope.seasonRanges[0]!;
  if ((capabilityId === 'draftguru-trade-index') !== (input.discoveryFromSeason !== undefined)) {
    throw new TypeError('Draftguru discovery range must be supplied only for the trade index.');
  }
  if (
    input.discoveryFromSeason !== undefined &&
    (!Number.isSafeInteger(input.discoveryFromSeason) ||
      input.discoveryFromSeason < range.from ||
      input.discoveryFromSeason > input.season)
  ) {
    throw new TypeError(
      'Draftguru discovery range must remain entirely inside the authorized seasons.'
    );
  }
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: input.season,
      ...(input.discoveryFromSeason === undefined
        ? {}
        : { discoveryFromSeasonYear: input.discoveryFromSeason }),
      draftPathway: null,
      dataset: authority.sourceRights.content.dataset,
      datasetVersion: authority.sourceRights.content.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId,
      sourceUrl: input.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.effectiveAt,
      parserVersion: DRAFTGURU_TRADE_PARSER_VERSIONS[capabilityId],
      fieldManifestSha256: sha256AflTradeCanonicalJson(authority.sourceRights.content.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
