-- A FINAL round may still be rescored (stat corrections), but each changed matchup result is recorded
-- in LeagueCompetitionAudit with before and after (process-map finding roster-scoring-11, owner
-- decision 2026-11-11). Additive: no existing row changes. Rollback: PostgreSQL cannot drop an enum
-- value; delete the FINAL_ROUND_RESCORED audit rows and recreate the type without it.

-- AlterEnum
ALTER TYPE "LeagueCompetitionAuditEventType" ADD VALUE 'FINAL_ROUND_RESCORED';
