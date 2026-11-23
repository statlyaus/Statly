import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import {
  DRAFTGURU_POST_DRAFT_ORDER_SEASONS,
  draftguruPostDraftOrderUrl,
} from '../source/draftguruPostDraftOrderAdapter';
import { DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION } from '../source/externalDraftTradeEvidenceContracts';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

/** Draftguru's post-draft national order page (owner approval 4 of the 2026 intake). */
export const DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY = 'draftguru-post-draft-order';

/**
 * The field boundary parser v1 emits: every non-null leaf of its `draft_order_pick` claims. The
 * round, final pick number and holder; the origin (original club, round and rank, a compensation
 * label, a matched bid's bidding club, basis, nominee and the picks it used, or a leftover-points
 * pick's club and nominee); each trade hop's club and trade id; a declined bid's club; and the
 * outcome (the selected player, the nominee a pick was spent on and the number it was spent as, or a
 * removal note). No points, games or grades. The recorded rights must name exactly these.
 */
export const DRAFTGURU_POST_DRAFT_ORDER_FIELDS = [
  'draft_order_pick.bidNotMatchedBy.nativeId',
  'draft_order_pick.bidNotMatchedBy.recordedName',
  'draft_order_pick.club.nativeId',
  'draft_order_pick.club.recordedName',
  'draft_order_pick.draftType',
  'draft_order_pick.draftYear',
  'draft_order_pick.hops.nativeEventId',
  'draft_order_pick.hops.toClub.nativeId',
  'draft_order_pick.hops.toClub.recordedName',
  'draft_order_pick.origin.basis',
  'draft_order_pick.origin.bidClub.nativeId',
  'draft_order_pick.origin.bidClub.recordedName',
  'draft_order_pick.origin.club.nativeId',
  'draft_order_pick.origin.club.recordedName',
  'draft_order_pick.origin.kind',
  'draft_order_pick.origin.label',
  'draft_order_pick.origin.nominee.nativeId',
  'draft_order_pick.origin.nominee.recordedName',
  'draft_order_pick.origin.rank',
  'draft_order_pick.origin.roundNumber',
  'draft_order_pick.origin.usingPicks',
  'draft_order_pick.outcome.asPick',
  'draft_order_pick.outcome.kind',
  'draft_order_pick.outcome.nominee.nativeId',
  'draft_order_pick.outcome.nominee.recordedName',
  'draft_order_pick.outcome.note',
  'draft_order_pick.outcome.player.nativeId',
  'draft_order_pick.outcome.player.recordedName',
  'draft_order_pick.pickNumber',
  'draft_order_pick.roundNumber',
] as const;

/** The dataset the rights derived for this capability name (`--from-capability`). */
export function draftguruPostDraftOrderDataset(season: number): string {
  return `Draftguru ${season} post-draft national order`;
}

/**
 * One narrow decision per season and parser, for example
 * `draftguru-post-draft-order-issue579-private-2026-parser-v1`, as the national-year page's. The
 * runner never falls back to another season or parser.
 */
export function draftguruPostDraftOrderDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION)![1]!;
  return `${DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY}-issue579-private-${season}-parser-${parser}`;
}

export interface LocalDraftguruPostDraftOrderTarget {
  capabilityId: typeof DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY;
  season: number;
  sourceUrl: string;
}

/** The one reviewed post-draft order page of each requested season, in season order. */
export function createLocalDraftguruPostDraftOrderTargets(
  seasons: readonly number[]
): LocalDraftguruPostDraftOrderTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Post-draft order capture requires one or more distinct seasons.'
    );
  }
  return [...seasons]
    .sort((left, right) => left - right)
    .map((season) => {
      if (!DRAFTGURU_POST_DRAFT_ORDER_SEASONS.includes(season)) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed Draftguru post-draft order page is enumerable for ${season}.`
        );
      }
      return {
        capabilityId: DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
        season,
        sourceUrl: draftguruPostDraftOrderUrl(season),
      };
    });
}

/** A capture command whose request matches the recorded rights record's exact provider scope. */
export function createDraftguruPostDraftOrderCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalDraftguruPostDraftOrderTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'draftguru' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY
  ) {
    throw new TypeError('The authority is not a Draftguru post-draft order capability.');
  }
  return {
    gateRequest: createLocalNarrowCaptureGateRequest(authority, input.target.season, {
      evaluatedAt: input.capturedAt,
    }),
    request: {
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      draftPathway: 'national',
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: DRAFTGURU_POST_DRAFT_ORDER_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      // The page states no as-of time, so each claim is effective as captured.
      effectiveAt: input.capturedAt,
      parserVersion: DRAFTGURU_POST_DRAFT_ORDER_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
