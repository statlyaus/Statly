import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import { OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION } from '../source/officialAflTradePeriodAdapter';
import { reviewedOfficialAflTradePeriodPages } from '../source/officialAflTradePeriodSourceScope';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

/** The governed capability id; parser v2 reads one season's trade-period window under it. */
export const OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY = 'official-afl-trade-period-dates';

/**
 * The field boundary parser v1 emits: every non-null leaf of a `trade_period_window` claim. The
 * recorded rights must name exactly these; staging refuses a capture that emits any other leaf.
 */
export const OFFICIAL_AFL_TRADE_PERIOD_FIELDS = [
  'trade_period_window.datePrecision.earliestDate',
  'trade_period_window.datePrecision.latestDate',
  'trade_period_window.datePrecision.precision',
  'trade_period_window.seasonYear',
] as const;

/**
 * The owner records one narrow decision per season and parser version, for example
 * `official-afl-trade-period-dates-issue869-private-2023-period-v2`. The runner never falls back
 * to another season or parser version.
 */
export function officialAflTradePeriodDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION)![1]!;
  return `${OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY}-issue869-private-${season}-period-${parser}`;
}

export interface LocalOfficialAflTradePeriodTarget {
  capabilityId: typeof OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY;
  season: number;
  sourceUrl: string;
  /** The first day of the trade period the reviewed page states; the window is effective from it. */
  effectiveAt: string;
}

/**
 * The exact reviewed trade-period announcement of each requested season. With `urls`, only those
 * pages: each must be a reviewed page of a requested season, so a URL narrows but never widens.
 */
export function createLocalOfficialAflTradePeriodTargets(
  seasons: readonly number[],
  urls?: readonly string[]
): LocalOfficialAflTradePeriodTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Trade-period capture requires one or more distinct seasons.'
    );
  }
  const targets: LocalOfficialAflTradePeriodTarget[] = [...seasons]
    .sort((left, right) => left - right)
    .flatMap((season) => {
      const pages = reviewedOfficialAflTradePeriodPages(season);
      if (pages.length === 0) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed Official AFL trade-period announcement is enumerable for ${season}.`
        );
      }
      return pages.map(({ url, earliestDate }) => ({
        capabilityId: OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY,
        season,
        sourceUrl: url,
        effectiveAt: `${earliestDate}T00:00:00.000Z`,
      }));
    });
  if (urls === undefined) return targets;
  if (urls.length === 0 || new Set(urls).size !== urls.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Trade-period URLs must be one or more distinct reviewed pages.'
    );
  }
  const unreviewed = urls.filter((url) => !targets.some(({ sourceUrl }) => sourceUrl === url));
  if (unreviewed.length > 0) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      `Not a reviewed trade-period announcement of the requested seasons: ${unreviewed.join(', ')}`
    );
  }
  return targets.filter(({ sourceUrl }) => urls.includes(sourceUrl));
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createOfficialAflTradePeriodCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalOfficialAflTradePeriodTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'official_afl' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY
  ) {
    throw new TypeError('The authority is not an Official AFL trade-period capability.');
  }
  const gateRequest = createLocalNarrowCaptureGateRequest(authority, input.target.season, {
    evaluatedAt: input.capturedAt,
  });
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'official_afl',
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      draftPathway: null,
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: OFFICIAL_AFL_TRADE_PERIOD_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.target.effectiveAt,
      parserVersion: OFFICIAL_AFL_TRADE_PERIOD_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
