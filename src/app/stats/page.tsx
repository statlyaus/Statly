"use client";

import { useState, useEffect } from "react";
import { getDocs, collection } from "firebase/firestore";
import { db } from "@/firebase"; // <-- ensure correct path or alias is used
import StatFilters from "@/Components/StatFilters"; // Capitalized 'Components' and using alias

export default function Stats() {
  const [statQualifier, setStatQualifier] = useState("kicks");
  const [statThreshold, setStatThreshold] = useState(0);
  const [timeframe, setTimeframe] = useState("season");
  const [players, setPlayers] = useState<any[]>([]);

  useEffect(() => {
    async function fetchData() {
      const snapshot = await getDocs(collection(db, "players"));
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPlayers(list);
    }
    fetchData();
  }, []);

  const filteredPlayers = players.filter(player => {
    const total = player.summary?.[statQualifier] ?? 0;
    return total >= statThreshold;
  });

  function capitalizeWords(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-2">Stats</h2>
      <p className="mb-4">Here you’ll find player and match statistics.</p>
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
      <div className="mt-4">
        <table className="min-w-full border border-gray-300">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 border">Player</th>
              {/* Add these if you want */}
              {/* <th className="p-2 border">Team</th>
              <th className="p-2 border">Position</th> */}
              <th className="p-2 border capitalize">{statQualifier}</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.length > 0 ? (
              filteredPlayers.map(player => (
                <tr key={player.id}>
                  <td className="p-2 border">{capitalizeWords(player.name)}</td>
                  {/* <td className="p-2 border">{player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""}</td>
                  <td className="p-2 border">{player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""}</td> */}
                  <td className="p-2 border">{player.summary?.[statQualifier] ?? 0}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-2 border" colSpan={2}>No data available</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}