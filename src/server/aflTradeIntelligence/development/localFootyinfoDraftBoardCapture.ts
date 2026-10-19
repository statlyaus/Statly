import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import { FOOTYINFO_DRAFT_BOARD_PARSER_VERSION } from '../source/footyinfoDraftBoardAdapter';
import type { AflTradeExternalProviderIngestionCommand } from '../source/externalDraftTradeProviderIngestion';
import {
  FOOTYINFO_DRAFT_BOARD_SEASONS,
  footyinfoDraftBoardUrl,
} from '../source/footyinfoDraftBoardSourceScope';
import {
  createLocalNarrowCaptureGateRequest,
  LocalExternalCaptureError,
  type LocalNarrowCaptureAuthority,
} from './localNarrowCaptureAuthority';

/** The governed capability id; parser v3 reads the reviewed national draft boards under it. */
export const FOOTYINFO_DRAFT_BOARD_CAPABILITY = 'footyinfo-national-draft-board';

/**
 * The field boundary parser v1 emits: every non-null leaf of its `draft_board_pick` and
 * `draft_selection` claims. These are the board's pick number, club, player or passed/removed
 * status, route, points and note (with the round heading each row sits under), as the owner's
 * Gate 0A decision of 2026-10-12 scoped them. The recorded rights must name exactly these; staging
 * refuses a capture that emits any other leaf.
 */
export const FOOTYINFO_DRAFT_BOARD_V1_FIELDS = [
  'draft_board_pick.bid.basis',
  'draft_board_pick.bid.club.nativeId',
  'draft_board_pick.bid.club.recordedName',
  'draft_board_pick.club.nativeId',
  'draft_board_pick.club.recordedName',
  'draft_board_pick.draftType',
  'draft_board_pick.draftYear',
  'draft_board_pick.note',
  'draft_board_pick.player.nativeId',
  'draft_board_pick.player.recordedName',
  'draft_board_pick.points',
  'draft_board_pick.recordedPickNumber',
  'draft_board_pick.roundNumber',
  'draft_board_pick.route.nativeId',
  'draft_board_pick.route.recordedName',
  'draft_board_pick.routeLabel',
  'draft_board_pick.status',
  'draft_selection.draftType',
  'draft_selection.draftYear',
  'draft_selection.player.nativeId',
  'draft_selection.player.recordedName',
  'draft_selection.roundNumber',
  'draft_selection.selectedByClub.nativeId',
  'draft_selection.selectedByClub.recordedName',
  'draft_selection.selectionNumber',
] as const;

/**
 * The leaves parser v2 adds (issue 789): every non-null leaf of a `draft_board_bid_match`, the
 * matched bid's selection, bidding club and basis, its points and points used, each spent pick's
 * board id, label, original number and club, holder and points used, and each leftover-points pick
 * it created with its holder and points.
 */
export const FOOTYINFO_DRAFT_BOARD_BID_MATCH_FIELDS = [
  'draft_board_bid_match.bid.basis',
  'draft_board_bid_match.bid.club.nativeId',
  'draft_board_bid_match.bid.club.recordedName',
  'draft_board_bid_match.club.nativeId',
  'draft_board_bid_match.club.recordedName',
  'draft_board_bid_match.consumedPicks.holdingClubCode',
  'draft_board_bid_match.consumedPicks.label',
  'draft_board_bid_match.consumedPicks.nativePickId',
  'draft_board_bid_match.consumedPicks.originalClubCode',
  'draft_board_bid_match.consumedPicks.originalNumber',
  'draft_board_bid_match.consumedPicks.pointsUsed',
  'draft_board_bid_match.draftType',
  'draft_board_bid_match.draftYear',
  'draft_board_bid_match.leftoverPicks.holdingClubCode',
  'draft_board_bid_match.leftoverPicks.nativePickId',
  'draft_board_bid_match.leftoverPicks.points',
  'draft_board_bid_match.nativePickId',
  'draft_board_bid_match.player.nativeId',
  'draft_board_bid_match.player.recordedName',
  'draft_board_bid_match.points',
  'draft_board_bid_match.pointsUsed',
  'draft_board_bid_match.roundNumber',
  'draft_board_bid_match.selectionNumber',
] as const;

/**
 * The leaves parser v3 adds (issue 789, owner decision 2026-10-18): each board pick's original club
 * and its number before the draft.
 */
