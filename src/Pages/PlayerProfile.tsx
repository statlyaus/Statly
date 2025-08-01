import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PlayerSummaryCard from "../components/PlayerSummaryCard";
import MatchLogTable from "../components/MatchLogTable";
import type { Player } from "../types";
import { fetchFromAPI } from "../lib/api";
import { loadUserSettings, saveUserSettings } from "../firebaseHelpers";
import { useAuth } from "../AuthContext";

const PlayerProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchFromAPI<Player>(`/api/players/${id}`)
      .then(setPlayer)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!user?.uid) return;
    loadUserSettings(user.uid).then((settings) => {
      setFavorites(settings.favorites || []);
    });
  }, [user?.uid]);

  const toggleFavorite = () => {
    if (!player || !user?.uid) return;
    const updated = favorites.includes(player.id)
      ? favorites.filter((id) => id !== player.id)
      : [...favorites, player.id];
    setFavorites(updated);
    saveUserSettings(user.uid, { favorites: updated });
  };

  if (loading) return <div className="p-4">Loading...</div>;
  if (!player) return <div className="p-4">Player not found.</div>;

  return (
    <main className="p-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <PlayerSummaryCard player={player} />
        <button
          onClick={toggleFavorite}
          className={`text-2xl ${favorites.includes(player.id) ? "text-yellow-400" : "text-gray-300"}`}
          title={favorites.includes(player.id) ? "Unfavorite" : "Favorite"}
        >
          ★
        </button>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Key Stats</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          {/* Add these if you want */}
          {/* <li>Team: {player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""}</li>
          <li>Position: {player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""}</li> */}
          <li>Kicks: {player.kicks ?? '-'}</li>
          <li>Handballs: {player.stats?.handballs ?? '-'}</li>
          <li>Disposals: {player.stats?.disposals ?? '-'}</li>
          <li>Marks: {player.stats?.marks ?? '-'}</li>
          <li>Tackles: {player.stats?.tackles ?? '-'}</li>
          <li>Goals: {player.goals ?? '-'}</li>
          <li>Behinds: {player.stats?.behinds ?? '-'}</li>
          <li>Hitouts: {player.stats?.hitouts ?? '-'}</li>
          <li>Frees For: {player.stats?.freesFor ?? '-'}</li>
          <li>Frees Against: {player.stats?.freesAgainst ?? '-'}</li>
          <li>Clearances: {player.stats?.clearances ?? '-'}</li>
          <li>Clangers: {player.stats?.clangers ?? '-'}</li>
          <li>Inside 50s: {player.stats?.inside50s ?? '-'}</li>
          <li>Rebound 50s: {player.stats?.rebound50s ?? '-'}</li>
          <li>Contested Possessions: {player.stats?.contestedPossessions ?? '-'}</li>
          <li>Uncontested Possessions: {player.stats?.uncontestedPossessions ?? '-'}</li>
          <li>Contested Marks: {player.stats?.contestedMarks ?? '-'}</li>
          <li>One Percenters: {player.stats?.onePercenters ?? '-'}</li>
          <li>Goal Assists: {player.stats?.goalAssists ?? '-'}</li>
        </ul>
      </section>

      {player.matchLogs && player.matchLogs.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Match Logs</h2>
          <MatchLogTable matchLogs={player.matchLogs.map(({ opposition, round, ...rest }) => ({
            opponent: opposition,
            round: Number(round),
            ...rest,
          }))} />
        </section>
      )}
    </main>
  );
};

export default PlayerProfile;
