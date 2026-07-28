# AFL ETL Pipeline

A comprehensive real-time ETL pipeline for AFL player statistics using fitzRoy (R) and Firebase.

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   fitzRoy (R)   │───▶│   Node.js ETL    │───▶│   Firestore     │
│   Data Source   │    │   Processor      │    │   Database      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                        │
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   NDJSON Stream │    │   Live Guard     │    │   Next.js API   │
│   (STDOUT)      │    │   Monitor        │    │   & Hooks       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Components

### 1. R Data Fetcher (`fetch_fw_round.R`)

- Fetches AFL player statistics from Footywire via fitzRoy
- Outputs NDJSON to STDOUT (one JSON per line)
- Cleans and normalizes column names to snake_case
- Supports season/round parameters

### 2. Pipeline Orchestrator (`fetchPipeline.ts`)

- Resolves source and compiled runtime paths consistently
- Streams the R fetcher output directly to the Node.js processor
- Propagates fetch and processing failures through exit codes
- Supports live and historical backfill modes without alternate sources

### 3. Node.js ETL Processor (`processFootywireData.ts`)

- Reads NDJSON from STDIN
- Computes checksums to avoid duplicate writes
- Generates match_uid and player_uid identifiers
- Maps to standardized stats schema
- Upserts to Firestore with jitter delays
- Only processes matches with status="in_progress"

### 4. Live Window Guard (`liveGuard.ts`)

- Monitors Firestore for matches with status="in_progress"
- Runs fetch/upsert cycles only during live matches
- Implements intelligent sleep intervals with jitter
- Handles graceful shutdown and error recovery

### 5. Data Validation (`validateMatchData.ts`)

- Validates team scores: sum(goals\*6 + behinds) vs expected scores
- Checks disposals = kicks + handballs for ≥95% of players
- Fails CI if validation criteria not met
- Comprehensive logging and error reporting

## Quick Start

### 1. Infrastructure Setup

Create Firebase project:

```bash
# Create Firestore Native database in australia-southeast1
# Add service account 'statly-etl' with roles:
# - Cloud Datastore User
# - Logging Writer
```

Generate service account key and encode:

```bash
# Download JSON key file
cat serviceAccountKey.json | base64 -w0 > encoded_key.txt
# Set as CI environment variable FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
```

### 2. Local Development

Install dependencies:

```bash
npm install
```

Setup environment:

```bash
cp .env.template .env
# Edit .env with your Firebase credentials
```

Build TypeScript:

```bash
npm run build
```

Test R script:

```bash
npm run test-r
```

Test full pipeline:

```bash
# Requires FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 and Firestore access
npm run test-pipeline
```

Run a historical backfill through the same source and processor:

```bash
npm run backfill -- 2024 2024 1 24
```

### 3. Docker Deployment

Build image:

```bash
npm run docker-build
```

Run container:

```bash
docker run --env-file .env statly-etl
```

### 4. Next.js Integration

Server function (API route):

```typescript
// /api/live-player-stats?matchUid=2025-R18-ADE-COL
import { getLivePlayerStats } from '@/api/live-player-stats/route';
```

Client hook:

```typescript
import { useLivePlayerStats } from '@/hooks/useLivePlayerStats';

function LiveStats() {
  const { players, isLoading, timeSinceUpdate } = useLivePlayerStats('2025-R18-ADE-COL');

  return (
    <div>
      Last updated {timeSinceUpdate}s ago • Source: Footywire via fitzRoy
      {players.map(player => (
        <div key={player.player_uid}>{/* player stats */}</div>
      ))}
    </div>
  );
}
```

## Data Schema

### Match UID Format

```
${season}-R${round}-${home_abbr}-${away_abbr}
Example: 2025-R18-ADE-COL
```

### Player UID Format

```
ply_${slugified_name}
Example: ply_rory_laird
```

### Document Structure

```typescript
{
  match_uid: string;
  player_uid: string;
  season: number;
  round: number;
  team: string;
  team_abbr: string;
  opposition: string;
  opposition_abbr: string;
  player_name: string;
  stats: {
    kicks: number;
    handballs: number;
    disposals: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
    // ... more stats
  }
  raw_row: object; // Original fitzRoy data
  raw_checksum: string;
  last_updated: timestamp;
  data_source: 'footywire_fitzroy';
}
```

## Team Abbreviations

```typescript
{
  'Adelaide': 'ADE',
  'Brisbane Lions': 'BRL',
  'Carlton': 'CAR',
  'Collingwood': 'COL',
  'Essendon': 'ESS',
  'Fremantle': 'FRE',
  'Geelong': 'GEE',
  'Gold Coast': 'GCS',
  'GWS Giants': 'GWS',
  'Hawthorn': 'HAW',
  'Melbourne': 'MEL',
  'North Melbourne': 'NTH',
  'Port Adelaide': 'PTA',
  'Richmond': 'RIC',
  'St Kilda': 'STK',
  'Sydney': 'SYD',
  'West Coast': 'WCE',
  'Western Bulldogs': 'WBD'
}
```

## Validation & CI

Run validation tests:

```bash
npm run validate 2025-R18-ADE-COL 2025-R18-GEE-HAW
```

CI Integration:

```yaml
- name: Validate Match Data
  run: |
    cd etl
    npm run validate ${{ env.MATCH_UIDS }}
```

## Monitoring

### Live Guard Logs

```bash
🚀 Starting Live Guard...
Live window check: ACTIVE (2 live matches)
🔄 Starting fetch cycle...
✓ Updated 2025-R18-ADE-COL_ply_rory_laird - Rory Laird (Adelaide)
✅ Fetch cycle completed successfully
💤 Sleeping for 42s...
```

### Health Checks

```bash
# Docker health check
docker ps --filter health=healthy

# Manual health check
curl http://localhost:3000/api/health
```

## Performance

- **Jitter**: ±6s delays prevent thundering herd
- **Checksum deduplication**: Skip unchanged records
- **Live window detection**: Only fetch during active matches
- **Streaming processing**: Rows are processed as the fetcher emits NDJSON
- **Failure propagation**: Fetch, parsing, and Firestore write failures make the cycle fail

## Future Enhancements

### Bronze Layer (Optional)

Store raw data in Google Cloud Storage:

```
gs://statly-raw/fitzroy/footywire/season=2025/round=18/snapshot_20250814_143022.ndjson
```

### Additional Data Sources

- AFL.com.au API
- Champion Data
- Squiggle API
- AFLTables.com

## Troubleshooting

### Common Issues

**R packages not found:**

```bash
# Install manually in R console
install.packages(c('fitzRoy', 'jsonlite', 'janitor', 'dplyr', 'stringr'))
```

**Firebase connection errors:**

```bash
# Verify service account permissions
# Check FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 encoding
echo "$FIREBASE_SERVICE_ACCOUNT_JSON_BASE64" | base64 -d | jq .
```

**No live matches:**

```bash
# Check matches collection for status="in_progress"
# Manually set match status for testing
```

### Debug Mode

```bash
export DEBUG=true
npm start
```

## License

MIT License - see LICENSE file for details.
