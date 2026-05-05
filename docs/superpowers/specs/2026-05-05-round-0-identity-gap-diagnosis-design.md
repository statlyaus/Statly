# Round 0 Identity Gap Diagnosis Design

## Purpose

Diagnose why the 2026 round 0 player read-model refresh cannot materialize player projections from Firestore `player_match_stats`.

This is a verification-first diagnostic workflow. It must explain the current identity gap without repairing data, replaying unresolved rows, rewriting Firestore documents, or adding projection fallbacks.

## Background

The local schema blocker for player projection runtime tables has been fixed, and the read-model refresh now completes without Prisma missing-table errors. The refresh still produces zero player projections because Firestore rows are skipped with `skippedWithoutCanonicalId`.

For the observed 2026 refresh, `4,498` Firestore rows were skipped because they lacked a usable canonical player identity. The first diagnostic scope is bounded to `season=2026`, `round=0`.

Repo guidance that applies:

- `docs/DATA_RELIABILITY.md` requires Firestore `player_match_stats`, canonical `player_id`, and matching Prisma `Player.id` for Lane A read models.
- `docs/PLAYER_IDENTITY_PIPELINE_PROTOCOL.md` treats `skippedWithoutCanonicalId` as the primary health signal for missing canonical identity in downstream event data.
- `docs/FOOTYWIRE_DATA_ARCHITECTURE_REVIEW.md` says downstream readers should validate convergence against the canonical raw contract instead of compensating with parallel fallback readers.

External data-quality practice supports treating this as a reusable validation checkpoint: explicit assertions, saved validation results, human-readable docs, and dataset-shaped evidence for filtering and review.

## Scope

In scope:

- Read Firestore `player_match_stats` for `season=2026`, `round=0`.
- Read Prisma `Player`, `PlayerAlias`, and `UnresolvedPlayerStatRow`.
- Classify every scoped Firestore row into one identity or context outcome.
- Produce a JSON summary for automation.
- Produce a grouped human-readable report for triage.
- Produce a dataset-shaped row export, preferably JSONL first and CSV as a secondary option.
- Include the existing verifier command as supporting evidence.

Out of scope:

- Adding aliases.
- Adding players.
- Replaying unresolved rows.
- Backfilling or rewriting Firestore `player_id`.
- Rebuilding projections as a repair step.
- Changing read-model fallback behavior.
- Uploading to Hugging Face automatically.

Optional follow-up:

- Publish the exported diagnostic rows as a private Hugging Face dataset with a dataset card if the local artifact proves useful for review.

## Diagnostic Assertions

The checkpoint should evaluate these assertions for each scoped Firestore row:

1. The row has a usable round value matching `round=0`.
2. The row has enough match context to identify its source match or explain why it cannot.
3. A canonical Firestore row should have non-null `player_id`.
4. A non-null `player_id` should match an existing Prisma `Player.id`.
5. If `player_id` is missing, the current identity resolver should either resolve exactly one Prisma player or explain why it cannot.
6. If the unresolved queue contains matching unresolved identity rows, the diagnostic should surface that state instead of hiding it.

These are diagnostic assertions, not repair gates. The output should report pass/fail counts and row-level reasons.

## Classification Model

Each row should receive exactly one primary classification:

- `canonical_player_id_ok`: `player_id` exists and matches Prisma `Player.id`.
- `missing_player_id_resolvable`: `player_id` is missing, but current resolver maps the row to exactly one Prisma player.
- `missing_player_id_unresolved`: `player_id` is missing and resolver finds no safe player.
- `player_id_not_in_prisma`: `player_id` exists but does not match any Prisma `Player.id`.
- `ambiguous_or_quarantined`: resolver or unresolved queue indicates ambiguity or prior quarantine state.
- `match_context_issue`: player identity may be resolvable, but round or match context is missing or inconsistent enough to block projection.

Rows may also carry secondary flags such as `has_canonical_stats`, `has_raw_row`, `has_unresolved_queue_match`, `resolver_used_alias`, and `resolver_candidate_count`.

## Output Shape

The JSON summary should include:

- `ok`
- `season`
- `rounds`
- `firestoreRowCount`
- `classificationCounts`
- `assertionCounts`
- `topGroups`
- `sampleRows`
- `supportingVerifierCommand`
- `generatedAt`

The row export should include one row per Firestore document with these columns:

- `doc_id`
- `season`
- `round`
- `match_id`
- `storage_match_id`
- `player_name`
- `team`
- `opponent`
- `stored_player_id`
- `classification`
- `secondary_flags`
- `resolved_player_id`
- `resolved_player_name`
- `candidate_player_ids`
- `unresolved_queue_statuses`
- `source`
- `has_canonical_stats`
- `has_raw_row`
- `updated_at`

