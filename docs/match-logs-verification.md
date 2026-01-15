# Match Logs Verification Guide

## Overview

This guide covers the improvements made to match log processing, deduplication, and verification.

## Key Improvements

### 1. Debug Logging with Query Flag

The `/api/players/[id]/matches` endpoint now supports a `debug=1` query parameter that:

- **Includes debug counters in JSON response** (instead of only server logs)
- **Tracks missing dates** with sample matchIds for pattern detection
- **Gates verbose logging** behind `debug=1` or `NODE_ENV !== 'production'`

**Example:**
```bash
GET /api/players/Josh%20Daicos/matches?seasons=2023,2024,2025&debug=1
```

**Response with debug:**
```json
{
  "success": true,
  "data": {
    "rows": [...],
    "debug": {
      "totalDocs": 150,
      "processed": 148,
      "droppedMissingMatchId": 0,
      "droppedMissingDate": 2,
      "missingDateMatchIdsCount": 2,
      "missingDateMatchIdsSample": ["2025-R18-ADE-COL", "2025-R19-CAR-GEE"],
      "duplicateMatchIds": 0,
      "duplicateMatchIdSamples": []
    }
  }
}
```

**Note**: `missingDateMatchIdsSample` is capped at 25 entries to prevent huge responses. Use `missingDateMatchIdsCount` for the full count.

### 2. Improved Date Sorting

- **Missing dates sort last** (instead of mixing with dated rows)
- **Safe fallback** ensures rows without dates don't interfere with chronological sorting
- **ISO date format** enforced for consistent parsing

### 3. Finals Display

- **Round 0 displays as "Finals"** in the UI (instead of "Round 0")
- **Sorting by ISO date** ensures finals naturally appear after regular season
- **Future enhancement**: Can derive finals stage (EF/SF/PF/GF) if data available

### 4. Match ID Derivation & Normalization

- **Multiple fallback sources** for matchId:
  1. `match_uid` / `matchUid` field (preferred - canonical UID)
  2. `match_id` / `matchId` field (may be numeric or canonical)
  3. **Doc ID prefix** (e.g., `2025-R18-ADE-COL_ply_josh_daicos` → `2025-R18-ADE-COL`)

- **Numeric ID Resolution**: Numeric match IDs (e.g., `11383` from Fryzigg) are automatically resolved to canonical match UIDs (e.g., `2025-R23-COL-ADE`) by querying the `matches` collection before deduplication.

This prevents:
- Data loss from legitimate matches missing matchId
- Duplicate matches caused by different ID formats (numeric vs canonical UID)

## Verification Script

A comprehensive verification script is available to test match log endpoints:

```bash
# Basic usage
npm run verify-match-logs -- "Josh Daicos" --seasons=2023,2024,2025

# With auto-comparison against roster endpoint
npm run verify-match-logs -- "Josh Daicos" --seasons=2023,2024,2025 --league-id=2eeN0DEaO7i4lbUnscGB --user-id=statly-dev-tester

# Direct tsx way (no -- needed)
tsx scripts/verify-match-logs.ts "Josh Daicos" --seasons=2023,2024,2025 --league-id=2eeN0DEaO7i4lbUnscGB --user-id=statly-dev-tester
```

**Note**: npm requires `--` before script arguments to pass them through correctly.

### Features

✅ **Validates all league columns** - Checks averages for all visible league categories, not just kicks  
✅ **Auto-compares with roster** - Fetches roster endpoint and compares stats automatically  
✅ **Detects duplicate formats** - Finds cases where same match has different matchIds  
✅ **Comprehensive table** - Shows match log avg vs roster avg with diff for each stat

### What It Checks

✅ **Every row has matchId** - No missing identifiers  
✅ **Includes finals (round 0)** - Finals games are present  
✅ **All dates are YYYY-MM-DD format** - Date-only ISO (not datetime)  
✅ **No duplicate matchIds** - Deduplication working  
✅ **All have required fields** - Complete data structure  
✅ **Averages consistency** - Match log averages vs players list (catches double-division issues)  

### Sample Output