export const FOOTYINFO_DRAFT_BOARD_PICK_ORIGIN_FIELDS = [
  'draft_board_pick.originalClub.nativeId',
  'draft_board_pick.originalClub.recordedName',
  'draft_board_pick.originalNumber',
] as const;

/**
 * The field boundary parser v3 emits: v1's, the matched-bid and the pick-origin leaves. A v3 capture
 * needs its own recorded decision naming exactly these; the v1 and v2 decisions and captures stay
 * valid as recorded.
 */
export const FOOTYINFO_DRAFT_BOARD_FIELDS = [
  ...FOOTYINFO_DRAFT_BOARD_V1_FIELDS,
  ...FOOTYINFO_DRAFT_BOARD_BID_MATCH_FIELDS,
  ...FOOTYINFO_DRAFT_BOARD_PICK_ORIGIN_FIELDS,
] as const;

/**
 * The owner records one narrow decision per season and parser version, for example
 * `footyinfo-national-draft-board-issue853-private-2024-board-v3`. The runner never falls back to
 * another season or parser version.
 */
export function footyinfoDraftBoardDecisionKey(season: number): string {
  const parser = /\/(v[1-9]\d*)$/.exec(FOOTYINFO_DRAFT_BOARD_PARSER_VERSION)![1]!;
  return `${FOOTYINFO_DRAFT_BOARD_CAPABILITY}-issue853-private-${season}-board-${parser}`;
}

export interface LocalFootyinfoDraftBoardTarget {
  capabilityId: typeof FOOTYINFO_DRAFT_BOARD_CAPABILITY;
  season: number;
  sourceUrl: string;
}

/** The one reviewed board page of each requested season, in season order. */
export function createLocalFootyinfoDraftBoardTargets(
  seasons: readonly number[]
): LocalFootyinfoDraftBoardTarget[] {
  if (seasons.length === 0 || new Set(seasons).size !== seasons.length) {
    throw new LocalExternalCaptureError(
      'INVALID_TARGET',
      'Draft-board capture requires one or more distinct seasons.'
    );
  }
  return [...seasons]
    .sort((left, right) => left - right)
    .map((season) => {
      if (!(FOOTYINFO_DRAFT_BOARD_SEASONS as readonly number[]).includes(season)) {
        throw new LocalExternalCaptureError(
          'INVALID_TARGET',
          `No reviewed Footyinfo draft board is enumerable for ${season}.`
        );
      }
      return {
        capabilityId: FOOTYINFO_DRAFT_BOARD_CAPABILITY,
        season,
        sourceUrl: footyinfoDraftBoardUrl(season),
      };
    });
}

/**
 * A capture command whose request matches the recorded rights record's exact provider scope. The
 * board carries no as-of date, so its claims are effective when captured.
 */
export function createFootyinfoDraftBoardCaptureCommand(
  authority: LocalNarrowCaptureAuthority,
  input: Readonly<{
    target: LocalFootyinfoDraftBoardTarget;
    capturedAt: string;
    maximumBytes: number;
  }>
): AflTradeExternalProviderIngestionCommand {
  const rights = authority.sourceRights.content;
  if (
    rights.provider !== 'footyinfo' ||
    rights.acquisition.kind !== 'provider_web' ||
    rights.acquisition.capabilityId !== FOOTYINFO_DRAFT_BOARD_CAPABILITY
  ) {
    throw new TypeError('The authority is not a Footyinfo draft-board capability.');
  }
  const gateRequest = createLocalNarrowCaptureGateRequest(authority, input.target.season, {
    evaluatedAt: input.capturedAt,
  });
  return {
    gateRequest,
    request: {
      environment: 'non_production',
      provider: 'footyinfo',
      competition: 'AFLM',
      anchorSeasonYear: input.target.season,
      draftPathway: 'national',
      dataset: rights.dataset,
      datasetVersion: rights.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: FOOTYINFO_DRAFT_BOARD_CAPABILITY,
      sourceUrl: input.target.sourceUrl,
      capturedAt: input.capturedAt,
      effectiveAt: input.capturedAt,
      parserVersion: FOOTYINFO_DRAFT_BOARD_PARSER_VERSION,
      fieldManifestSha256: sha256AflTradeCanonicalJson(rights.fields),
      maximumBytes: input.maximumBytes,
    },
  };
}
