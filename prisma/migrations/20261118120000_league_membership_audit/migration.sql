-- Member removals and ownership transfers are recorded in LeagueCompetitionAudit (process-map
-- finding league-21, owner decision 2026-11-15, migration approved 2026-11-18). Additive: no existing
-- row changes. Rollback: PostgreSQL cannot drop an enum value; delete the MEMBER_REMOVED and
-- OWNERSHIP_TRANSFERRED audit rows and recreate the type without them.

-- AlterEnum
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'MEMBER_REMOVED';
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'OWNERSHIP_TRANSFERRED';
