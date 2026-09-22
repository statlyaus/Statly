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
  /** Route path relative to `/api`, for example `/players`. */
  readonly route: string;
  /** Why this route is reachable without an authenticated caller. */
  readonly reason: string;
}

export const PUBLIC_API_ROUTES: readonly PublicRouteEntry[] = [
  // Operational probes. No user or league data is returned.
  { route: '/ping', reason: 'Liveness probe; reads nothing.' },
  { route: '/auth/health', reason: 'Authentication subsystem probe; reports status only.' },
  {
    route: '/health',
    reason:
      'Operational health probe. REVIEW: it performs a live Firestore read plus Redis and relational checks on every call with no caching, so it is also an unauthenticated cost surface.',
  },

  // Public AFL statistics and match read models.
  { route: '/players', reason: 'Public AFL player read model.' },
  { route: '/players/search', reason: 'Public AFL player search.' },
  { route: '/players/[id]/stats', reason: 'Public AFL player statistics.' },
  { route: '/players/[id]/matches', reason: 'Public AFL player match history.' },
  { route: '/player-stats', reason: 'Public AFL player statistics read model.' },
  { route: '/matches', reason: 'Public AFL match read model.' },
  { route: '/matches/enhanced', reason: 'Public AFL match read model with derived detail.' },
  { route: '/injuries', reason: 'Public AFL injury list.' },
  { route: '/weekend-summary', reason: 'Public weekend summary.' },
  { route: '/rankings', reason: 'Public ranking reads.' },
  {
    route: '/rankings/suggest',
    reason: 'Pure computation over supplied input; reads no stored state.',
  },

  // Live-stat ingestion projections, read-only from the application's perspective.
  { route: '/live-data', reason: 'Reads live AFL stat evidence from the ingestion projection.' },
  {
    route: '/live-player-stats',
    reason: 'Reads live AFL player stats from the ingestion projection.',
  },
  { route: '/etl', reason: 'Reads live AFL stat evidence; the ETL writer runs out of band.' },
  {
    route: '/ingest-injuries',
    reason:
      'Stateless injury-text parser. REVIEW: confirm the `ingest` mode never persists before treating this as settled.',
  },

  // Pure computation.
  {
    route: '/scheduling/generate',
    reason: 'Generates a schedule from the request body; stores nothing.',
  },
  { route: '/scheduling/presets', reason: 'Returns static scheduling presets.' },

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
  {
    route: '/drafts/list',
    reason:
      'BLOCKED ON CLIENT: a debug endpoint that returns every draft with its league name and settings. Its caller, src/components/dashboard/LiveDraftModule.tsx, uses fetchApi, which only attaches a credential when development auth is enabled, so requiring a caller here would break the dashboard in production while still working in development. Move that caller to authenticatedFetch first, then require a caller.',
  },
  {
    route: '/drafts/[id]/participants',
    reason:
      'BLOCKED ON CLIENT: accepts a client-supplied userId and updates presence for it, so the actor is never proven. The caller, src/hooks/useDraftService.ts, uses fetchApi. Move it to authenticatedFetch, then derive the actor from the credential instead of the body.',
  },
  {
    route: '/drafts/[id]/analytics',
    reason:
      'BLOCKED ON CLIENT: pick analytics read without a membership check. Called from src/hooks/useDraftService.ts through fetchApi.',
  },
  {
    route: '/drafts/[id]/players',
    reason:
      'BLOCKED ON CLIENT: draft player pool read without a membership check. Called through fetchApi.',
  },
  {
    route: '/drafts/[id]/schedule',
    reason:
      'BLOCKED ON CLIENT: draft schedule read without a membership check. src/components/draft/DraftScheduleManager.tsx calls it with a bare fetch, which sends no credential at all.',
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
