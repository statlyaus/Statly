/**
 * Deprecated: Pick handling is consolidated into the Prisma-backed transactional route
 * at `src/app/api/drafts/[id]/pick/route.ts` for atomicity and idempotency.
 *
 * This file is intentionally left without a route handler to avoid duplicate
 * logic and divergence. If you need to integrate with the LiveDraftEngine for
 * real-time notifications, emit events from the Prisma route after a successful
 * pick instead of handling picks here.
 */

export {};
