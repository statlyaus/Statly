# Roster consolidation migration

## Summary

LeagueRosterPlayer is now the **single source of truth** for roster player lists. LeagueRoster holds metadata (captain, vice-captain, bench order) and keeps `playerIds` in sync for backward compatibility.

## Migration: `20260220000000_add_roster_sort_order`

1. Adds `sortOrder` column to LeagueRosterPlayer (default 0) for deterministic lineup ordering.
2. Adds index `(leagueId, memberId, sortOrder)` for efficient roster reads.

## How to apply

### If your DB is in sync with migrations

```bash
npx prisma migrate deploy
```

### If you have migration drift (DB has tables not in migrations)

Prisma may refuse to run migrations. Options:

1. **Development only (data loss OK):**
   ```bash
   npx prisma migrate reset
   ```

2. **Preserve data – baseline then migrate:**
   - Create a baseline migration that matches your current DB:  
     `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_baseline/migration.sql`
   - Mark applied:  
     `npx prisma migrate resolve --applied 0_baseline`
   - Deploy new migrations:  
     `npx prisma migrate deploy`

3. **Schema-only sync (no migration history):**
   ```bash
   npx prisma db push
   ```
   Applies schema changes without creating migration files.

## Changes by file

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `sortOrder`, `@@index([leagueId, memberId, sortOrder])` |
| `src/app/api/leagues/[id]/roster/[userId]/route.ts` | GET reads from LeagueRosterPlayer; PUT syncs player list to LeagueRosterPlayer atomically |
| `src/services/rosterService.ts` | LeagueRosterPlayer is primary; syncs to LeagueRoster.playerIds |
| `src/services/tradeService.ts` | Creates LeagueRosterPlayer with sortOrder |
| `src/app/api/leagues/[id]/actions/[userId]/route.ts` | Captain/roster checks use LeagueRosterPlayer; optimizeLineup fixed |
| `Scripts/*` | Inserts include sortOrder |
| `src/lib/ensureLobbyColumns.ts` | CREATE TABLE includes sortOrder |
