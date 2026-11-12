-- No Losers 1/6 (#1291): a third league format. Additive: no new columns, existing leagues keep their
-- format. Rollback: PostgreSQL cannot drop an enum value, so move NO_LOSERS leagues back to STANDARD
-- and recreate "LeagueFormat" without it.

-- AlterEnum
ALTER TYPE "LeagueFormat" ADD VALUE 'NO_LOSERS';