The grouped report should group by:

- classification
- player name and team
- match id or storage match id
- source

Sample document ids should be capped so the report stays readable.

## Data Flow

1. Parse `--season`, `--rounds`, `--limit`, and output-format flags.
2. Query Firestore `player_match_stats` for the requested season, then filter to the requested round or rounds using the same round-field conventions used by read-model code.
3. Load Prisma players and aliases once.
4. Load active unresolved rows for the requested season, then index by normalized player name, team, source, and source document id where available.
5. For each Firestore document:
   - read stored canonical player id
   - read player name, team, source, match, and round metadata
   - check direct Prisma player match
   - run the existing identity resolver in read-only mode when needed
   - check unresolved queue evidence
   - assign primary classification and secondary flags
6. Aggregate counts and top groups.
7. Write or print JSON summary, human report, and optional row export.

## Error Handling

The diagnostic should fail fast for configuration errors such as invalid season, invalid rounds, or unavailable Firestore credentials.

For row-level data defects, it should not throw. It should classify the row and include the defect in output.

If Firestore has zero rows for the requested scope, the output should explicitly report `firestoreRowCount: 0` and classify the run as successful but empty.

## Hugging Face Dataset Option

The first implementation should write local JSONL or CSV. Uploading to Hugging Face should remain manual or a later explicit workflow.

If published later, the dataset should be private by default and include a dataset card describing:

- source systems
- diagnostic scope
- generated timestamp
- privacy considerations
- column meanings
- non-goals and limitations

This keeps the artifact useful for Dataset Viewer filtering, statistics, and SQL-style inspection without making publication a prerequisite.

## Verification Plan

Run the diagnostic for:

```bash
npx tsx Scripts/diagnose-player-identity-gaps.ts --season=2026 --rounds=0 --json
```

Supporting verifier:

```bash
npx tsx Scripts/verify-player-read-models.ts --season=2026 --rounds=0 --include-merged-live --json
```

Expected verification outcomes:

- The diagnostic accounts for every Firestore row in 2026 round 0.
- Classification counts sum to `firestoreRowCount`.
- The workflow performs no writes to Firestore or Prisma.
- Existing `/players` behavior is not changed by this diagnostic.
- The report clearly separates persisted identity gaps from resolver gaps and match-context gaps.

## Implemented Command

Implemented files:

- `src/server/diagnostics/playerIdentityGapDiagnosis.ts`
- `src/server/diagnostics/playerIdentityGapDiagnosis.test.ts`
- `Scripts/diagnose-player-identity-gaps.ts`
- `package.json` script: `diagnose:player-identity-gaps`

The diagnostic remains read-only. It loads Firestore rows, Prisma player identity data, and unresolved queue evidence through injected dependencies, then writes optional local JSONL or CSV artifacts. It does not repair aliases, add players, update Firestore, update Prisma, or rebuild projections.

Verified command:

```bash
npm run diagnose:player-identity-gaps -- --season=2026 --rounds=0 --json --output-jsonl tmp/identity-gap-2026-r0.jsonl --output-csv tmp/identity-gap-2026-r0.csv
```

Observed 2026 round 0 result:

- `firestoreRowCount`: `236`
- `classificationCounts.player_id_not_in_prisma`: `236`
- all other classification counts: `0`
- `rowsWithStoredPlayerId`: `236`
- `rowsWithStoredPlayerIdInPrisma`: `0`
- artifact paths: `tmp/identity-gap-2026-r0.jsonl`, `tmp/identity-gap-2026-r0.csv`

This means the scoped round 0 failure is not missing canonical identity on those Firestore rows. The rows have stored `player_id` values, but those values do not match the current Prisma `Player.id` set, so read-model materialization correctly refuses to project them.

## Risks And Mitigations

Risk: Firestore round fields are inconsistent.

Mitigation: report the exact fields used for round detection and classify unclear rows as `match_context_issue`.

Risk: resolver behavior changes while the report is being used.

Mitigation: include generated timestamp and enough row-level evidence to reproduce the run.

Risk: dataset export contains operationally sensitive data.

Mitigation: keep artifacts local by default and require explicit private-publication approval for Hugging Face.

Risk: diagnosis becomes a repair path.

Mitigation: keep the script read-only, name outputs as diagnostics, and require a separate repair plan after reviewing evidence.

## Approval Gate

After this spec is approved, the next step is to create an implementation plan. The implementation plan should keep the first version narrow: one read-only diagnostic script plus focused verification.
