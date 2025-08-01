import React, { useState, useEffect } from "react";
import PlayerList from "../components/PlayerList";
import type { Player } from "../types";
import { fetchFromAPI } from "../lib/api";

const PlayersPage = () => {
  const [myTeam, setMyTeam] = useState<Player[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPlayers = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch all players from your API
        const allPlayers = await fetchFromAPI<Player[]>("/api/players");

        // Split into my team and available players based on your logic
        // You might want to filter based on user's actual team
        // TODO: Replace the following line with logic to select the user's actual team from allPlayers
        // TODO: Replace the following line with logic to determine available players based on your application's requirements.
        setAvailablePlayers(allPlayers.slice(10));
        setAvailablePlayers(allPlayers.slice(10)); // Replace with actual available logic
        // Optionally log error to an external service here
        setError("Failed to load players");
        setError("Failed to load players");
      } finally {
        setLoading(false);
      }
    };

    loadPlayers();
  }, []);

  if (loading) return <div className="p-4">Loading players...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="p-4">
      <PlayerList title="My Team" players={myTeam} />
      <div className="mt-6">
        <PlayerList title="Available Players" players={availablePlayers} />
      </div>
    </div>
  );
};

export default PlayersPage;