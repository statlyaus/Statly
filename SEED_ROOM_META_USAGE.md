# seedRoomMeta.ts Usage Update

## New Time Per Pick Options

The `seedRoomMeta.ts` script now supports multiple time per pick options:

### Available Options:

- **30 seconds** - Fast-paced drafts
- **45 seconds** - Quick but manageable
- **60 seconds** - Default, balanced timing
- **90 seconds** - More time for consideration
- **120 seconds** - Extended time for strategic picks

### Usage Examples:

```bash
# Default 60 seconds
npm run seed-room-meta room1

# 30 second picks
npm run seed-room-meta room1 --time=30

# 45 second picks with shuffled order
npm run seed-room-meta room1 --time=45 --shuffle

# 90 second picks in test mode
npm run seed-room-meta room1 --time=90 --test

# 120 second picks with all options
npm run seed-room-meta room1 --time=120 --shuffle --test
```

### Command Line Arguments:

- `<roomId>` - Required: The room identifier
- `--time=X` - Optional: Time per pick in seconds (30, 45, 60, 90, 120)
- `--shuffle` - Optional: Shuffle the draft order
- `--test` - Optional: Use test mode with predefined team names

### Error Handling:

- Invalid time values will show available options and exit
- Missing room ID will display usage information
- Team count validation ensures minimum 2 teams

### Validation:

The script validates that the provided time value is one of the allowed options. If an invalid time is provided, it will show an error message with all available options and exit gracefully.

Example error output:

```
❌ Invalid time per pick: 75. Available options: 30, 45, 60, 90, 120 seconds
```
