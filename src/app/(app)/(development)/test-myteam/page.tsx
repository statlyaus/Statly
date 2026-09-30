'use client';

import { useState } from 'react';
import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types/players';

// Mock data for testing
const mockPlayers: Player[] = [
  { id: '1', name: 'Marcus Bontempelli', position: 'MID', team: 'WBD' },
  { id: '2', name: 'Clayton Oliver', position: 'MID', team: 'MEL' },
  { id: '3', name: 'Lachie Neale', position: 'MID', team: 'BL' },
  { id: '4', name: 'Jeremy Cameron', position: 'FWD', team: 'GEE' },
  { id: '5', name: 'Max Gawn', position: 'RUC', team: 'MEL' },
  { id: '6', name: 'Tom Stewart', position: 'DEF', team: 'GEE' },
  { id: '7', name: 'Touk Miller', position: 'MID', team: 'GC' },
  { id: '8', name: 'Christian Petracca', position: 'MID', team: 'MEL', injury: 'Knee - 2-3 weeks' },
  { id: '9', name: 'Brodie Grundy', position: 'RUC', team: 'SYD' },
  { id: '10', name: 'Sam Docherty', position: 'DEF', team: 'CAR' },
  { id: '11', name: 'Zach Merrett', position: 'MID', team: 'ESS' },
  { id: '12', name: 'Charlie Curnow', position: 'FWD', team: 'CAR' },
  { id: '13', name: 'Jake Lloyd', position: 'DEF', team: 'SYD' },
  { id: '14', name: 'Josh Dunkley', position: 'MID', team: 'BL' },
  { id: '15', name: 'Tom Green', position: 'MID', team: 'GWS' },
  { id: '16', name: 'Jesse Hogan', position: 'FWD', team: 'GWS' },
  { id: '17', name: 'Jack Sinclair', position: 'DEF', team: 'STK' },
  { id: '18', name: 'Callum Mills', position: 'DEF', team: 'SYD' },
  { id: '19', name: 'Tim Taranto', position: 'MID', team: 'RIC' },
  { id: '20', name: 'Jordan De Goey', position: 'FWD', team: 'COL' },
  { id: '21', name: 'Nick Daicos', position: 'MID', team: 'COL' },
  { id: '22', name: 'Darcy Cameron', position: 'RUC', team: 'COL' },
];

const mockTeam: Team = {
  id: '1',
  name: 'Test Fantasy Team',
  players: [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
  ],
};

export default function TestMyTeamPage() {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');

  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    setLastAction(`Selected player: ${player.name}`);
  };

  const handleTeamAction = (action: string, player?: Player) => {
    const actionText = player ? `${action} action for ${player.name}` : `${action} action`;
    setLastAction(actionText);
  };

  const handleRefresh = () => {
    setLastAction('Team data refreshed');
  };

  return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">MyTeamPanel Integration Test</h1>
          <p className="text-gray-600">
            This page demonstrates your MyTeamPanel component integrated into the main application.
          </p>
          {lastAction && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">
                <strong>Last Action:</strong> {lastAction}
              </p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
          <MyTeamPanel
            team={mockTeam}
            players={mockPlayers}
            onPlayerSelect={handlePlayerSelect}
            onTeamAction={handleTeamAction}
            onRefresh={handleRefresh}
            showAdvancedFeatures={true}
            sortByValue={true}
            maxHeight="600px"
          />
        </div>

        {selectedPlayer && (
          <div className="mt-6 bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Selected Player Details</h3>
            <div className="text-sm space-y-1">
              <p>
                <strong>Name:</strong> {selectedPlayer.name}
              </p>
              <p>
                <strong>Position:</strong> {selectedPlayer.position}
              </p>
              <p>
                <strong>Team:</strong> {selectedPlayer.team}
              </p>
              {selectedPlayer.injury && (
                <p className="text-red-600">
                  <strong>Injury:</strong> {selectedPlayer.injury}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
  );
}
