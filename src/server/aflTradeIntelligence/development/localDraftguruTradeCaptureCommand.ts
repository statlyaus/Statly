import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import type { AflTradeGate0ARequest } from '../source/gate0aEvaluation';
import {
  DRAFTGURU_TRADE_PARSER_VERSIONS,
  type createDraftguruTradeAuthorityProposal,
  type DraftguruTradeCapability,
} from './localDraftguruTradeAuthorityProposal';
import { createLocalNarrowCaptureGateRequest } from './localNarrowCaptureAuthority';

export type DraftguruTradeAuthority = ReturnType<typeof createDraftguruTradeAuthorityProposal>;

function capabilityOf(authority: DraftguruTradeAuthority): DraftguruTradeCapability {
  const acquisition = authority.sourceRights.content.acquisition;
  const capabilityId = acquisition.kind === 'provider_web' ? acquisition.capabilityId : null;
  if (capabilityId !== 'draftguru-trade-index' && capabilityId !== 'draftguru-trade-detail') {
    throw new TypeError('The authority is not a Draftguru trade capability.');
  }
  return capabilityId;
}

/** The narrow Gate request for one Draftguru trade season; see the shared narrow builder. */
export function createDraftguruTradeGateRequest(
  authority: DraftguruTradeAuthority,
  season: number,
  input: Readonly<{ evaluatedAt: string }>
): AflTradeGate0ARequest {
  return createLocalNarrowCaptureGateRequest(authority, season, input);
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
