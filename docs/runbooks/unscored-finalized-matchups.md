# Unscored finalized matchups (bug report #10)

## Status

Inventory only. Nothing in this runbook writes to the database. A repair is a separate step that needs
the owner's approval after the inventory has been reviewed.

## The problem

A round can be marked `FINAL` while one side of a regular-season matchup has no `FINAL` score row, so
that matchup is missing from the standings. The cause is fixed in code (a round finalizes only when every
matchup with two teams is scored). Rounds finalized before the fix still need repair.

## Which database

There is no production fantasy database yet. Go-live is on hold, and the managed PostgreSQL in
`docs/runbooks/postgresql-cutover.md` is not provisioned. Run the inventory against the database that
actually holds the affected leagues. Today that is the development PostgreSQL on the grading VM. Once the
cutover happens, it is the production database. Never point it at `prisma/dev.db`.

## Prerequisites

- A database role with `SELECT` only on the tables the script reads. The script also opens a
  `READ ONLY` transaction, so an accidental write fails even with a broader role.
- `DATABASE_URL` exported in the shell from the secret store. Do not put it in a file in the repository.

## Run the inventory

```bash
npx tsx Scripts/repair/inventory-unscored-finalized-matchups.ts --out /secure/path/inventory-YYYY-MM-DD.ndjson
```

The output file must not exist (the script refuses to overwrite) and must sit outside the repository.
Rounds are read in batches of 100 by round ID. Each batch is its own read-only transaction, so the whole
inventory is not one snapshot: a round finalized or scored while the script runs may be missed or
reported. Re-run after the run if that matters. AFL timing calls run between batches, outside any
transaction.

## How rows are scoped

- **Matchups** come from the competition round itself (`LeagueMatchup.competitionRoundId`). Legacy
  matchups with no link are matched by league, fixture version and round number.
- **Lineups** are keyed by league, member and round number only. They carry no season or fixture version.
  When the league has another competition round with the same round number (another season or fixture
  version), the lineup found may belong to that round. The side is then reported as
  `LINEUP_SCOPE_AMBIGUOUS` and not classified.
- **Set time** is per player (`LeagueLineupPlayer.createdAt`), not the lineup's first save. A save deletes
  and recreates every player whose game has not started and keeps players whose game has, so a player's
  `createdAt` is the last save that set that player.

## Reading the output

One NDJSON line per unscored side. The summary printed at the end counts the classifications.

| Classification           | Meaning                                                                          | Next step                                                 |
| ------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `NO_LINEUP`              | The member never saved a lineup for the round.                                   | Decide with the owner. Nothing was scored for that side.  |
| `EMPTY_LINEUP`           | A lineup was saved with no players.                                              | Decide with the owner separately from `NO_LINEUP`.        |
| `LINEUP_SCOPE_AMBIGUOUS` | Another round of the league shares the round number; the lineup may be its.      | Identify the lineup by hand. Do not repair automatically. |
| `LATE_SET`               | At least one player was set after that player's game started.                    | The repair rule applies (below).                          |
| `PRE_START_SET`          | Every player was set before their game. It should already have scored.           | Investigate separately. This is not the known bug.        |
| `UNKNOWN_START`          | A player has no game start in the AFL timing data (for example a club mismatch). | Resolve the player or timing data before any repair.      |
| `TIMING_UNAVAILABLE`     | Official timing could not be loaded, or the season year is missing.              | Re-run for these rounds. Do not repair them.              |

`edited: true` means the lineup changed more than a minute after it was first saved. It is informational:
each player is already judged by its own set time.

## Repair rule (for the write step, once approved)

For a `LATE_SET` side, each player set after their game started scores zero. Every other player scores
normally. The other side of the matchup is unchanged. Each repaired matchup is then scored, its round
standings are rebuilt, and each change is recorded in an audit row.

Do not re-run recalculation on an affected round before its repair. The current code keeps the round open
while a matchup is unscored. Re-running recalculation could therefore lower scores that are already
recorded for that round.

The write step runs per league in batches, is idempotent (a matchup already scored is skipped), and runs
against a dry-run report of the proposed scores first.