```
🔍 Verifying match logs for player: Josh Daicos
📡 URL: http://localhost:3000/api/players/Josh%20Daicos/matches?seasons=2023,2024,2025&debug=1

✅ Response received: 148 matches

📊 Debug Info:
   Total docs: 150
   Processed: 148
   Dropped (missing matchId): 0
   Missing dates: 2
   Duplicates removed: 0

✅ Validation Results:
   All rows have matchId: ✅
   Includes finals (round 0): ✅
   All dates are ISO format: ✅
   No duplicate matchIds: ✅
   All have required fields: ✅

📋 Sample matches (first 3):
   2025 R18 vs Collingwood (2025-07-10) [2025-R18-ADE-COL]
   2025 R17 vs Brisbane Lions (2025-07-03) [2025-R17-ADE-BRI]
   2025 Finals vs Geelong (2025-09-15) [2025-R0-ADE-GEE]

✅ All checks passed!
```

## Manual Verification Steps

### A) API Spot-Check

1. **Pick a player** with known finals + duplicated-opponent history
2. **Hit the endpoint** with debug flag:
   ```bash
   curl "http://localhost:3000/api/players/Josh%20Daicos/matches?seasons=2023,2024,2025&debug=1" | jq '.data.debug'
   ```
3. **Verify in JSON**:
   - Every row has `matchId`
   - `roundNumber` includes `0` for finals
   - `date` is YYYY-MM-DD format (e.g., `"2025-07-10"`, not full datetime)
   - No duplicate `matchId` values
   - Debug counters look sane:
     - `duplicateMatchIds > 0` is OK (means deduplication worked)
     - `duplicateMatchIdSamples` shows examples if duplicates found
     - `droppedMissingMatchId` should ideally be `0` after `deriveMatchIdFromDocId()`
     - `droppedMissingDate` should be very low
     - `missingDateMatchIdsCount` shows total (sample capped at 25)

### B) UI Match Log

1. **Open player detail page** in a league context
2. **Verify**:
   - Round column shows "Finals" where `roundNumber = 0`
   - No duplicated games (Brisbane vs Brisbane Lions should not double-row)
   - Season filter + last 3/5 doesn't "jump" or reshuffle unexpectedly

### C) Averages Sanity Check

The verification script now includes this check automatically:

1. **Script calculates** match log average for `kicks` (or other common stat)
2. **Compare** to players list value:
   - **Expected**: They should be roughly equal
   - If list values are **lower** → something is still double-dividing
   - If list values are **much higher** → roster aggregation may be returning totals instead of per-game

**Manual check:**
```bash
# Get match log average
curl ".../matches?seasons=2023,2024,2025" | jq '[.data[].stats.kicks] | add / length'

# Compare to players list (from /api/players endpoint)
# Should be roughly equal if roster stats are per-game
```

## Troubleshooting

### If Duplicates Still Appear

If duplicates persist after these fixes, the culprit is usually:

1. **Two different matchId formats** for the same game:
   - One derived from docId: `2025-R18-ADE-COL`
   - One from stored field: `2025-R18-Adelaide-Collingwood`
   
   **Solution**: Normalize matchId into one canonical format before dedupe

2. **Fallback deduplication** (last resort):
   - Dedupe by `(season, date, opponent)` if matchId normalization fails

### High Missing Date Count

If `droppedMissingDate` is high (>10% of rows):

- **Check ingest pipeline** - dates may not be mapped correctly
- **Review sample matchIds** in debug output to identify patterns
- **Consider date derivation** from other fields if available

## Debug Flags

- **`?debug=1`** - Include debug counters in JSON response
- **`NODE_ENV !== 'production'`** - Enable verbose server logging
- Both can be used together for maximum visibility

## CI Integration

The verification script can be run in CI. Add to your workflow:

```yaml
- name: Verify match logs
  if: env.VERIFY_MATCH_LOGS == 'true'
  env:
    VERIFY_MATCH_LOGS: ${{ secrets.VERIFY_MATCH_LOGS }}
    NEXT_PUBLIC_API_URL: ${{ secrets.VERIFY_API_URL || 'http://localhost:3000' }}
  run: npm run verify-match-logs -- "Josh Daicos" --seasons=2023,2024,2025
```

**Note**: Requires a running server and Firebase credentials. Gate behind env flag or run only when server is available.

## Related Files

- `/src/app/api/players/[id]/matches/route.ts` - Main API endpoint
- `/src/lib/matchLogs.ts` - Deduplication logic
- `/src/components/PlayerDetail.tsx` - UI display with finals formatting
- `/scripts/verify-match-logs.ts` - Comprehensive verification script
- `/.github/workflows/ci.yml` - CI workflow (includes optional verification step)
