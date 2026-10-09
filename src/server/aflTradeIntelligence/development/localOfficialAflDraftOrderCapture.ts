import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION } from '../source/draftCorroborationAdapter';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import { reviewedOfficialAflDraftOrderPages } from '../source/officialAflDraftOrderSourceScope';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

/** The governed capability id; parser v3 reads the reviewed pre-draft order tables under it. */
export const OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY = 'official-afl-indicative-draft-order';

/**
 * The field boundary parser v3 emits: every non-null leaf of a `pick_custody` claim. The recorded
 * rights must name exactly these; staging refuses a capture that emits any other leaf.
 */
export const OFFICIAL_AFL_DRAFT_ORDER_FIELDS = [
  'pick_custody.currentClub.recordedName',
  'pick_custody.draftType',
  'pick_custody.draftYear',
  'pick_custody.observedAt',
  'pick_custody.originalClub.recordedName',
  'pick_custody.recordedPickNumber',
  'pick_custody.roundNumber',
] as const;

/**
 * The owner records one narrow decision per season and parser version, for example
 * `official-afl-indicative-draft-order-issue579-private-2022-order-v3`. The runner never falls back
 * to another season or parser version.
 */
export function officialAflDraftOrderDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION)![1]!;
  return `${OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY}-issue579-private-${season}-order-${parser}`;
}

export interface LocalOfficialAflDraftOrderTarget {
  capabilityId: typeof OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY;
  season: number;
  sourceUrl: string;
  /** The as-of date the page states; every custody claim is observed at that instant. */
  effectiveAt: string;
}

/**
 * The exact reviewed pre-draft order page of each requested season. With `urls`, only those pages:
 * each must be a reviewed page of a requested season, so a URL narrows but never widens the run.
 */
export function createLocalOfficialAflDraftOrderTargets(
  seasons: readonly number[],
  urls?: readonly string[]
): LocalOfficialAflDraftOrderTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Draft-order capture requires one or more distinct seasons.'
    );
  }
  const targets: LocalOfficialAflDraftOrderTarget[] = [...seasons]
    .sort((left, right) => left - right)
    .flatMap((season) => {
      const pages = reviewedOfficialAflDraftOrderPages(season);
      if (pages.length === 0) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed Official AFL pre-draft order page is enumerable for ${season}.`
        );
      }
      return pages.map(({ url, asOf }) => ({
        capabilityId: OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY,
        season,
        sourceUrl: url,
        effectiveAt: `${asOf}T00:00:00.000Z`,
      }));
    });
  if (urls === undefined) return targets;
  if (urls.length === 0 || new Set(urls).size !== urls.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Draft-order URLs must be one or more distinct reviewed pages.'
    );
  }
  const unreviewed = urls.filter((url) => !targets.some(({ sourceUrl }) => sourceUrl === url));
  if (unreviewed.length > 0) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      `Not a reviewed pre-draft order page of the requested seasons: ${unreviewed.join(', ')}`
    );
  }
  return targets.filter(({ sourceUrl }) => urls.includes(sourceUrl));
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createOfficialAflDraftOrderCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalOfficialAflDraftOrderTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'official_afl' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY
  ) {
    throw new TypeError('The authority is not an Official AFL draft-order capability.');
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
      draftPathway: 'national',
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: OFFICIAL_AFL_DRAFT_ORDER_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.target.effectiveAt,
      parserVersion: OFFICIAL_AFL_DRAFT_ORDER_TABLE_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
