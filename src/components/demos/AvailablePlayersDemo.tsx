'use client';

import React, { useState } from 'react';

import AvailablePlayersTable from '@/components/AvailablePlayersTable';
import type { PlayerLite } from '@/types/players';

// Sample data for demonstration
const samplePlayers: PlayerLite[] = [
  {
    id: '1',
    name: 'Marcus Bontempelli',
    team: 'WB',
    position: 'MID',
  },
  {
    id: '2',
    name: 'Sam Walsh',
    team: 'CAR',
    position: 'MID',
  },
  {
    id: '3',
    name: 'Nick Daicos',
    team: 'COL',
    position: 'MID',
  },
  {
    id: '4',
    name: 'Charlie Curnow',
    team: 'CAR',
    position: 'FWD',
  },
  {
    id: '5',
    name: 'Max Gawn',
    team: 'MEL',
    position: 'RUC',
  },
  {
    id: '6',
    name: 'Jack Steele',
    team: 'STK',
    position: 'MID',
  },
  {
    id: '7',
    name: 'Jeremy Cameron',
    team: 'GEE',
    position: 'FWD',
  },
  {
    id: '8',
    name: 'Jordan De Goey',
    team: 'COL',
    position: 'MID',
  },
  {
    id: '9',
    name: 'Touk Miller',
    team: 'GC',
    position: 'MID',
  },
  {
    id: '10',
    name: 'Tom Stewart',
    team: 'GEE',
    position: 'DEF',
  },
  {
    id: '11',
    name: 'Brodie Grundy',
    team: 'SYD',
    position: 'RUC',
  },
  {
    id: '12',
    name: 'Lachie Neale',
    team: 'BL',
    position: 'MID',
  },
  {
    id: '13',
    name: 'Jake Lloyd',
    team: 'SYD',
    position: 'DEF',
  },
  {
    id: '14',
    name: 'Tom Green',
    team: 'GWS',
    position: 'MID',
  },
  {
    id: '15',
    name: 'Josh Dunkley',
    team: 'BL',
    position: 'MID',
  },
];

export default function AvailablePlayersDemo() {
  const [watchlist, setWatchlist] = useState<string[]>(['3', '7']); // Nick Daicos and Jeremy Cameron
  const [draftedPlayers, setDraftedPlayers] = useState<string[]>(['1']); // Marcus Bontempelli
  const [notifications, setNotifications] = useState<string[]>([]);

  const addNotification = (message: string) => {
    setNotifications((prev) => [...prev, message]);
    setTimeout(() => {
      setNotifications((prev) => prev.slice(1));
    }, 3000);
  };

  const handleAddToWatchlist = (player: PlayerLite) => {
    if (watchlist.includes(player.id)) {
      setWatchlist((prev) => prev.filter((id) => id !== player.id));
      addNotification(`${player.name} removed from watchlist`);
    } else {
      setWatchlist((prev) => [...prev, player.id]);
      addNotification(`${player.name} added to watchlist`);
    }
  };

  const handleDraftPlayer = (player: PlayerLite) => {
    setDraftedPlayers((prev) => [...prev, player.id]);
    setWatchlist((prev) => prev.filter((id) => id !== player.id));
    addNotification(`${player.name} has been drafted!`);
  };

  const handleViewDetails = (player: PlayerLite) => {
    addNotification(`Viewing details for ${player.name}`);
  };

  return (
    <div className="min-h-screen bg-muted py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Available Players Table Demo</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Demonstrating the optimized AvailablePlayersTable component with enhanced features
          </p>
        </div>

        {/* Demo stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-border p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-info rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">{samplePlayers.length}</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Available Players</p>
                <p className="text-lg font-semibold text-foreground">Total Pool</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-border p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-warning rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">{watchlist.length}</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Watchlisted</p>
                <p className="text-lg font-semibold text-foreground">Players</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-border p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-success rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">{draftedPlayers.length}</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted-foreground">Drafted</p>
                <p className="text-lg font-semibold text-foreground">Players</p>
              </div>
            </div>
          </div>
        </div>

        {/* Features showcase */}
        <div className="bg-white rounded-lg shadow-sm border border-border p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Enhanced Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">Advanced Search</p>
                <p className="text-xs text-muted-foreground">Search by name, team, or position</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">Dynamic Filtering</p>
                <p className="text-xs text-muted-foreground">Filter by position and team</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">Column Sorting</p>
                <p className="text-xs text-muted-foreground">Sort by any column ascending/descending</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">View Modes</p>
                <p className="text-xs text-muted-foreground">Compact and detailed display options</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">Interactive Actions</p>
                <p className="text-xs text-muted-foreground">Draft, watchlist, and view details</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 bg-info rounded-full mt-2 flex-shrink-0"></div>
              <div>
                <p className="text-sm font-medium text-foreground">Real Rankings</p>
                <p className="text-xs text-muted-foreground">Live fantasy rankings integration</p>
              </div>
            </div>
          </div>
        </div>

        {/* The optimized component */}
        <AvailablePlayersTable
          players={samplePlayers}
          onAddToWatchlist={handleAddToWatchlist}
          onDraftPlayer={handleDraftPlayer}
          onViewDetails={handleViewDetails}
          watchlist={watchlist}
          draftedPlayers={draftedPlayers}
          className="mb-8"
        />

        {/* Usage guide */}
        <div className="bg-white rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Usage Guide</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong>Search:</strong> Use the search bar to quickly find players by name, team, or
              position.
            </p>
            <p>
              <strong>Filter:</strong> Click the &ldquo;Filters&rdquo; button to show position and
              team filter dropdowns.
            </p>
            <p>
              <strong>Sort:</strong> Click any column header to sort by that field. Click again to
              reverse the order.
            </p>
            <p>
              <strong>View Modes:</strong> Toggle between &ldquo;Compact&rdquo; and
              &ldquo;Detailed&rdquo; views for different levels of information density.
            </p>
            <p>
              <strong>Actions:</strong> Use the action buttons to view player details, add to
              watchlist, or draft players.
            </p>
            <p>
              <strong>Status Indicators:</strong> Players show visual indicators for draft status
              and watchlist membership.
            </p>
          </div>
        </div>
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {notifications.map((notification, index) => (
          <div
            key={index}
            className="bg-foreground text-white px-4 py-2 rounded-lg shadow-lg transform transition-all duration-300 max-w-sm"
          >
            <p className="text-sm">{notification}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
