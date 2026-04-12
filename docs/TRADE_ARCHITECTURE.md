# Trade system architecture (canonical)

## System of record

- **Persistence:** Prisma models in `prisma/schema.prisma` — e.g. `Trade`, `TradeItem`, `TradeAction`, `TradeAudit`, `TradeReviewVote`, `TradePlayerLock`, and league governance fields on `League` (`tradeReview`, `tradeVetoPeriodHours`, …).
- **Application logic:** `src/services/tradeService.ts` — propose, accept, decline, cancel, review votes, commissioner paths, veto window, execution, limits, and idempotency.
- **HTTP:** Next.js route handlers under `src/app/api/` that delegate to `tradeService` (and related services).

## Background processing

- **Veto window auto-finalization:** Inngest function `tradeVetoWindowSweepFunction` (`src/server/inngest/functions/tradeVetoWindowSweep.ts`), registered in `src/app/api/inngest/route.ts`.

## Non-goals

- **No alternate trade stack** (no second language, schema, or HTTP surface for season trades). Historical PHP reference code was removed from the repo to keep ownership obvious.

## Related docs

- [runtime-contract.md](./runtime-contract.md) — primary app runtime and persistence.
- [TRADE_PHP_MODULE.md](./TRADE_PHP_MODULE.md) — note on removal of the old PHP module.
- [INNGEST_LOCAL_SETUP.md](./INNGEST_LOCAL_SETUP.md) — local Inngest dev including trade sweep.
