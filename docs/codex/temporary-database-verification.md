# Temporary Database Verification

## Purpose

Use this runbook when a Statly PR needs browser, API, or local full-stack smoke
verification that may create, delete, or repair fixture data. The verification
database must be disposable and must not mutate the protected local
`prisma/dev.db`.

This is a verification workflow only. It does not change product runtime
behavior, Prisma schema, Firebase configuration, or local secrets.

## When To Use

- A PR changes draft, roster, waiver, league, auth, or API behavior and needs a
  local smoke check.
- A browser or API flow would create drafts, leagues, users, picks, roster rows,
  or waiver data.
- A previous verification note says full local smoke was skipped because
  `prisma/dev.db` was protected.

## When Not To Use

- Unit-only or static documentation changes where runtime smoke adds no useful
  evidence.
- Flows that require real production credentials, real Firebase data, or real
  secrets.
- Any script that ignores `DATABASE_URL` or tries to write to protected local
  files.

## Protected State

Never touch:

- `prisma/dev.db`
- `.env` or `.env.*`
- secrets or `serviceAccountKey.json`
- Firebase exports
- generated `functions/lib` files
- dataconnect local data
- `node_modules`, `dist`, `coverage`, or `test-results`
- local stashes

## Safe Database Path

Use a disposable SQLite database under `/tmp`:

```bash
export STATLY_VERIFY_DB="/tmp/statly-verify-$(date +%Y%m%d%H%M%S).db"
export DATABASE_URL="file://${STATLY_VERIFY_DB}"
echo "STATLY_VERIFY_DB=${STATLY_VERIFY_DB}"
```

Do not use `file:./prisma/dev.db`, `file:prisma/dev.db`, or any path inside the
repository for destructive smoke verification.

## Local Full-Stack Smoke

The local stack inherits `DATABASE_URL`. `Scripts/dev/full-local-stack.sh` runs
Prisma migration and local seeding without assigning its own database URL, so a
temp database can be selected by the caller.

Terminal 1:

```bash
export STATLY_VERIFY_DB="/tmp/statly-verify-$(date +%Y%m%d%H%M%S).db"
export DATABASE_URL="file://${STATLY_VERIFY_DB}"
echo "STATLY_VERIFY_DB=${STATLY_VERIFY_DB}"
npm run dev:full:local
```

Wait for the app, Socket.IO, draft worker, Firebase Auth emulator, and Firestore
emulator to be ready.

Terminal 2:

```bash
# Paste the exact value printed by Terminal 1.
export STATLY_VERIFY_DB="/tmp/statly-verify-20260620193000.db"
export DATABASE_URL="file://${STATLY_VERIFY_DB}"
npm run dev:smoke:local
```

Use the exact same `STATLY_VERIFY_DB` path from Terminal 1.

The smoke check verifies:

- Next app availability;
- Socket.IO health;
- Firebase Auth emulator sign-in;
- Firestore emulator seeded user;
- full local test draft creation through `/api/create-test-draft`.

## Confirm `prisma/dev.db` Was Not Modified

Before verification:

```bash
git status --short -- prisma/dev.db
if [ -f prisma/dev.db ]; then
  stat -f "%m %z %N" prisma/dev.db 2>/dev/null || stat -c "%Y %s %n" prisma/dev.db
fi
```

After verification:

```bash
git status --short -- prisma/dev.db
if [ -f prisma/dev.db ]; then
  stat -f "%m %z %N" prisma/dev.db 2>/dev/null || stat -c "%Y %s %n" prisma/dev.db
fi
git status --short --branch
```

Expected result:

- `git status --short -- prisma/dev.db` prints no output.
- `git status --short --branch` shows no protected or generated file changes.
- The temporary database path is outside the repository, for example
  `/tmp/statly-verify-20260620193000.db`.

## Stop Conditions

Stop immediately if:

- a script prints or writes `prisma/dev.db`;
- `git status --short -- prisma/dev.db` shows a change;
- `DATABASE_URL` is missing or points inside the repository;
- a command asks for real secrets or production Firebase credentials;
- generated files, Firebase exports, dataconnect local data, `coverage`, or
  `test-results` appear in the diff;
- a smoke flow needs product changes beyond verification.

If any stop condition happens, kill the local stack, do not continue smoke
testing, and report the residual risk.

## Cleanup

After the smoke run:

```bash
npm run dev:down
rm -f "$STATLY_VERIFY_DB"
```

Remove only the temporary database created for this verification run. Do not drop
local stashes, delete branches, or remove existing user files.

## Reporting

A final PR report should include:

- the temp database path used;
- the exact commands run;
- smoke/browser/API results;
- confirmation that `prisma/dev.db` was unchanged;
- any skipped browser/API coverage and residual risk.
