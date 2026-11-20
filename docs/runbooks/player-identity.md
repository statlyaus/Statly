# Canonical player identity consolidation

This migration removes duplicate `Player` rows while preserving ownership independently in every
league. It is deliberately a reviewed data operation: name and club matches are candidate evidence,
not proof that two records represent the same person.

## Rollout order

1. Deploy the additive `PlayerExternalIdentity` schema and application compatibility code.
2. Put roster, draft, waiver, lineup, and trade mutations into maintenance mode.
3. Take a `pg_dump` backup outside the repository and verify that it restores into a scratch
   database.
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

Set `DATABASE_URL` and `STATLY_PLAYER_IDENTITY_PRODUCTION_DB` to the same production
`postgresql://` address. The command rejects non-PostgreSQL addresses, a host or database name that
differs between the two, and the `statly_fantasy_dev` and `statly_fantasy_test` databases.

Practice runs without `--production` need `DATABASE_URL` and `STATLY_VERIFY_DB` set to the same
disposable database whose name starts with `statly_verify_player_`.

Generate the proposal:

```sh
npm run player-identity:consolidate -- --production --propose > player-identity-manifest.json
```

Review the plan without changing data:

```sh
npm run player-identity:consolidate -- --production --manifest player-identity-manifest.json
```

For apply, also set `STATLY_PLAYER_IDENTITY_BACKUP` to the verified `pg_dump` file (non-empty and less than 24
hours old) and set
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
PostgreSQL.

## Rollback

1. Keep maintenance mode enabled and stop all roster, draft, waiver, lineup, and trade writes.
2. Restore the verified `pg_dump` backup as the complete relational source of truth.
3. Run the standalone `--production --project-waivers` command with
   `STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT` still pinned to the paired Firebase project. This
   rebuilds Firestore from the restored relational state.
4. Verify the restored player rows, league-scoped ownership, waiver availability, and Firestore
   ownership documents together.
5. Re-enable writes only after both stores agree.

Never restore PostgreSQL or Firestore independently; the waiver projection must be regenerated after a
relational rollback.

## Footywire stats identity

The ETL keys every `player_match_stats` row by its own Footywire player id (`player_uid`, for
example `ply_marcus_bontempelli`), not by a Statly `Player.id`. Live matchup totals
(`loadLivePlayerTotalsForRound`) turn that id into a Statly player only through a reviewed
`PlayerExternalIdentity` row with provider `footywire` and a recorded `verifiedAt`. A row with no
reviewed link keeps the ETL id, reaches no Statly player, and is logged as unlinked. The read path
never matches by name.

Links are written only by this reviewed operation. It never merges, edits or deletes `Player` rows,
and it never moves an existing link.

1. Generate a proposal from one season's ETL stats. This reads Firestore and the database; it
   writes nothing. `STATLY_PLAYER_IDENTITY_FIRESTORE_PROJECT` must name the Firebase project paired
   with the database:

   ```sh
   npm run player-identity:footywire -- --production --propose --season 2026 > footywire-identity.json
   ```

   `mappings` lists ETL players whose normalized name and club match exactly one Statly player with
   no Footywire link yet. `unmatched` lists every other ETL player with `NO_CANDIDATE` or
   `AMBIGUOUS` and its candidate ids. These are the players to review.

2. Review every mapping and every unmatched player. Remove wrong mappings and add reviewed ones as
   `{ "externalId": ..., "playerId": ... }`. Then set `reviewed` to `true` and fill in `reviewedBy`
   and `reviewedAt` (ISO time).
3. Check the plan. It writes nothing, and it exits non-zero when anything is blocked:

   ```sh
   npm run player-identity:footywire -- --production --manifest footywire-identity.json
   ```

   Blockers are:
   - an ETL id already linked to a different player;
   - a player who already has a different Footywire id;
   - an ETL id mapped twice;
   - a player id that does not exist.

   Fix the manifest. Do not bypass a blocker.

4. Apply. One serializable transaction writes every new link with `verifiedAt` = `reviewedAt`, or
   none:

   ```sh
   npm run player-identity:footywire -- --production --manifest footywire-identity.json --apply
   ```

Without `--production`, the command needs the disposable `statly_verify_player_*` database
described above. To undo an apply, delete the `footywire` rows carrying that manifest's `verifiedAt`.
Nothing else was changed.

The ETL id is the slugged player name, so two AFL players with the same name share one id. The
proposal reads every club each id was seen at in the season and reports an id seen at more than one
club as `AMBIGUOUS`, with the candidates from each club. Do not link it until the ETL carries a
distinguishing id. Two namesakes at the same club cannot be told apart this way; they show as
`AMBIGUOUS` only when Statly has both players.

## Player season stat totals

Each player's season totals live in Prisma `PlayerSeasonStat`, keyed on the canonical `Player.id`.
A fill builds them from one season's `player_match_stats` through the reviewed `footywire` links
above. A stat row without a link is listed under `unlinked` and left out. An ETL id seen at more
than one club in the season is two namesakes sharing an id: it is listed under `ambiguous` and left
out, linked or not. Nothing is matched by name.

Fill only after the round's games are final: the ETL also stores live games, and a run with row
errors still stores the rows it could read.

1. Check what the fill would write. It reads Firestore and the database and writes nothing. It
   prints how many linked players it would write and how many stored rows they would replace,
   and lists every unlinked or ambiguous ETL player:

   ```sh
   npm run player-season-stats:fill -- --production --season 2026
   ```

2. Link any `unlinked` player with the Footywire identity steps above, then fill:

   ```sh
   npm run player-season-stats:fill -- --production --season 2026 --apply
   ```

   One transaction deletes the season's rows and writes the new ones, so a fill can be repeated
   after every round. Other seasons are untouched. A fill with no linked player is refused rather
   than emptying the season. To undo, fill the season again; the table holds nothing the ETL does
   not.

Without `--production`, the command needs the disposable `statly_verify_player_*` database
described above.

Go-live prerequisite: the fill and the links attach stats to existing `Player` rows only. No
production job creates `Player` rows yet, so an ETL player with no Statly player stays `NO_CANDIDATE`
in the proposal and out of the totals.
