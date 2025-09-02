# AFL Fantasy League API Reference

## Overview

This document provides complete API reference for interacting with your 12-team AFL Fantasy league. All endpoints use JSON for request/response bodies.

## Base URL

```
http://localhost:3001/api
```

## Authentication

- Local/Development: Include this header on all requests:
  ```
  Authorization: Bearer dev:<userId>
  ```
- Production: Authentication is handled by your browser session cookies. Do not send an Authorization header.

---

## 🏈 League Management

### Get League Details

```http
GET /leagues/{leagueId}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "league_123",
    "name": "Test AFL Fantasy League",
    "code": "ABC12345",
    "type": "private",
    "maxTeams": 12,
    "categories": ["goals", "tackles", "marks", "disposals"],
    "status": "preseason",
    "memberCount": 12
  }
}
```

### Join League (Human Manager)

```http
POST /leagues/join
```

**Request Body:**

```json
{
  "code": "ABC12345",
  "teamName": "My Fantasy Team",
  "userId": "your-user-id"
}
```

### Get League Members

```http
GET /leagues/{leagueId}/members
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "member_1",
      "teamName": "Your Team",
      "isBot": false,
      "draftPosition": 1,
      "stats": { "wins": 0, "losses": 0, "pointsFor": 0 }
    },
    {
      "id": "member_2",
      "teamName": "The Thunder Warriors",
      "isBot": true,
      "draftPosition": 2,
      "botDifficulty": "medium"
    }
  ]
}
```

---

## 🎯 Draft Management

### Get/Create Draft Room

```http
GET /leagues/{leagueId}/draft
```

### Create Draft Room

```http
POST /leagues/{leagueId}/draft
```

**Request Body:**

```json
{
  "draftType": "snake",
  "timePerPick": 120,
  "scheduledTime": "2025-08-20T19:00:00.000Z"
}
```

### Get Draft State

```http
GET /drafts/{draftId}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "draft_123",
    "status": "LIVE",
    "currentPick": 5,
    "totalPicks": 264,
    "round": 1,
    "direction": "FORWARD",
    "participants": [...],
    "picks": [...],
    "availablePlayers": [...]
  }
}
```

### Make Draft Pick (Manual)

```http
POST /drafts/{draftId}/pick
```

**Request Body:**

```json
{
  "playerId": "marcus_bontempelli",
  "memberId": "human-manager"
}
```

### Auto-Pick (Bot Simulation)

```http
POST /drafts/{draftId}/auto-pick
```

### Manage Draft Queue

```http
POST /drafts/{draftId}/queue
```

**Request Body:**

```json
{
  "playerId": "christian_petracca",
  "memberId": "human-manager",
  "rank": 1
}
```

```http
GET /drafts/{draftId}/queue?memberId=human-manager
DELETE /drafts/{draftId}/queue?playerId=player_123&memberId=human-manager
```

---

## 👔 Roster Management

### Get Team Roster

```http
GET /leagues/{leagueId}/roster
```

**Response:**

```json
{
  "success": true,
  "data": {
    "DEF": [
      { "slotId": "DEF_1", "playerId": "jordan_dawson", "isLocked": false },
      { "slotId": "DEF_2", "playerId": null, "isLocked": false }
    ],
    "MID": [...],
    "RUC": [...],
    "FWD": [...],
    "BENCH": [...],
    "EMG": [...]
  }
}
```

### Update Roster

```http
PUT /leagues/{leagueId}/roster
```

**Request Body:**

```json
{
  "DEF": ["jordan_dawson", "jack_crisp", "jake_lloyd", "daniel_rich", "shannon_hurn", "rory_laird"],
  "MID": [
    "marcus_bontempelli",
    "christian_petracca",
    "sam_walsh",
    "clayton_oliver",
    "lachie_neale",
    "touk_miller",
    "nick_daicos",
    "andrew_brayshaw"
  ],
  "RUC": ["max_gawn", "brodie_grundy"],
  "FWD": [
    "jeremy_cameron",
    "charlie_curnow",
    "tom_hawkins",
    "lance_franklin",
    "taylor_walker",
    "tom_lynch"
  ],
  "BENCH": ["player1", "player2", "player3", "player4"],
  "EMG": ["emergency1", "emergency2"]
}
```

### Set Weekly Lineup

```http
POST /leagues/{leagueId}/lineup
```

**Request Body:**

```json
{
  "DEF": ["jordan_dawson", "jack_crisp", "jake_lloyd", "daniel_rich", "shannon_hurn", "rory_laird"],
  "MID": [
    "marcus_bontempelli",
    "christian_petracca",
    "sam_walsh",
    "clayton_oliver",
    "lachie_neale",
    "touk_miller",
    "nick_daicos",
    "andrew_brayshaw"
  ],
  "RUC": ["max_gawn", "brodie_grundy"],
  "FWD": [
    "jeremy_cameron",
    "charlie_curnow",
    "tom_hawkins",
    "lance_franklin",
    "taylor_walker",
    "tom_lynch"
  ],
  "captain": "marcus_bontempelli",
  "viceCaptain": "christian_petracca"
}
```

