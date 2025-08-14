# Statly ETL Pipeline

Real-time AFL player statistics ingestion using fitzRoy and Firestore.

## Overview

This ETL pipeline fetches live AFL player statistics from Footywire via the fitzRoy R package and stores them in Firestore with proper normalization and deduplication.

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   fitzRoy   │───▶│  R Runner    │───▶│ NDJSON File │
│ (Footywire) │    │ fetch_fw_    │    │             │
└─────────────┘    │ round.R      │    └─────────────┘
                   └──────────────┘           │
                                              ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Firestore  │◀───│ TypeScript   │◀───│   Node.js   │
│ Collections │    │ Ingestor     │    │   Poller    │
└─────────────┘    └──────────────┘    └─────────────┘
```

## Firestore Schema

### Collections

#### `matches/{matchUid}`
```typescript
{
  season: 2025,
  round_number: 18,
  home_team: "CAR",
  away_team: "COL", 
  start_time_utc: "2025-08-15T11:30:00Z",
  status: "in_progress", // scheduled|in_progress|final
  provider_ids: {
    afl: "...",
    footywire: "...", 
    afltables: "...",
    squiggle: 12345
  }
}
```

#### `players/{playerUid}`
```typescript
{
  full_name: "Patrick Cripps",
  current_team: "CAR",
  positions: ["MID"],
  provider_ids: {
    footywire: 1234,
    afltables: 5678, 
    afl: "..."
  }
}
```

#### `player_match_stats/{matchUid}_{playerUid}`
```typescript
{
  match_uid: "2025-R18-CAR-COL",
  player_uid: "ply_cripps_patrick", 
  team: "CAR",
  season: 2025,
  round_number: 18,
  source: "footywire",
  last_seen_at: "2025-08-15T11:23:02Z",
  raw_checksum: "sha256:...",
  stats: {
    kicks: 12, handballs: 10, disposals: 22,
    marks: 4, tackles: 6, goals: 1, behinds: 1,
    // ... all AFL stats
  }
}
```

## Setup

### 1. Install R Dependencies
```bash
chmod +x setup_r.sh
./setup_r.sh
```

Or manually:
```bash
R -e 'install.packages(c("fitzRoy", "jsonlite", "janitor", "dplyr", "stringr"))'
```

### 2. Install Node Dependencies
```bash
cd etl
npm install
```

### 3. Configure Environment
```bash
cp .env.template .env
# Edit .env with your Firebase service account JSON
```

### 4. Test R Script
```bash
Rscript fetch_fw_round.R 2025 18 /tmp/test_output.json
cat /tmp/test_output.json
```

### 5. Test Full Pipeline
```bash
npm run dev
```

## Usage

### Manual Data Fetch
```bash
# Fetch specific season/round
Rscript fetch_fw_round.R 2025 18 /tmp/output.json

# Fetch latest round
Rscript fetch_fw_round.R 2025
```

### Live Polling
```bash
# Start live polling (only runs when matches are in_progress)
npm start
```

### Backfill Historical Data
```bash
# Backfill seasons 2023-2025
node dist/backfill.js 2023 2025

# Backfill specific rounds with custom delay
node dist/backfill.js 2024 2024 1 5 3000
```

## Deployment

### Docker
```bash
docker build -t statly-etl .
docker run -e GOOGLE_SERVICE_ACCOUNT='...' statly-etl
```

### Cloud Run
```bash
gcloud run deploy statly-etl --source . --region=us-central1
```

### VM/Server
```bash
npm run build
GOOGLE_SERVICE_ACCOUNT='...' node dist/ingestFootywire.js
```

## Operational Features

### Rate Limiting
- 27-36 second intervals with jitter
- Only polls during live matches
- Respects Footywire's servers

### Deduplication
- SHA256 checksum comparison
- Skips unchanged data
- Idempotent upserts

### Error Handling
- Continues on R script failures
- Logs all errors with context
- Graceful shutdown on SIGINT/SIGTERM

### Monitoring
- Logs row counts processed
- Tracks last_seen_at timestamps
- Reports live match detection

## Live Match Detection

The system only polls when `matches` collection contains records with `status: "in_progress"`.

Update match status externally:
```typescript
import { updateMatchStatus } from './liveGuard';

// Start live polling
await updateMatchStatus("2025-R18-CAR-COL", "in_progress");

// Stop live polling  
await updateMatchStatus("2025-R18-CAR-COL", "final");
```

## Data Quality

### Normalization
- Snake_case field names
- Consistent team abbreviations
- Null handling for missing stats
- Calculated fields (disposals = kicks + handballs)

### Validation
- Required fields: season, round, team, player_name
- Numeric validation for stats
- Team code normalization (3-char uppercase)

### Sources
- **Primary**: Footywire (fitzRoy)
- **Backup**: AFL Tables, AFL.com, Squiggle
- **Real-time**: 30-second polling during matches

## Troubleshooting

### R Script Issues
```bash
# Test R packages
R -e 'library(fitzRoy); fetch_player_stats(2025, 1, source="footywire")'

# Check R script permissions
chmod +x fetch_fw_round.R
```

### Firebase Issues
```bash
# Validate service account
node -e 'console.log(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT))'

# Test Firestore connection
npm run test-firestore
```

### Data Issues
```bash
# Check output format
Rscript fetch_fw_round.R 2025 18 /tmp/debug.json
head -5 /tmp/debug.json | jq .
```

## Performance

- **Memory**: ~100MB for Node process
- **Disk**: ~10MB for temp JSON files  
- **CPU**: Low, spikes during R execution
- **Network**: ~100KB per polling cycle
- **Firestore**: ~500 writes per round (18 teams × ~28 players)

## License

Same as main Statly project.
