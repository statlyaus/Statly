# Snake Draft API Documentation

## Overview

The snake draft system implements server-side enforcement of draft order, pick validation, and automatic pick functionality.

## Snake Logic Implementation

### Formula

- **N** = team count
- **R** = rosterSize + benchSize
- **totalPicks** = N × R
- **round** = ceil(currentPick / N)
- **direction** = (round % 2 === 1) ? FORWARD : REVERSE
- **slot** = direction === FORWARD ? ((currentPick-1) % N) + 1 : N - ((currentPick-1) % N)

### Draft Flow

1. **Validate turn**: Ensure it's the correct member's turn based on slot calculation
2. **Validate uniqueness**: Player hasn't been picked already
3. **Validate roster capacity**: Member hasn't exceeded roster limits
4. **Write Pick**: Create pick record in database
5. **Increment currentPick**: Move to next pick
6. **Recompute round/direction**: Calculate state for next pick
7. **Reset timer**: (Timer implementation not included in this API)
8. **Emit updates**: (WebSocket implementation not included)

## API Endpoints

### GET /api/drafts/[id]

Retrieve draft state with all picks, available players, and participants.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "draft_123",
    "name": "League Name - LIVE",
    "leagueSize": 12,
    "draftType": "SNAKE",
    "timePerPick": 120,
    "status": "LIVE",
    "currentPick": 5,
    "totalPicks": 264,
    "round": 1,
    "direction": "REVERSE",
    "participants": [...],
    "players": [...],
    "picks": [...]
  }
}
```

### POST /api/drafts/[id]/pick

Make a draft pick (manual pick by user).

**Request Body:**

```json
{
  "playerId": "player_123",
  "memberId": "member_456"
}
```

**Validation:**

- Draft must be in LIVE status
- Must be the member's turn (correct slot)
- Player must be available (not picked)
- Member must have roster space
- Player must exist and be active

**Response:**

```json
{
  "success": true,
  "data": {
    "pick": {
      "id": "pick_789",
      "overall": 5,
      "round": 1,
      "slot": 4,
      "auto": false,
      "player": {...},
      "member": {...}
    },
    "currentPick": 6,
    "isComplete": false,
    "nextTurn": {
      "round": 2,
      "direction": "REVERSE",
      "slot": 3
    }
  }
}
```

### POST /api/drafts/[id]/auto-pick

Execute automatic pick on timer expiry.

**Auto-Pick Priority:**

1. **Queue item**: First available player from member's queue
2. **Best available**: Highest-ranked available player (by position, then name)

**Validation:**

- Draft must be in LIVE status
- Auto-pick must be enabled in league settings
- Must find an available player

**Response:**

```json
{
  "success": true,
  "data": {
    "pick": {...},
    "currentPick": 6,
    "isComplete": false,
    "nextTurn": {...},
    "wasQueued": true
  }
}
```

### POST /api/drafts/[id]/queue

Add player to member's draft queue.

**Request Body:**

```json
{
  "playerId": "player_123",
  "memberId": "member_456",
  "rank": 1
}
```

**Validation:**

- Member must be part of the draft
- Player must exist and be active
- Player must not be already picked
- Player must not be already queued by this member

### DELETE /api/drafts/[id]/queue?playerId=player_123&memberId=member_456

Remove player from member's draft queue.

### GET /api/drafts/[id]/queue?memberId=member_456

Get member's draft queue with player details.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "queue_123",
      "memberId": "member_456",
      "playerId": "player_789",
      "rank": 1,
      "player": {
        "id": "player_789",
        "name": "Marcus Bontempelli",
        "position": "MID",
        "club": "Western Bulldogs"
      }
    }
  ]
}
```

## Error Handling

### Common Error Responses

- **400 Bad Request**: Invalid input, validation errors
- **404 Not Found**: Draft, player, or queue item not found
- **403 Forbidden**: Not authorized for this draft
- **500 Internal Server Error**: Database or system errors

### Example Error Response

```json
{
  "success": false,
  "error": {
    "message": "Not your turn to pick",
    "code": "BAD_REQUEST"
  },
  "timestamp": "2025-08-12T16:30:00.000Z"
}
```

## Database Schema

### Key Models

- **Draft**: Main draft entity with current state
- **DraftOrder**: Defines slot order for each member
- **Pick**: Individual draft picks with snake logic data
- **QueueItem**: Member's queued players for auto-pick
- **Player**: Available AFL players
- **LeagueMember**: Draft participants

### Snake Logic Fields

- `currentPick`: Current pick number (1-based)
- `round`: Current round number
- `direction`: FORWARD or REVERSE
- `totalPicks`: N × R total picks in draft

## Implementation Notes

1. **Server-side enforcement**: All validation happens on the server
2. **Atomic transactions**: Pick creation and state updates are atomic
3. **Queue management**: Auto-pick uses queue priority, falls back to best available
4. **Position ordering**: Players ordered by position priority (MID, FWD, DEF, RUC)
5. **Comprehensive logging**: All actions logged with structured data
6. **Error resilience**: Graceful handling of edge cases and invalid states
