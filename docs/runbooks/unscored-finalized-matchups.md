# Unscored finalized matchups and deleted-post locks (bug report #10 and #12)

## Status

Inventory only. Nothing in this runbook writes to the database. A repair is a separate step that needs
the owner's approval after the inventory has been reviewed.

## #10: unscored sides in finalized rounds

A round can be marked `FINAL` while one side of a regular-season matchup has no `FINAL` score row, so
that matchup is missing from the standings. The cause is fixed in code (a round finalizes only when every
matchup with two teams is scored). Rounds finalized before the fix still need repair.

### Prerequisites

- A database role with `SELECT` only on the tables the script reads. The script also opens a
  `READ ONLY` transaction, so an accidental write fails even with a broader role.
- `DATABASE_URL` exported in the shell from the secret store. Do not put it in a file in the repository.
- Never point this at `prisma/dev.db`.

### Run the inventory

```bash
npx tsx Scripts/repair/inventory-unscored-finalized-matchups.ts --out /secure/path/inventory-YYYY-MM-DD.ndjson
```

The output file must not exist (the script refuses to overwrite) and must sit outside the repository.
Rounds are read in batches of 100 by round ID, each batch in its own read-only transaction. AFL timing
calls run between batches.

### Reading the output

One NDJSON line per unscored side. The summary printed at the end counts the classifications.

| Classification       | Meaning                                                                          | Next step                                                |
| -------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `NO_LINEUP`          | The member never saved a lineup for the round.                                   | Decide with the owner. Nothing was scored for that side. |
| `LATE_SET`           | The lineup was saved after at least one player's game started.                   | The repair rule applies (below).                         |
| `PRE_START_SET`      | The lineup was saved before every game. It should already have scored.           | Investigate separately. This is not the known bug.       |
| `UNKNOWN_START`      | A player has no game start in the AFL timing data (for example a club mismatch). | Resolve the player or timing data before any repair.     |
| `TIMING_UNAVAILABLE` | Official timing could not be loaded, or the season year is missing.              | Re-run for these rounds. Do not repair them.             |

Check `edited: true` lines by hand. Their `lineupCreatedAt` may not be the time the lineup was set.

### Repair rule (for the write step, once approved)

For a `LATE_SET` side, each player whose game started before the lineup was saved scores zero. Every other
player scores normally. The other side of the matchup is unchanged. Each repaired matchup is then scored,
its round standings are rebuilt, and each change is recorded in an audit row.

Do not re-run recalculation on an affected round before its repair. The current code keeps the round open
while a matchup is unscored. Re-running recalculation could therefore lower scores that are already
recorded for that round.

The write step runs per league in batches, is idempotent (a matchup already scored is skipped), and runs
against a dry-run report of the proposed scores first.

## #12: deleted posts left locked

Deleting a post used to set its lock. Restoring it left it locked, so replies stayed blocked. The code no
longer sets the lock. Posts deleted before the fix can still be locked. Replies stay blocked while a post
is deleted, so the lock only matters after restore.

### Find the affected posts (read only)

```sql
SELECT id, "leagueId", "deletedAt", "lockedAt"
FROM "SocialPost"
WHERE "deletedAt" IS NOT NULL
  AND "isLocked" = true
  AND "lockedAt" BETWEEN "deletedAt" - interval '1 second' AND "deletedAt" + interval '1 second';
```

The old delete set `lockedAt` and `deletedAt` in the same transaction, so they fall within one second. A
post a moderator locked just before removing it can match this window. Review the list before the update.

### Repair (after approval)

Run the update inside a transaction and check the row count against the reviewed list:

```sql
BEGIN;
UPDATE "SocialPost"
SET "isLocked" = false, "lockedAt" = NULL
WHERE id IN (/* reviewed ids */);
-- expect the reviewed count; ROLLBACK if it differs
COMMIT;
```
