/**
 * PlayerCard Usage Example
 * Demonstrates how to use the improved PlayerCard with error boundaries
 */

import React from 'react';

import { createExamplePlayer, PLAYER_VARIATIONS } from '@/testUtils/playerDataFactory';

import { PlayerCard, PlayerCardErrorBoundary, withPlayerCardErrorBoundary } from './index';

// Example player data using factory
const examplePlayer = createExamplePlayer();

// Additional example players for demonstration
const injuredPlayer = PLAYER_VARIATIONS.injured();
const rookiePlayer = PLAYER_VARIATIONS.rookie();

// PlayerCard with error boundary wrapper
const SafePlayerCard = withPlayerCardErrorBoundary(PlayerCard);

export function PlayerCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
      {/* Basic usage with error boundary */}
      <PlayerCardErrorBoundary>
        <PlayerCard player={examplePlayer} />
      </PlayerCardErrorBoundary>

      {/* Compact variant */}
      <PlayerCardErrorBoundary>
        <PlayerCard player={examplePlayer} variant="compact" size="sm" />
      </PlayerCardErrorBoundary>

      {/* Detailed variant with all features */}
      <PlayerCardErrorBoundary>
        <PlayerCard
          player={examplePlayer}
          variant="detailed"
          size="lg"
          selectable
          showStats
          showNextGame
          showOwnership
          onSelect={(player) => console.log('Selected:', player.name)}
          onStar={(player) => console.log('Starred:', player.name)}
        />
      </PlayerCardErrorBoundary>

      {/* Using HOC wrapper (recommended for lists) */}
      <SafePlayerCard
        player={examplePlayer}
        variant="compact"
        selectable
        onSelect={(player) => console.log('HOC Selected:', player.name)}
      />

      {/* Injured player example */}
      <PlayerCardErrorBoundary>
        <PlayerCard player={injuredPlayer} variant="compact" />
      </PlayerCardErrorBoundary>

      {/* Rookie player example */}
      <PlayerCardErrorBoundary>
        <PlayerCard player={rookiePlayer} variant="default" showStats />
      </PlayerCardErrorBoundary>

      {/* Custom player using factory overrides */}
      <PlayerCardErrorBoundary>
        <PlayerCard
          player={createExamplePlayer({
            name: 'Custom Player',
            team: 'RIC',
            position: 'RUC',
            status: 'doubtful',
            currentPrice: 550000,
            isStarred: false,
          })}
          variant="compact"
        />
      </PlayerCardErrorBoundary>

      {/* Error boundary with onError callback example */}
      <PlayerCardErrorBoundary
        onError={(error, info) => {
          console.log('Error tracking example:', error.message, info);
          // In production: send to analytics/monitoring service
        }}
      >
        <PlayerCard player={examplePlayer} />
      </PlayerCardErrorBoundary>
    </div>
  );
}

export default PlayerCardExample;