---

## 💱 Trade Management

### Get Trade Proposals

```http
GET /leagues/{leagueId}/trades
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "trade_123",
      "fromTeamId": "bot-1",
      "toTeamId": "human-manager",
      "status": "pending",
      "createdAt": "2025-08-17T12:00:00.000Z",
      "expiresAt": "2025-08-24T12:00:00.000Z",
      "offer": {
        "fromTeam": {
          "players": ["marcus_bontempelli", "christian_petracca"],
          "picks": []
        },
        "toTeam": {
          "players": ["sam_walsh", "clayton_oliver"],
          "picks": []
        }
      },
      "message": "Interested in a midfield swap?"
    }
  ]
}
```

### Propose Trade

```http
POST /leagues/{leagueId}/trades
```

**Request Body:**

```json
{
  "toTeamId": "bot-1",
  "offer": {
    "fromTeam": {
      "players": ["marcus_bontempelli"],
      "picks": []
    },
    "toTeam": {
      "players": ["christian_petracca"],
      "picks": []
    }
  },
  "message": "Straight swap - what do you think?"
}
```

### Respond to Trade

```http
PUT /trades/{tradeId}
```

**Request Body:**

```json
{
  "action": "accept",
  "message": "Deal! Looking forward to this trade."
}
```

**Actions:** `accept`, `decline`, `counter`

---

## 📋 Waiver Wire Management

### Get Waiver Claims

```http
GET /leagues/{leagueId}/waivers
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "waiver_123",
      "teamId": "human-manager",
      "playerId": "touk_miller",
      "type": "pickup",
      "priority": 1,
      "status": "pending",
      "submittedAt": "2025-08-17T12:00:00.000Z",
      "processesAt": "2025-08-18T04:00:00.000Z",
      "dropPlayerId": "jack_steele"
    }
  ]
}
```

### Submit Waiver Claim

```http
POST /leagues/{leagueId}/waivers
```

**Request Body:**

```json
{
  "playerId": "touk_miller",
  "type": "pickup",
  "dropPlayerId": "jack_steele"
}
```

### Cancel Waiver Claim

```http
DELETE /waivers/{waiverId}
```

---

## 🆓 Free Agency

### Get Free Agents

```http
GET /leagues/{leagueId}/free-agents
```

**Query Parameters:**

- `position`: Filter by position (DEF, MID, RUC, FWD)
- `team`: Filter by AFL team
- `search`: Search by player name

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "player_123",
      "name": "Jack Steele",
      "position": "MID",
      "team": "St Kilda",
      "averageScore": 85.5,
      "gamesPlayed": 20
    }
  ]
}
```

### Pick Up Free Agent

```http
POST /leagues/{leagueId}/pickup
```

**Request Body:**

```json
{
  "playerId": "jack_steele",
  "dropPlayerId": "existing_player_id"
}
```

### Drop Player

```http
POST /leagues/{leagueId}/drop
```

**Request Body:**

```json
{
  "playerId": "player_to_drop"
}
```

---

## 📊 Standings & Statistics

### Get League Standings

```http
GET /leagues/{leagueId}/standings
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "teamId": "human-manager",
      "teamName": "Your Team",
      "wins": 15,
      "losses": 7,
      "draws": 1,
      "pointsFor": 1850.5,
      "pointsAgainst": 1720.3,
      "percentage": 107.5
    }
  ]
}
```

### Get Matchups

```http
GET /leagues/{leagueId}/matchups
```

**Query Parameters:**

- `round`: Specific round number
- `teamId`: Get matchups for specific team

### Get Team Statistics

```http
GET /leagues/{leagueId}/teams/{teamId}/stats
```

**Response:**

```json
{
  "success": true,
  "data": {
    "teamId": "human-manager",
    "seasonStats": {
      "totalPoints": 1850.5,
      "averagePoints": 80.5,
      "highScore": 125.3,
      "lowScore": 45.2
    },
    "categoryBreakdown": {
      "goals": 245,
      "tackles": 890,
      "marks": 456
    }
  }
}
```

---

## 📈 League Activity

### Get Activity Feed

```http
GET /leagues/{leagueId}/activity
```

**Query Parameters:**

- `type`: Filter by activity type (trade, waiver, draft, injury, admin)
- `limit`: Maximum number of activities (default: 50)
- `since`: ISO timestamp to get activities since

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "activity_123",
      "type": "trade_proposed",
      "timestamp": "2025-08-17T12:00:00.000Z",
      "data": {
        "fromTeam": "Thunder Warriors",
        "toTeam": "Your Team",
        "playersInvolved": ["Marcus Bontempelli", "Sam Walsh"]
      }
    }
  ]
}
```

---

## 🎮 Bot Team Simulation

### Simulate Bot Draft Pick

```http
POST /drafts/{draftId}/simulate-bot-pick
```

**Request Body:**

```json
{
  "memberId": "bot-1",
  "strategy": "best_available" // or "positional_need"
}
```

