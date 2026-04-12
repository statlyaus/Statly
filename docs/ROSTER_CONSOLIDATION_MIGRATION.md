# Roster consolidation migration

## Summary

`LeagueRosterPlayer` is the **single source of truth** for roster ownership and lineup order.

`LeagueRoster` is metadata-only:

- `captainId`
- `viceCaptainId`
- `benchOrder`
- timestamps and member linkage

`LeagueRoster.playerIds` is no longer part of the supported schema or runtime path.

## Long-Term Contract

These invariants now define a healthy roster model:

1. Every roster-changing write updates `LeagueRosterPlayer` transactionally.
2. A player can belong to at most one member in the same league.
3. Active and completed leagues cannot have members with zero normalized roster players unless that state is explicitly under repair.
4. `LeagueRoster` must never be used to reconstruct ownership.
5. Operational repair tooling may reconstruct ownership only from supported sources:
   - existing normalized rows
   - draft picks
   - explicit synthetic allocation for disposable/test leagues

## Relevant Migrations

- `20260220000000_add_roster_sort_order`
  - Adds `sortOrder` to `LeagueRosterPlayer` for deterministic lineup ordering.
- `20260403120500_drop_league_roster_player_ids`
  - Removes legacy `LeagueRoster.playerIds`.

## Deploy Runbook

### 1. Apply schema migrations

```bash
npx prisma migrate deploy
```

### 2. Audit normalized ownership integrity

```bash
npx tsx Scripts/auditLeagueRosterOwnership.ts
```

Expected healthy result:

- `missingOwnership=false`
- `duplicateOwnership=false`
- `orphanedRosterPlayers=0`

### 3. Repair only if audit reports drift

Supported repair flows:

- Rebuild from draft-derived ownership:

  ```bash
  npx tsx Scripts/auditLeagueRosterOwnership.ts --repair --bootstrap-season=2026
  ```

- Rebuild disposable/test leagues with unique synthetic ownership:
  ```bash
  npx tsx Scripts/auditLeagueRosterOwnership.ts --repair --fill-random --bootstrap-season=2026
  ```

Notes:

- `--fill-random` is for disposable/test environments only.
- Synthetic repair now allocates league-wide unique players, not per-member random overlap.

### 4. Verify health after deploy

Check `/api/health` and ensure `rosterOwnership` is `healthy`.

The health check now degrades on:

- leagues with missing normalized members
- duplicate player ownership within a league
- orphaned `LeagueRosterPlayer` rows
- active/completed leagues with empty members

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

| File                                                 | Change                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `prisma/schema.prisma`                               | `LeagueRoster` is metadata-only; ownership lives in `LeagueRosterPlayer` |
| `src/app/api/leagues/[id]/roster/[userId]/route.ts`  | GET/PUT use normalized ownership and metadata upsert                     |
| `src/services/rosterService.ts`                      | Ownership/order writes target `LeagueRosterPlayer` only                  |
| `src/services/tradeService.ts`                       | Trade execution swaps normalized ownership and sanitizes metadata        |
| `src/app/api/leagues/[id]/actions/[userId]/route.ts` | Roster membership checks use normalized ownership                        |
| `src/lib/leagueSeason.ts`                            | Matchup and season-state roster reads use normalized ownership only      |
| `src/lib/leagueRosterOwnershipHealth.ts`             | Health checks enforce normalized ownership invariants                    |
| `Scripts/auditLeagueRosterOwnership.ts`              | Audit/repair tool for normalized ownership integrity                     |
| `src/lib/ensureLobbyColumns.ts`                      | Runtime table bootstrap creates metadata-only `LeagueRoster`             |

## Recovery Policy

If normalized ownership is corrupted:

1. Audit the environment.
2. Prefer repair from draft picks.
3. Re-bootstrap affected seasons after repair.
4. Use synthetic repair only for disposable data.
5. Do not reintroduce legacy ownership fields to unblock runtime reads.
