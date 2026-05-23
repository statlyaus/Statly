'use client';

import { useState } from 'react';
import PlayerSearch from '@/components/PlayerSearch';
import PlayerLink from '@/components/PlayerLink';
import type { PlayerSearchResult } from '@/types/players';

export default function PlayerSearchExample() {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchResult | null>(null);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Player Search Components</h1>
        <p className="text-gray-600">
          Comprehensive player search and navigation components for the AFL platform
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Default Search */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Default Search</h2>
          <PlayerSearch
            placeholder="Search AFL players..."
            variant="detailed"
            onPlayerSelect={setSelectedPlayer}
          />
        </div>

        {/* Minimal Search */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Minimal Search</h2>
          <PlayerSearch
            placeholder="Quick player search..."
            variant="minimal"
            showAvatar={false}
            size="sm"
          />
        </div>

        {/* Large Search */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Large Search</h2>
          <PlayerSearch placeholder="Find your favorite player..." size="lg" variant="detailed" />
        </div>

        {/* Custom Handler Search */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Custom Handler</h2>
          <PlayerSearch
            placeholder="Search (custom handler)..."
            navigateToProfile={false}
            onPlayerSelect={(player) => {
              alert(`Selected: ${player.name} from ${player.team}`);
            }}
          />
        </div>
      </div>

      {/* Selected Player Display */}
      {selectedPlayer && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">Selected Player</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium text-gray-700">Name:</span>
              <p className="text-gray-900">{selectedPlayer.name}</p>
            </div>
            <div>
              <span className="font-medium text-gray-700">Team:</span>
              <p className="text-gray-900">{selectedPlayer.team}</p>
            </div>
            <div>
              <span className="font-medium text-gray-700">Position:</span>
              <p className="text-gray-900">{selectedPlayer.position}</p>
            </div>
            <div>
              <span className="font-medium text-gray-700">Avg Score:</span>
              <p className="text-gray-900">{selectedPlayer.averageScore}</p>
            </div>
          </div>
          <div className="mt-4">
            <PlayerLink
              playerName={selectedPlayer.name}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              View Full Profile →
            </PlayerLink>
          </div>
        </div>
      )}

      {/* Player Links Examples */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Link Examples</h3>
        <div className="space-y-2">
          <p className="text-gray-700">
            Check out <PlayerLink playerName="Marcus Bontempelli" showTooltip />
            &apos;s impressive season performance.
          </p>
          <p className="text-gray-700">
            Compare with <PlayerLink playerName="Patrick Dangerfield" showTooltip />
            &apos;s statistics.
          </p>
          <p className="text-gray-700">
            <PlayerLink
              playerName="Lachie Neale"
              className="font-semibold text-purple-600 hover:text-purple-800"
            >
              Lachie Neale (Custom Styling)
            </PlayerLink>{' '}
            is also having a great year.
          </p>
        </div>
      </div>

      {/* Usage Instructions */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-yellow-800 mb-3">Usage Instructions</h3>
        <div className="text-sm text-yellow-700 space-y-2">
          <h4 className="font-medium">PlayerSearch Component:</h4>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Use keyboard navigation (arrow keys, enter, escape)</li>
            <li>Supports different sizes: sm, md, lg</li>
            <li>Variants: default, minimal, detailed</li>
            <li>Custom onPlayerSelect handler or auto-navigation</li>
            <li>Debounced search with loading states</li>
          </ul>

          <h4 className="font-medium mt-4">PlayerLink Component:</h4>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Simple wrapper for player profile links</li>
            <li>Custom styling and tooltip support</li>
            <li>Handles URL encoding automatically</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
