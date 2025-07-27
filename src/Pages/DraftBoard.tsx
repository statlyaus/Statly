import { useEffect, useMemo, useState } from 'react';
import type { Player, Team } from '../types';
import DraftOrderBar from '../components/DraftOrderBar';
import WatchList from '../components/WatchList';
import AvailablePlayersTable from '../components/AvailablePlayersTable';
import DraftBanner from '../components/DraftBanner';

const DraftBoard = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [currentPickIndex, setCurrentPickIndex] = useState<number>(0);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [myPlayers, setMyPlayers] = useState<Player[]>([]);
  const [draftedIds, setDraftedIds] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(30.0);

  useEffect(() => {
    setTeams([
      { id: 'TeamA', name: 'Team A' },
      { id: 'TeamB', name: 'Team B' },
      { id: 'TeamC', name: 'Team C' },
    ]);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/player_stats_2025.json');
        if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
        const raw = await res.json();
        console.log("Sample player row:", raw[0]);

        const statsByPlayer = raw.reduce((acc, curr) => {
          const rawName = curr.Player ?? 'Unknown';
          const name = rawName.replace(/[↗↙↑↓→←↔↩↪↵⤴⤵⇧⇩➚➘⤶⤷]+/g, '').trim();
          const team = curr.Team ?? '-';
          const rawPosition = curr.Position ?? 'MID';
          const position = rawPosition.trim().toUpperCase();
          const sc = Number(curr.SC) || 0;

          if (!acc[name]) {
            acc[name] = { name, team, position, totalSC: sc, games: 1 };
          } else {
            acc[name].totalSC += sc;
            acc[name].games += 1;
          }

          return acc;
        }, {} as Record<string, { name: string; team: string; position: string; totalSC: number; games: number }>);

        const normalized: Player[] = Object.values(statsByPlayer).map((p) => ({
          id: p.name,
          name: p.name,
          team: p.team,
          position: p.position,
          average: +(p.totalSC / p.games).toFixed(1),
        }));

        console.log("Normalized players:", normalized.map(p => `${p.id} - ${p.name}`));
        setPlayers(normalized);
      } catch (err) {
        console.error('Failed to load player data:', err);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) {
          clearInterval(interval);
          return 0;
        }
        return +(prev - 0.1).toFixed(2);
      });
    }, 100);

    return () => clearInterval(interval);
  }, [currentPickIndex]);

  const currentTeam = useMemo(() => {
    return teams[currentPickIndex] ?? null;
  }, [teams, currentPickIndex]);

  const myTeamId = teams[0]?.id ?? 'TeamA';
  const yourPickIndex = teams.findIndex((t) => t.id === myTeamId);

  const isMyPick = teams[currentPickIndex]?.id === myTeamId;

  const handleWatchToggle = (playerId: string) => {
    setWatchedIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const handleDraft = (player: Player) => {
    if (!isMyPick || draftedIds.includes(player.id)) return;
    setMyPlayers((prev) => [...prev, player]);
    setDraftedIds((prev) => [...prev, player.id]);
    setTimeLeft(30.0);
    setCurrentPickIndex((prev) => prev + 1);
  };

  const undraftedPlayers = players.filter((p) => !draftedIds.includes(p.id));

  return (
    <div className="min-h-screen w-full">
      <div className="relative w-full bg-gradient-to-r from-blue-700 to-blue-800 text-white px-6 py-6 shadow-md">
        <button
          onClick={() => window.location.reload()}
          className="absolute top-2 right-4 text-sm text-white hover:underline"
        >
          Reset Draft
        </button>
        <DraftBanner
          round={1}
          pick={currentPickIndex + 1}
          yourPickIndex={yourPickIndex}
          timeLeft={timeLeft}
        />
      </div>

      <div className="w-full bg-white px-4 py-3 shadow z-10">
        <div className="max-w-screen-xl mx-auto px-4">
          <DraftOrderBar
            draftOrder={teams}
            currentPickIndex={currentPickIndex}
            myTeam={myTeamId}
            totalTeams={teams.length}
            currentRound={Math.floor(currentPickIndex / teams.length) + 1}
          />
        </div>
      </div>

      <div className="w-full px-6 py-6 bg-gray-50">
        <main className="grid grid-cols-12 gap-4">
          <div className="col-span-3">
            <WatchList
              initialPlayers={players}
              watchedIds={watchedIds}
              onWatchToggle={handleWatchToggle}
            />
          </div>
          <div className="col-span-6">
            <div className="bg-white p-4 rounded shadow h-full">
              <h2 className="text-md font-bold mb-2">Available Players</h2>
              <AvailablePlayersTable
                players={undraftedPlayers}
                isMyPick={isMyPick}
                onDraft={handleDraft}
                onWatchToggle={handleWatchToggle}
                watchedIds={watchedIds}
                onConfirmDraft={handleDraft}
              />
            </div>
          </div>
          <div className="col-span-3">
            <div className="bg-white p-4 rounded shadow h-full">
              <h2 className="text-md font-bold mb-2">Your Team</h2>
              <ul className="text-sm space-y-1 max-h-[600px] overflow-y-auto">
                {myPlayers.map((player) => (
                  <li key={player.id} className="border-b py-1">
                    <span className="font-medium">{player.name}</span> – {player.team} ({player.position})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DraftBoard;