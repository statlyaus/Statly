# Canonical player identity consolidation

This migration removes duplicate `Player` rows while preserving ownership independently in every
league. It is deliberately a reviewed data operation: name and club matches are candidate evidence,
not proof that two records represent the same person.

## Rollout order

1. Deploy the additive `PlayerExternalIdentity` schema and application compatibility code.
2. Put roster, draft, waiver, lineup, and trade mutations into maintenance mode.
3. Create a SQLite backup outside the repository and verify that it opens successfully.
4. Generate a proposal from the production database.
5. Review every mapping. Set `reviewed` to `true`, and fill in `reviewedBy` and `reviewedAt` without
   changing `sourceFingerprint`.
6. Run the planner. Any blocker must be resolved by correcting the manifest or underlying data; do
   not bypass blockers.
7. Apply the same reviewed manifest while writes remain paused.
8. Confirm the apply output reports every league projected, then re-enable writes.

The planner blocks same-league ownership conflicts across both normalized and legacy roster data,
pending actions that still reference aliases, malformed legacy rosters, and unsafe relational
collisions. Ownership in different leagues is expected and remains separate.

## Commands

Set `DATABASE_URL` and `STATLY_PLAYER_IDENTITY_PRODUCTION_DB` to the same absolute production SQLite
file. The command rejects the repository's `prisma/dev.db`, URL options, symlinks, and mismatched
paths.

Generate the proposal:

```sh
npm run player-identity:consolidate -- --production --propose > player-identity-manifest.json
```

Review the plan without changing data:

```sh
npm run player-identity:consolidate -- --production --manifest player-identity-manifest.json
```

For apply, also set `STATLY_PLAYER_IDENTITY_BACKUP` to the separate, verified backup file and set
`STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT` to the exact Firebase project ID paired with this
production database. The command checks the resolved Firestore client before changing relational
data or projecting waivers:

```sh
npm run player-identity:consolidate -- --production --manifest player-identity-manifest.json --apply
```

Apply aborts if the player dataset fingerprint changed after proposal. Generate and review a new
manifest instead of editing the fingerprint.

Production apply also rebuilds every league's Firestore waiver projection. If that projection fails
after the relational transaction commits, rerun it independently before re-enabling writes:

```sh
npm run player-identity:consolidate -- --production --project-waivers
```

## Verification

- The command reports every reviewed mapping as applied.
- No retired alias remains in mutable player foreign keys.
- A player can have at most one normalized owner per league; ownership in other leagues is unchanged.
- Draft, queue, roster, waiver, lineup, trade, and player-detail requests accept a retired alias but
  persist or return the canonical ID.
- Waiver lists show one row per canonical player and exclude every player owned in that league.
- Historical trade snapshots, completed actions, and social records are not rewritten.

If relational apply succeeds but a Firestore projection fails, keep the backup and use the standalone
projection command before declaring the rollout complete. Do not restore only Firestore or only
SQLite.

## Rollback

1. Keep maintenance mode enabled and stop all roster, draft, waiver, lineup, and trade writes.
2. Restore the verified SQLite backup as the complete relational source of truth.
3. Run the standalone `--production --project-waivers` command with
   `STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT` still pinned to the paired Firebase project. This
   rebuilds Firestore from the restored relational state.
4. Verify the restored player rows, league-scoped ownership, waiver availability, and Firestore
   ownership documents together.
5. Re-enable writes only after both stores agree.

Never restore SQLite or Firestore independently; the waiver projection must be regenerated after a
relational rollback.
