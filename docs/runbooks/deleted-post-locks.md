# Deleted posts left locked (bug report #12)

## Status

Read-only check plus an approved repair. The query below writes nothing. The update needs the owner's
approval after the list has been reviewed. There is no production fantasy database yet; run this against
the database that holds the affected leagues (today the development PostgreSQL on the grading VM), never
`prisma/dev.db`.

## The problem

Deleting a post used to set its lock. Restoring it left it locked, so replies stayed blocked. The code no
longer sets the lock. Posts deleted before the fix can still be locked. Replies stay blocked while a post
is deleted, so the lock only matters after restore.

## Find the affected posts (read only)

```sql
SELECT id, "leagueId", "seasonId", "deletedAt", "lockedAt"
FROM "SocialPost"
WHERE "deletedAt" IS NOT NULL
  AND "isLocked" = true
  AND "lockedAt" BETWEEN "deletedAt" - interval '1 second' AND "deletedAt" + interval '1 second';
```

The old delete set `lockedAt` and `deletedAt` in the same transaction, so they fall within one second. A
post a moderator locked just before removing it can match this window. Review the list before the update.

## Repair (after approval)

Run the update inside a transaction and check the row count against the reviewed list:

```sql
BEGIN;
UPDATE "SocialPost"
SET "isLocked" = false, "lockedAt" = NULL
WHERE id IN (/* reviewed ids */);
-- expect the reviewed count; ROLLBACK if it differs
COMMIT;
```
