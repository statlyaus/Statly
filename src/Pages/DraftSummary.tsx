import React from "react";
import type { Player } from "../types";

interface DraftSummaryProps {
  draftedPlayers: Record<string, Player[]>;
}

const DraftSummary: React.FC<DraftSummaryProps> = ({ draftedPlayers }) => {
  return (
    <div className="p-6 bg-white rounded-lg shadow-md max-w-3xl mx-auto mt-10">
      <h2 className="text-2xl font-bold mb-6 text-center">Draft Summary</h2>
      {Object.entries(draftedPlayers).map(([teamId, players]) => (
        <div key={teamId} className="mb-6">
          <h3 className="text-xl font-semibold mb-2">Team {teamId}</h3>
          <ul className="list-disc ml-6">
            {players.map((player, index) => (
              <li key={index}>
                {player.name} – {player.team} – {player.position} – Avg: {player.avgPoints ?? "N/A"} pts
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default DraftSummary;
