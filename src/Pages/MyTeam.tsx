import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from 'chart.js';
ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useAuth } from '../AuthContext';
import {
  saveUserTeam,
  loadUserTeam,
  saveUserTrades,
  loadUserTrades,
  saveUserPlayerNotes,
  loadUserPlayerNotes,
} from '../firebaseHelpers';
import type { Player } from '../types';
import { fetchFromAPI } from '../lib/api';

function DraggablePlayer({ player }: { player: Player }) {
  const [, drag] = useDrag(() => ({
    type: 'PLAYER',
    item: player,
  }));
  const setDragRef = (node: HTMLDivElement | null) => {
    if (node) drag(node);
  };
  return (
    <div ref={setDragRef} className="p-2 bg-gray-700 text-white rounded mb-1 cursor-move">
      {player.name} ({player.position})
      <div className="text-xs text-gray-300">
        {player.team} |{' '}
        <span className={player.injury ? 'text-red-400' : 'text-green-400'}>
          {player.injury ? 'Injured' : 'Active'}
        </span>
      </div>
    </div>
  );
}

function PositionSlot({
  position,
  players,
  onDrop,
}: {
  position: string;
  players: Player[];
  onDrop: (p: Player) => void;
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: 'PLAYER',
    drop: (item: Player) => onDrop(item),
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  const setDropRef = (node: HTMLDivElement | null) => {
    if (node) drop(node);
  };

  const capitalizeWords = (name: string) => {
    return name.replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div
      ref={setDropRef}
      className={`p-4 border rounded min-h-[80px] ${isOver ? 'bg-green-800' : 'bg-gray-800'}`}
    >
      <h4 className="text-white font-bold mb-2">{position}</h4>
      {players.map((p) => (
        <div key={p.id} className="text-sm text-white mb-1">
          {capitalizeWords(p.name)} ({p.position}) – {p.team}
        </div>
      ))}
      {players.length === 0 && <div className="text-gray-500 text-xs">Drop player here</div>}
      <div className="text-xs text-gray-400 mt-2">{players.length} players</div>
    </div>
  );
}

function PlayerModal({ player, onClose }: { player: Player | null; onClose: () => void }) {
  if (!player) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-400 hover:text-white text-xl font-bold"
        >
          &times;
        </button>
        <h2 className="text-2xl font-bold mb-2">
          {player.name} ({player.position})
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          {player.team} | Status:{' '}
          <span className={player.injury ? 'text-red-400' : 'text-green-400'}>
            {player.injury ? 'Injured' : 'Active'}
          </span>
        </p>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Game-by-Game Stats</h3>
          <div className="text-xs text-gray-300">[Stats chart or table placeholder]</div>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Ownership %</h3>
          <p className="text-xs text-gray-300">42%</p>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Season Average</h3>
          <p className="text-xs text-gray-300">{player.avg || 'N/A'}</p>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Status History</h3>
          <ul className="text-xs text-gray-300 list-disc list-inside">
            <li>Active</li>
            <li>Injured (1 week ago)</li>
            <li>Active (2 weeks ago)</li>
          </ul>
        </section>
        <section className="flex space-x-3 mt-4">
          <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded">
            Add
          </button>
          <button className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded">Drop</button>
          <button className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded">
            Trade
          </button>
        </section>
      </div>
    </div>
  );
}

export default function MyTeam() {
  const { user } = useAuth();
  if (!user) return <div>Please log in to view your team.</div>;

  // Add state for all players loaded from API
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load players from API
  useEffect(() => {
    const loadPlayers = async () => {
      try {
        setLoading(true);
        setError(null);
        const players = await fetchFromAPI<Player[]>('/api/players');
        setAllPlayers(players);
      } catch (err) {
        console.error('Error loading players:', err);
        setError('Failed to load players');
      } finally {
        setLoading(false);
      }
    };

    loadPlayers();
  }, []);

  const [lineup, setLineup] = useState<{ [key: string]: Player[] }>({
    DEF: [],
    MID: [],
    RUC: [],
    FWD: [],
  });
  const [bench, setBench] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Performance Chart Data & Options
  const chartData = {
    labels: ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5'],
    datasets: [
      {
        label: 'Team Total Points',
        data: [820, 860, 890, 910, 875],
        fill: false,
        borderColor: 'rgba(59, 130, 246, 1)',
        tension: 0.1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { labels: { color: 'white' } },
      tooltip: { mode: 'nearest' as const, intersect: false },
    },
    scales: {
      x: { ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } },
      y: { ticks: { color: 'white' }, grid: { color: 'rgba(255,255,255,0.1)' } },
    },
  };

  const handleDrop = (player: Player) => {
    const playerPosition = player.position as string;
    if (
      Object.values(lineup)
        .flat()
        .find((p) => p.id === player.id)
    )
      return;
    if (bench.find((p) => p.id === player.id)) return;

    setLineup((prev) => ({
      ...prev,
      [playerPosition]: [...prev[playerPosition], player],
    }));
  };

  const handleDropToBench = (player: Player) => {
    if (
      Object.values(lineup)
        .flat()
        .find((p) => p.id === player.id)
    )
      return;
    if (bench.find((p) => p.id === player.id)) return;

    setBench((prev) => [...prev, player]);
  };

  // Show loading state
  if (loading) return <div className="p-4">Loading players...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  const transferList = allPlayers.filter(
    (p) =>
      !Object.values(lineup)
        .flat()
        .some((lp) => lp.id === p.id) && !bench.some((b) => b.id === p.id)
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <section className="min-h-screen bg-gray-950 text-white px-6 py-10">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold">My Fantasy Team</h1>
          <a href="/" className="text-indigo-400 hover:text-indigo-200 text-sm underline">
            ← Back to Home
          </a>
        </header>
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-4 text-white">Fantasy Lineup Editor</h2>
          <div className="grid grid-cols-4 gap-4 mb-4">
            {Object.keys(lineup).map((pos) => (
              <PositionSlot key={pos} position={pos} players={lineup[pos]} onDrop={handleDrop} />
            ))}
          </div>
          {/* Bench area below lineup */}
          <div className="mb-8">
            <h4 className="text-white font-bold mb-2">Bench</h4>
            <div className="grid grid-cols-4 gap-4">
              {bench.length === 0 && <div className="text-gray-500 text-xs">Drop players here</div>}
              {bench.map((p) => (
                <div key={p.id} className="p-4 border rounded bg-gray-800 text-white text-sm">
                  {p.name} ({p.position})
                </div>
              ))}
              <div className="p-4 border rounded min-h-[80px] border-dashed border-gray-600 bg-gray-800">
                Drop player here
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setLineup({ DEF: [], MID: [], RUC: [], FWD: [] });
              setBench([]);
            }}
            className="mb-8 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded"
          >
            Clear Lineup
          </button>
        </div>

        {/* Performance Chart Section */}
        <div className="bg-gray-800 p-4 rounded-lg mt-8">
          <h2 className="text-xl font-semibold text-white mb-2">Performance Chart</h2>
          <Line data={chartData} options={chartOptions} />
        </div>

        {/* Free Agents Section */}
        <section className="mt-12">
          <h3 className="text-2xl font-bold mb-4">Available Players</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {transferList.map((player) => (
              <DraggablePlayer key={player.id} player={player} />
            ))}
          </div>
        </section>

        <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      </section>
    </DndProvider>
  );
}
