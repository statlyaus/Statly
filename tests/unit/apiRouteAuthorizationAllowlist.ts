/**
 * Routes that are reachable without an authenticated caller, and why.
 *
 * `tests/unit/apiRouteAuthorizationContract.test.ts` fails when a route handler under
 * `src/app/api` neither resolves an authenticated caller nor appears in this list. Every entry must
 * carry a reason, and an entry whose route no longer exists fails the test, so this list cannot drift
 * away from the code it describes.
 *
 * Reasons beginning with `BLOCKED ON CLIENT:` are known gaps rather than approvals: the route should
 * require a caller, but its existing client does not send a verifiable credential yet, so gating the
 * route would break that client in production while still working in development. The reason names
 * the client that has to move to `authenticatedFetch` first.
 */
export interface PublicRouteEntry {
  /**
   * Route path relative to `/api`, for example `/players`, covering every handler in the file; or
   * one handler, for example `DELETE /auth/session`, when only that handler is public.
   */
  readonly route: string;
  /** Why this route is reachable without an authenticated caller. */
  readonly reason: string;
}

export const PUBLIC_API_ROUTES: readonly PublicRouteEntry[] = [
  // Single public handlers in otherwise guarded routes.
  {
    route: 'DELETE /auth/session',
    reason: "Clears the caller's own session cookie; same-origin checked and reads nothing.",
  },

  // Operational probes. No user or league data is returned.
  { route: '/ping', reason: 'Liveness probe; reads nothing.' },
  {
    route: '/health',
    reason:
      'Operational health probe. Returns per-service status only; one round of checks serves all callers for 10 seconds.',
  },

  // Public AFL statistics and match read models.
  { route: '/players', reason: 'Public AFL player read model.' },
  { route: '/players/search', reason: 'Public AFL player search.' },
  { route: '/players/[id]/matches', reason: 'Public AFL player match history.' },
  { route: '/player-stats', reason: 'Public AFL player statistics read model.' },
  { route: '/matches', reason: 'Public AFL match read model.' },
  { route: '/injuries', reason: 'Public AFL injury list.' },
  { route: '/rankings', reason: 'Public ranking reads.' },

  // Live-stat ingestion projections, read-only from the application's perspective.
  {
    route: '/live-player-stats',
    reason: 'Reads live AFL player stats from the ingestion projection.',
  },

  // Telemetry.
  {
    route: '/analytics/performance',
    reason:
      'Web-vitals beacon, gated by a first-party origin allowlist rather than a caller identity.',
  },

  // Public draft and trade research surface (docs/architecture/afl-trade-intelligence.md).
  { route: '/draft-trades', reason: 'Public AFL draft and trade research surface.' },
  { route: '/draft-trades/search', reason: 'Public AFL draft and trade research surface.' },
  { route: '/draft-trades/outcomes', reason: 'Public AFL draft and trade research surface.' },
  { route: '/draft-trades/methodology', reason: 'Public methodology description.' },
  { route: '/draft-trades/valuations', reason: 'Public AFL draft and trade research surface.' },
  { route: '/draft-trades/export', reason: 'CSV export of the public research surface.' },
  { route: '/draft-trades/[tradeId]', reason: 'Public AFL draft and trade research surface.' },
  { route: '/draft-trades/[tradeId]/valuation', reason: 'Public research surface detail.' },
  { route: '/draft-trades/[tradeId]/export', reason: 'CSV export of a public research record.' },
  { route: '/draft-trades/club/[clubSlug]', reason: 'Public club draft and trade history.' },

  // Draft room.
  {
    route: '/drafts/[id]/pick',
    reason:
      'Authorizes inside handlePickCommand: getAuthenticatedUserId, then a league and draft membership check.',
  },

  // Realtime transport.
  {
    route: '/socketio',
    reason:
      'Returns a constant 404 telling Socket.IO polling clients to use the dedicated socket server, and reads nothing. It also sets Access-Control-Allow-Origin: * unnecessarily.',
  },

  // Private evaluation export.
  {
    route: '/dev/afl-trade-evaluation/[tradeId]/export',
    reason:
      'Development-only surface: it reads through privateLocalWorkbookReads, which carries local test-fixture custody and cannot operate against a production environment.',
  },

  // Covered by the in-flight API authorization change; remove each entry once that change is merged.
  {
    route: '/admin/queue',
    reason:
      'ADMIN_SECRET operator check is added by the in-flight API authorization change. Remove once merged.',
  },
  {
    route: '/admin/workers',
    reason:
      'ADMIN_SECRET operator check is added by the in-flight API authorization change. Remove once merged.',
  },
  {
    route: '/user/watchlists',
    reason:
      'Verified-identity requirement is added by the in-flight API authorization change. Remove once merged.',
  },
  {
    route: '/user/leagues',
    reason:
      'Verified-identity requirement is added by the in-flight API authorization change. Remove once merged.',
  },
  {
    route: '/user/leagues/[id]/settings',
    reason:
      'Verified-identity requirement is added by the in-flight API authorization change. Remove once merged.',
  },
];
