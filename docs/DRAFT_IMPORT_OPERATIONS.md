# Draft Trades Import Operations

This runbook covers production-safe Draft Trades imports with dataset versioning and rollback.

## Import modes

- `live` dataset (default): writes to `draftTrades`, `draftClubs`, `draftMeta`.
- versioned dataset (recommended): writes to suffixed collections, for example:
  - `draftTrades_2026w10`
  - `draftClubs_2026w10`
  - `draftMeta_2026w10`

When imports run with activation enabled, the script updates `draftMeta/currentVersion` so reads switch to the new dataset.

## Script options

Use:

`npm run import:draft-trades -- --trades=... --parties=... --assets=...`

Additional options:

- `--dataset=<id>`: dataset identifier (`live` by default)
- `--no-activate`: write the dataset but do not move pointer
- `--dry-run`: validate pipeline without writes

## Recommended deployment workflow

1. Import into versioned dataset without activation:
   - `npm run import:draft-trades -- --dataset=2026w10 --no-activate --trades=... --parties=... --assets=...`
2. Validate:
   - check `draftMeta_2026w10/importRuns/runs/*` status
   - spot-check trade rows and club pages
3. Activate:
   - rerun without `--no-activate`, or write `draftMeta/currentVersion` manually.

## Pointer contract

`draftMeta/currentVersion`:

- `datasetId`
- `collections.trades`
- `collections.clubs`
- `collections.meta`
- `importVersion`
- `activatedAt`

All Draft read paths resolve collections from this pointer with safe fallback to base collection names.

## Rollback

Rollback is pointer-only:

1. Identify last known-good dataset id.
2. Update `draftMeta/currentVersion.collections` to that dataset’s collections.
3. No data copy required.

## Cloud Run Job recommendation

Use a Cloud Run Job for repeatable imports:

1. Build image with this repo.
2. Configure env:
   - `FIREBASE_PROJECT_ID` (or ADC project)
   - service account with Firestore write permissions
3. Execute with args:
   - `--dataset=<release-id> --trades=gs://... --parties=gs://... --assets=gs://...`

Prefer release-style dataset ids (`YYYYwNN`, git sha, or timestamp) for easy rollback tracking.

