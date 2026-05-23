/**
 * Operational limits for AFL historical draft `tradeRefs` under each club doc.
 *
 * Model: one ref per trade the club appears in (see `Scripts/import-draft-trades.ts`).
 * Today’s data is low hundreds per club; these thresholds catch pathological growth
 * before memory or TTFB becomes an issue. If exceeded, prefer pagination or a SQL/search
 * mirror rather than widening Firestore composite-index reliance.
 *
 * Audit live data (uses `tradeCount` on club docs as a proxy for ref count):
 *   `npm run report:draft-club-scale`
 * Optional CI gate: append `--strict` to fail when any club is at/above CRITICAL.
 *
 * Search: club pages use in-memory `filterClubTradeRefs` (see `clubTradeRefSearch.ts`).
 * For league-wide typo-tolerant search, plan a Postgres FTS or hosted search index fed at import time.
 */
export const DRAFT_CLUB_TRADE_REFS_WARN_THRESHOLD = 2_500;

/** Above this, ship pagination or a read replica before the next season’s import. */
export const DRAFT_CLUB_TRADE_REFS_CRITICAL_THRESHOLD = 8_000;
