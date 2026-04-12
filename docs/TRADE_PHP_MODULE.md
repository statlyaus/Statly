# PHP trade module (removed)

Statly previously carried a PDO-based PHP trade bounded context for experiments and PHPUnit. **It has been removed** from this repository so there is exactly one trade implementation: **Prisma + `src/services/tradeService.ts`** via Next.js route handlers under `src/app/api/trades/`.

For the canonical design, see [TRADE_ARCHITECTURE.md](./TRADE_ARCHITECTURE.md). For veto-window scheduling, see [INNGEST_LOCAL_SETUP.md](./INNGEST_LOCAL_SETUP.md).
