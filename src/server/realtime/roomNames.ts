/**
 * The only place Socket.IO room names are built. Every room carries league and season scope.
 * A league has at most one draft (`Draft.leagueId` is unique), so a draft id names one league and
 * one draft and cannot span seasons; if a league ever gets a draft per season, `Draft` needs a
 * `seasonId` first. League social rooms (chat, board, activity and trade threads) name the season.
 *
 * Ids may not contain `:`, so one room name can never be read as another's (a draft id cannot
 * name a social room, a league id cannot reach into another league's season rooms).
 */

const SOCIAL_ROOM_PREFIX = 'social:league:';
const SEASON_SEGMENT = ':season:';

function requireRoomId(kind: string, id: string): string {
  if (typeof id !== 'string' || !id || id.includes(':')) {
    throw new Error(`Invalid ${kind} id for a Socket.IO room`);
  }
  return id;
}

/** Canonical draft room: protocol v2 joins only this; v1 joins it and the legacy room. */
export function draftRoom(draftId: string): string {
  return `draft:${requireRoomId('draft', draftId)}`;
}

/** Protocol v1 compatibility room, named by the bare draft id. */
export function legacyDraftRoom(draftId: string): string {
  return requireRoomId('draft', draftId);
}

/** League social room for one season; `social:join` admits a member of that league season. */
export function leagueSeasonSocialRoom(leagueId: string, seasonId: string): string {
  return `${SOCIAL_ROOM_PREFIX}${requireRoomId('league', leagueId)}${SEASON_SEGMENT}${requireRoomId('season', seasonId)}`;
}

/** True for a social room of this league in any season. */
export function isLeagueSocialRoom(room: string, leagueId: string): boolean {
  return room.startsWith(
    `${SOCIAL_ROOM_PREFIX}${requireRoomId('league', leagueId)}${SEASON_SEGMENT}`
  );
}
