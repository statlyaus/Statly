-- Bloodsucker 3/9 (#1280): the audit row that records the exclusive window closing and the auto-fill,
-- and makes the close idempotent. Additive: no new columns. Rollback: PostgreSQL cannot drop an enum
-- value, so delete the BLOODSUCKER_WINDOW_CLOSED rows and recreate "LeagueCompetitionAuditEventType"
-- without it.

-- AlterEnum
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'BLOODSUCKER_WINDOW_CLOSED';
