#!/bin/bash
set -euo pipefail

SEASONS="${SEASONS:-2023,2024,2025}"
OUTFILE="${OUTFILE:-/tmp/player_stats_fryzigg_backfill.json}"

export SEASON="${SEASONS}"
export OUTFILE="${OUTFILE}"
export DATA_SOURCE="fryzigg"
export BACKFILL_MODE="true"

echo "📥 Fetching Fryzigg stats for seasons: ${SEASONS}"
Rscript fetch_fw_round.R "${SEASONS}"

if [ ! -s "${OUTFILE}" ]; then
  echo "❌ Expected NDJSON output at ${OUTFILE}, but file is empty or missing."
  exit 1
fi

TOTAL_LINES=$(wc -l < "${OUTFILE}" | tr -d ' ')
echo "✅ NDJSON rows: ${TOTAL_LINES}"
echo "📤 Ingesting into Firestore..."

node dist/backfillFryzigg.js

echo "✅ Backfill complete."
