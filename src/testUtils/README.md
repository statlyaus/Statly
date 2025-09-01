# Test Utilities

This directory contains reusable test data factories and utilities for creating consistent test fixtures across the application.

## Player Data Factory

The `playerDataFactory.ts` provides functions to create `PlayerCardData` objects for testing and examples.

### Basic Usage

```typescript
import { createExamplePlayer, PLAYER_VARIATIONS } from '@/testUtils/playerDataFactory';

// Create a player with default values
const player = createExamplePlayer();

// Create a player with custom overrides
const customPlayer = createExamplePlayer({
  name: 'Custom Player',
  team: 'RIC',
  currentPrice: 500000,
  status: 'injured',
});

// Use pre-configured variations
const injuredPlayer = PLAYER_VARIATIONS.injured();
const rookiePlayer = PLAYER_VARIATIONS.rookie();
const premiumPlayer = PLAYER_VARIATIONS.premium();
```

### Available Functions

#### `createExamplePlayer(overrides?: Partial<PlayerCardData>)`

Creates a complete `PlayerCardData` object with realistic default values. Accepts optional overrides to customize specific fields.

#### `createExamplePlayers(count: number, baseOverrides?: Partial<PlayerCardData>)`

Creates an array of players with variations. Useful for testing lists and grids.

#### `createMinimalPlayer(overrides?: Partial<PlayerCardData>)`

Creates a player with only required fields populated. Useful for testing edge cases.

#### `PLAYER_VARIATIONS`

Pre-configured player objects for common scenarios:

- `injured()` - Player with injury status
- `suspended()` - Suspended player
- `rookie()` - Low-priced rookie player
- `premium()` - High-value premium player
- `bye()` - Player on bye week

### Examples

```typescript
// Testing different player states
describe('PlayerCard', () => {
  it('should render injured player correctly', () => {
    const player = PLAYER_VARIATIONS.injured();
    render(<PlayerCard player={player} />);
    expect(screen.getByText('Injured')).toBeInTheDocument();
  });

  it('should handle minimal player data', () => {
    const player = createMinimalPlayer({
      name: 'Test Player',
    });
    render(<PlayerCard player={player} />);
    expect(screen.getByText('Test Player')).toBeInTheDocument();
  });
});

// Creating test fixtures for stories
export default {
  title: 'Components/PlayerCard',
  component: PlayerCard,
};

export const Default = () => (
  <PlayerCard player={createExamplePlayer()} />
);

export const Injured = () => (
  <PlayerCard player={PLAYER_VARIATIONS.injured()} />
);

export const Multiple = () => {
  const players = createExamplePlayers(6);
  return (
    <div className="grid grid-cols-3 gap-4">
      {players.map(player => (
        <PlayerCard key={player.id} player={player} />
      ))}
    </div>
  );
};
```

### Type Safety

All factory functions return properly typed `PlayerCardData` objects that match the component's expected interface. TypeScript will catch any type mismatches during development.

### Realistic Defaults

The default player data uses realistic AFL fantasy values:

- Prices in the $350k-$850k range
- Scores reflecting actual player performance
- Proper team codes and positions
- Realistic ownership percentages

This ensures tests and examples reflect real-world usage scenarios.
