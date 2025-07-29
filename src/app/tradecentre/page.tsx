import React, { useState } from "react";
import type { Player } from '../types';
import { Link } from "react-router-dom";
import aflPlayers from "../Data/aflPlayers";

const TradeCentre = () => {
  const [myTeam] = useState<Player[]>(aflPlayers.slice(0, 10));
  const [opponentTeam] = useState<Player[]>(aflPlayers.slice(10, 20));
  const [selectedMyPlayers, setSelectedMyPlayers] = useState<string[]>([]);
  const [selectedOpponentPlayers, setSelectedOpponentPlayers] = useState<string[]>([]);

  const handleConfirmTrade = () => {
    if (selectedMyPlayers.length === 0 || selectedOpponentPlayers.length === 0) {
      alert("Please select players from both teams");
      return;
    }
    alert("Trade confirmed!");
  };

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Trade Centre</h1>
      
      <div className="grid md:grid-cols-2 gap-6">
        {/* My Team */}
        <div className="bg-white rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-4">My Team</h2>
          <div className="space-y-2">
            {myTeam.map(player => (
              <div key={player.id} className="p-3 border rounded hover:bg-gray-50">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">{player.name}</h3>
                    <p className="text-sm text-gray-600">{player.team} - {player.position}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedMyPlayers.includes(player.id)) {
                        setSelectedMyPlayers(prev => prev.filter(id => id !== player.id));
                      } else {
                        setSelectedMyPlayers(prev => [...prev, player.id]);
                      }
                    }}
                    className={`px-3 py-1 rounded text-sm ${
                      selectedMyPlayers.includes(player.id)
                        ? 'bg-red-500 text-white'
                        : 'bg-blue-500 text-white'
                    }`}
                  >
                    {selectedMyPlayers.includes(player.id) ? 'Remove' : 'Trade'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Opponent Team */}
        <div className="bg-white rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-4">Available Players</h2>
          <div className="space-y-2">
            {opponentTeam.map(player => (
              <div key={player.id} className="p-3 border rounded hover:bg-gray-50">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">{player.name}</h3>
                    <p className="text-sm text-gray-600">{player.team} - {player.position}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedOpponentPlayers.includes(player.id)) {
                        setSelectedOpponentPlayers(prev => prev.filter(id => id !== player.id));
                      } else {
                        setSelectedOpponentPlayers(prev => [...prev, player.id]);
                      }
                    }}
                    className={`px-3 py-1 rounded text-sm ${
                      selectedOpponentPlayers.includes(player.id)
                        ? 'bg-red-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {selectedOpponentPlayers.includes(player.id) ? 'Remove' : 'Add'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 text-center">
        <button
          onClick={handleConfirmTrade}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
        >
          Confirm Trade
        </button>
      </div>
    </div>
  );
};

export default TradeCentre;