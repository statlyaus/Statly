import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

export const DRAFTGURU_NATIONAL_YEAR_CAPABILITY = 'draftguru-national-year-page';

/**
 * The parser identity the owner's recorded national-year source rights name. National-only capture
 * keeps this separate contract; it is never the general `draftguru-event-year` year-page parser.
 */
export const DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION = 'draftguru-national-year-page/v1';

/**
 * The owner records one narrow decision per season for this capability, for example
 * `draftguru-national-year-page-issue579-private-2024`. The runner never falls back to a combined or
 * neighbouring season's decision.
 */
export function draftguruNationalYearDecisionKey(season: number): string {
  return `${DRAFTGURU_NATIONAL_YEAR_CAPABILITY}-issue579-private-${season}`;
}

export interface LocalDraftguruNationalYearTarget {
  capabilityId: typeof DRAFTGURU_NATIONAL_YEAR_CAPABILITY;
  season: number;
  sourceUrl: string;
}

/** One exact `/years/<season>` page per requested season, in season order. */
export function createLocalDraftguruNationalYearTargets(
  seasons: readonly number[]
): LocalDraftguruNationalYearTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'National-year capture requires one or more distinct seasons.'
    );
  }
  return [...seasons]
    .sort((left, right) => left - right)
    .map((season) => ({
      capabilityId: DRAFTGURU_NATIONAL_YEAR_CAPABILITY,
      season,
      sourceUrl: `https://www.draftguru.com.au/years/${season}`,
    }));
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createDraftguruNationalYearCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalDraftguruNationalYearTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'draftguru' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== DRAFTGURU_NATIONAL_YEAR_CAPABILITY
  ) {
    throw new TypeError('The authority is not a Draftguru national-year capability.');
  }
  const gateRequest = createLocalNarrowCaptureGateRequest(authority, input.target.season, {
    evaluatedAt: input.capturedAt,
  });
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      draftPathway: 'national',
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: DRAFTGURU_NATIONAL_YEAR_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      // Draftguru records no selection instant, so each claim is effective as observed.
      effectiveAt: input.capturedAt,
      parserVersion: DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