### Simulate Bot Trade Decision

```http
POST /trades/{tradeId}/simulate-bot-response
```

**Request Body:**

```json
{
  "botId": "bot-1",
  "aggressiveness": "medium" // low, medium, high
}
```

### Trigger Bot Waiver Activity

```http
POST /leagues/{leagueId}/simulate-bot-waivers
```

---

## 📱 Testing Endpoints

### Health Check

```http
GET /health
```

### Reset League (Development Only)

```http
POST /leagues/{leagueId}/reset
```

### Simulate Game Results

```http
POST /leagues/{leagueId}/simulate-round
```

**Request Body:**

```json
{
  "round": 15,
  "randomizeScores": true
}
```

---

## 🚀 Quick Start Commands

### 1. Create and Setup League

```bash
node setup-test-league.cjs
```

### 2. Test All Features

```bash
node test-league-features.cjs [leagueId]
```

### 3. Join as Human Manager

```bash
curl -X POST http://localhost:3001/api/leagues/join \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev:your-user-id" \
  -d '{"code": "ABC12345", "teamName": "My Team", "userId": "your-user-id"}'
```

### 4. Make a Draft Pick

```bash
curl -X POST http://localhost:3001/api/drafts/{draftId}/pick \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev:human-manager" \
  -d '{"playerId": "marcus_bontempelli", "memberId": "human-manager"}'
```

### 5. Propose a Trade

```bash
curl -X POST http://localhost:3001/api/leagues/{leagueId}/trades \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev:human-manager" \
  -d '{
    "toTeamId": "bot-1",
    "offer": {
      "fromTeam": {"players": ["marcus_bontempelli"], "picks": []},
      "toTeam": {"players": ["christian_petracca"], "picks": []}
    },
    "message": "Great trade opportunity!"
  }'
```

---

## 🎯 Recommended Testing Flow

1. Setup
   - Action: Run `node setup-test-league.cjs`.
   - Verify: Console shows created league ID/code and seeded data; GET `/api/leagues/{leagueId}` returns details (200).
   - Tip: If 401, add `-H "Authorization: Bearer dev:<userId>"`; if league missing, check server logs.

2. Join
   - Action (UI): Open the app Join page and enter the code; or API: `curl -X POST /api/leagues/join -H "Content-Type: application/json" -H "Authorization: Bearer dev:<userId>" -d '{"code":"ABC12345","teamName":"My Team","userId":"<userId>"}'`.
   - Verify: You appear in league members page; or GET `/api/leagues/{leagueId}/members` includes your userId.
   - Tip: If not found, ensure code is uppercase and league status is preseason.

3. Draft
   - Action: Start/enter draft room in UI; to simulate, `curl -X POST /api/drafts/{draftId}/auto-pick -H "Authorization: Bearer dev:<userId>"`.
   - Verify: GET `/api/drafts/{draftId}` shows advancing picks; optional GET `/api/leagues/{leagueId}/roster/<userId>` reflects drafted players.
   - Tip: If draftId unknown, GET `/api/leagues/{leagueId}/draft`; if 403, confirm you joined the league as that user.

4. Trades
   - Action: View pending trades in UI or `GET /api/leagues/{leagueId}/trades`; propose with `POST /api/leagues/{leagueId}/trades` (include offer) and dev auth.
   - Verify: Response 201/200 includes trade id/status=pending; GET list shows the new trade.
   - Tip: If 400, validate player IDs and team IDs; if 401, add Authorization header.

5. Waivers
   - Action: Submit claim `POST /api/leagues/{leagueId}/waivers -H dev auth -d '{"playerId":"...","type":"pickup","dropPlayerId":"..."}'`.
   - Verify: GET `/api/leagues/{leagueId}/waivers` shows status=pending; after processing window, status updates (e.g., processed/denied).
   - Tip: If nothing processes, check server scheduler/cron and waiver window configuration.

6. Roster
   - Action: Set lineup via UI; or `PUT /api/leagues/{leagueId}/roster/<userId>` with `playerIds`, `captainId`, `viceCaptainId`, `benchOrder` and dev auth.
   - Verify: Response returns updated fields; GET `/api/leagues/{leagueId}/roster/<userId>` reflects changes and honors position constraints.
   - Tip: If 400, ensure captain/vice are in playerIds and are not the same; if 403, userId must match auth.

7. Activity
   - Action: Open the league Activity feed in UI; or `GET /api/leagues/{leagueId}/activity`.
   - Verify: See events like draft_pick, trade_proposed, waiver_submitted, roster_updated with recent timestamps.
   - Tip: If empty, trigger an action (trade/roster change) and refresh.

8. Standings
   - Action: View Standings in UI; or `GET /api/leagues/{leagueId}/standings`.
   - Verify: Check rank, wins/losses, pointsFor/Against, percentage values are populated.
   - Tip: If metrics are zero, ensure matches/round simulations have been run.

Your 12-team league is now fully configured with realistic bot behavior, pending trades, waiver claims, and complete roster management capabilities!
