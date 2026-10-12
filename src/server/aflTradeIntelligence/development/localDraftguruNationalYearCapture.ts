import { DRAFTGURU_NATIONAL_YEAR_QUALIFIED_ACCESS_PARSER_VERSION } from '../source/externalDraftTradeEvidenceContracts';
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
export const DRAFTGURU_NATIONAL_YEAR_V1_PARSER_VERSION = 'draftguru-national-year-page/v1';

/**
 * v2 added each selection's access category (open, academy or father-son) from the year page; v3 also
 * reads the 2019 club-qualified academy forms. New captures use v3; v2 captures stay valid.
 */
export const DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION =
  DRAFTGURU_NATIONAL_YEAR_QUALIFIED_ACCESS_PARSER_VERSION;

/** The recorded v1 field boundary for Draftguru national-year selections. */
export const DRAFTGURU_NATIONAL_YEAR_V1_FIELDS = [
  'draft_selection.draftType',
  'draft_selection.draftYear',
  'draft_selection.player.nativeId',
  'draft_selection.player.recordedName',
  'draft_selection.selectedByClub.nativeId',
  'draft_selection.selectedByClub.recordedName',
  'draft_selection.selectionNumber',
] as const;

/** The v2 and v3 field boundary: v1 plus the access category. Recorded rights must name exactly these. */
export const DRAFTGURU_NATIONAL_YEAR_FIELDS = [
  ...DRAFTGURU_NATIONAL_YEAR_V1_FIELDS,
  'draft_selection.accessCategory',
] as const;

/**
 * The owner records one narrow decision per season for this capability. v1 used
 * `draftguru-national-year-page-issue579-private-<season>`; each later parser has its own per-season
 * decision with a `-parser-v<n>` suffix (v2: `-parser-v2`, v3: `-parser-v3`), so earlier decisions and
 * their captures stay valid as recorded. The runner never falls back to an earlier parser or to a
 * combined or neighbouring season's decision.
 */
export function draftguruNationalYearDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(DRAFTGURU_NATIONAL_YEAR_PARSER_VERSION)![1]!;
  return `${DRAFTGURU_NATIONAL_YEAR_CAPABILITY}-issue579-private-${season}-parser-${parser}`;
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
