import React from "react";
import type { Player, Team } from "../types";

type MyTeamPanelProps = {
  team: Team | undefined;
  players: Player[];
};

const MyTeamPanel = ({ team, players }: MyTeamPanelProps) => {
  if (!team) return null;

  const draftedPlayers = players.filter((p) => (team.players ?? []).includes(String(p.id)));

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <section aria-labelledby="team-heading">
      <div className="bg-white p-4 rounded shadow h-full">
        <h2 id="team-heading" className="text-md font-bold mb-2">My Team</h2>
        {draftedPlayers.length === 0 ? (
          <p className="text-sm text-gray-500">No players drafted yet.</p>
        ) : (
          <ul className="text-sm space-y-1 max-h-[600px] overflow-y-auto">
            {draftedPlayers.map((player) => (
              <li key={player.id} className="border-b py-1">
                <span className="font-medium">{capitalizeWords(player.name)}</span> – {player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""} ({player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""})
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default MyTeamPanel;
