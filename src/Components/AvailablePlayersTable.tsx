// src/components/AvailablePlayersTable.tsx
"use client";

import React, { useState, useMemo } from "react";
import { Player } from "../types";

interface Props {
  players: Player[];
}

const PAGE_SIZE = 10;

export default function AvailablePlayersTable({ players }: Props) {
  const [teamFilter, setTeamFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [page, setPage] = useState(1);

  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      return (
        (teamFilter ? p.team === teamFilter : true) &&
        (positionFilter ? p.position === positionFilter : true)
      );
    });
  }, [players, teamFilter, positionFilter]);

  const paginatedPlayers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredPlayers.slice(start, start + PAGE_SIZE);
  }, [filteredPlayers, page]);

  const uniqueTeams = [...new Set(players.map((p) => p.team))];
  const uniquePositions = [...new Set(players.map((p) => p.position))];
  const totalPages = Math.ceil(filteredPlayers.length / PAGE_SIZE);

  return (
    <div className="p-4 bg-white shadow-md rounded-xl">
      <h2 className="text-2xl font-bold mb-4">Available Players</h2>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="border px-2 py-1 rounded"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
        >
          <option value="">All Teams</option>
          {uniqueTeams.map((team) => (
            <option key={team} value={team}>
              {team}
            </option>
          ))}
        </select>

        <select
          className="border px-2 py-1 rounded"
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
        >
          <option value="">All Positions</option>
          {uniquePositions.map((pos) => (
            <option key={pos} value={pos}>
              {pos}
            </option>
          ))}
        </select>
      </div>

      <table className="table-auto w-full border border-gray-200">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 border">Name</th>
            <th className="px-4 py-2 border">Team</th>
            <th className="px-4 py-2 border">Position</th>
            <th className="px-4 py-2 border">Avg</th>
          </tr>
        </thead>
        <tbody>
          {paginatedPlayers.map((player) => (
            <tr key={player.id} className="text-center hover:bg-gray-50">
              <td className="border px-4 py-2">{player.name}</td>
              <td className="border px-4 py-2">{player.team}</td>
              <td className="border px-4 py-2">{player.position}</td>
              <td className="border px-4 py-2">{player.avg}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-center items-center gap-2">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Prev
        </button>
        <span className="font-medium">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
