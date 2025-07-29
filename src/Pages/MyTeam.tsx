import React, { useState, useEffect } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend } from "chart.js";
ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useAuth } from "../AuthContext";
import { saveUserTeam, loadUserTeam, saveUserTrades, loadUserTrades, saveUserPlayerNotes, loadUserPlayerNotes } from "../firebaseHelpers";
// Ensure Player includes extended fields used in charts and summaries

type Player = {
  id: string;
  name: string;
  position: "DEF" | "MID" | "RUC" | "FWD";
  team: string;
  cost: number;
  status: string;
  byeRound: number;
  gamesMissedInjury: number;
  gamesMissedOmitted: number;
  kicks: number;
  kicks_rank: number;
  handballs: number;
  handballs_rank: number;
  marks: number;
  marks_rank: number;
  tackles: number;
  tackles_rank: number;
  goals: number;
  goals_rank: number;
  hitouts: number;
  hitouts_rank: number;
  clearances: number;
  clearances_rank: number;
  inside50s: number;
  inside50s_rank: number;
  rebound50s: number;
  rebound50s_rank: number;
  contestedPossessions: number;
  contestedPossessions_rank: number;
  stats?: {
    [key: string]: number | null;
  };
};

const allPlayers: Player[] = [
  {
    id: "1",
    name: "Nick Daicos",
    position: "DEF",
    team: "Collingwood",
    cost: 750000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "2",
    name: "Christian Petracca",
    position: "MID",
    team: "Melbourne",
    cost: 830000,
    status: "Injured",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "3",
    name: "Max Gawn",
    position: "RUC",
    team: "Melbourne",
    cost: 900000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "4",
    name: "Charlie Curnow",
    position: "FWD",
    team: "Carlton",
    cost: 650000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "5",
    name: "Zach Merrett",
    position: "MID",
    team: "Essendon",
    cost: 810000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "6",
    name: "Darcy Moore",
    position: "DEF",
    team: "Collingwood",
    cost: 720000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  },
  {
    id: "7",
    name: "Rowan Marshall",
    position: "RUC",
    team: "St Kilda",
    cost: 850000,
    status: "Active",
    byeRound: 15,
    gamesMissedInjury: 0,
    gamesMissedOmitted: 0,
    kicks: 0,
    kicks_rank: 0,
    handballs: 0,
    handballs_rank: 0,
    marks: 0,
    marks_rank: 0,
    tackles: 0,
    tackles_rank: 0,
    goals: 0,
    goals_rank: 0,
    hitouts: 0,
    hitouts_rank: 0,
    clearances: 0,
    clearances_rank: 0,
    inside50s: 0,
    inside50s_rank: 0,
    rebound50s: 0,
    rebound50s_rank: 0,
    contestedPossessions: 0,
    contestedPossessions_rank: 0
  }
];

const positionLimits = {
  DEF: 2,
  MID: 2,
  RUC: 1,
  FWD: 2
};
const salaryCap = 4000000;

function DraggablePlayer({ player }: { player: Player }) {
  const [, drag] = useDrag(() => ({
    type: "PLAYER",
    item: player
  }));
  // Use a callback ref to avoid type error
  const setDragRef = (node: HTMLDivElement | null) => {
    if (node) drag(node);
  };
  return (
    <div ref={setDragRef} className="p-2 bg-gray-700 text-white rounded mb-1 cursor-move">
      {player.name} ({player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""}) - ${player.cost.toLocaleString()}
      <div className="text-xs text-gray-300">
        {player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""} | <span className={player.status === "Injured" ? "text-red-400" : "text-green-400"}>{player.status}</span>
      </div>
    </div>
  );
}

function PositionSlot({ position, players, onDrop }: { position: string; players: Player[]; onDrop: (p: Player) => void }) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: "PLAYER",
    drop: (item: Player) => onDrop(item),
    collect: (monitor) => ({
      isOver: monitor.isOver()
    })
  }));
  // Use a callback ref to avoid type error with drop
  const setDropRef = (node: HTMLDivElement | null) => {
    if (node) drop(node);
  };
  function capitalizeWords(name: string): React.ReactNode {
    throw new Error("Function not implemented.");
  }

  return (
    <div ref={setDropRef} className={`p-4 border rounded min-h-[80px] ${isOver ? "bg-green-800" : "bg-gray-800"}`}>
      <h4 className="text-white font-bold mb-2">{position}</h4>
      {players.map((p) => (
        <div key={p.id} className="text-sm text-white mb-1">
          {capitalizeWords(p.name)} ({p.position ? p.position.charAt(0).toUpperCase() + p.position.slice(1).toLowerCase() : ""}) – {p.team ? p.team.charAt(0).toUpperCase() + p.team.slice(1).toLowerCase() : ""}
        </div>
      ))}
      {players.length === 0 && <div className="text-gray-500 text-xs">Drop player here</div>}
      <div className="text-xs text-gray-400 mt-2">{players.length}/{positionLimits[position as keyof typeof positionLimits]} slots</div>
    </div>
  );
}

function PlayerModal({ player, onClose }: { player: Player | null; onClose: () => void }) {
  if (!player) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-white text-xl font-bold">&times;</button>
        <h2 className="text-2xl font-bold mb-2">{player.name} ({player.position})</h2>
        <p className="text-sm text-gray-400 mb-4">{player.team} | Status: <span className={player.status === "Injured" ? "text-red-400" : "text-green-400"}>{player.status}</span></p>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Game-by-Game Stats (mock)</h3>
          <div className="text-xs text-gray-300">[Stats chart or table placeholder]</div>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Ownership %</h3>
          <p className="text-xs text-gray-300">42%</p>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Average</h3>
          <p className="text-xs text-gray-300">{(player.cost / 10000).toFixed(1)}</p>
        </section>
        <section className="mb-4">
          <h3 className="font-semibold mb-1">Status History (mock)</h3>
          <ul className="text-xs text-gray-300 list-disc list-inside">
            <li>Active</li>
            <li>Injured (1 week ago)</li>
            <li>Active (2 weeks ago)</li>
          </ul>
        </section>
        <section className="flex space-x-3 mt-4">
          <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded">Add</button>
          <button className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded">Drop</button>
          <button className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded">Trade</button>
        </section>
      </div>
    </div>
  );
}

// --- Performance Chart data for team ---

export default function MyTeam() {
  const { user } = useAuth();
  if (!user) return <div>Please log in to view your team.</div>;

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
  const [lineup, setLineup] = useState<{ [key: string]: Player[] }>({
    DEF: [],
    MID: [],
    RUC: [],
    FWD: []
  });
  const [bench, setBench] = useState<Player[]>([]);

  const [budget, setBudget] = useState<number>(salaryCap);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const [tradeFilter, setTradeFilter] = useState<"Owned" | "Free Agents" | "Waivers">("Free Agents");
  const [positionFilter, setPositionFilter] = useState<"All" | "DEF" | "MID" | "RUC" | "FWD">("All");
  const [avgFilter, setAvgFilter] = useState<number | "">("");
  const [gamesFilter, setGamesFilter] = useState<number | "">("");
  const [healthyOnly, setHealthyOnly] = useState<boolean>(false);
  // Stat Qualifier filter states
  const [statQualifier, setStatQualifier] = useState("Off");
  const [statThreshold, setStatThreshold] = useState(0);

  // Persist statQualifier and statThreshold across tabs using localStorage
  useEffect(() => {
    const savedStat = localStorage.getItem("statQualifier");
    const savedThreshold = localStorage.getItem("statThreshold");
    if (savedStat) setStatQualifier(savedStat);
    if (savedThreshold) setStatThreshold(parseInt(savedThreshold));
  }, []);
  // Sort stat state
  const [sortStat, setSortStat] = useState("");

  // Stat filter states for trade market
  const [selectedStat, setSelectedStat] = useState("");
  const [statMin, setStatMin] = useState<number | null>(null);
  const [statMax, setStatMax] = useState<number | null>(null);

  // Stat period state for player stats table
  const [statPeriod, setStatPeriod] = useState("season");

  // Timeframe state for table stat display (custom selector)
  const [timeframe, setTimeframe] = useState("season");


  // Function to get stat average based on selected timeframe
  // Defensive: fallback to cost/10000 if no stat
  const getStatAvg = (player: any) => {
    if (timeframe === "last3" && player.avgLast3 !== undefined) return player.avgLast3;
    if (timeframe === "last5" && player.avgLast5 !== undefined) return player.avgLast5;
    if (timeframe === "24months" && player.avg24Months !== undefined) return player.avg24Months;
    // fallback: use cost/10000 if no stat
    if (player.avg !== undefined) return player.avg;
    return (player.cost / 10000).toFixed(1);
  };

  // Helper to get stat by period
  const getStatByPeriod = (player: any, statKey: string) => {
    switch (statPeriod) {
      case "last3":
        return player.last3?.[statKey] ?? "-";
      case "last5":
        return player.last5?.[statKey] ?? "-";
      case "24months":
        return player.last24Months?.[statKey] ?? "-";
      default:
        return player.stats?.[statKey] ?? "-";
    }
  };

  // Defensive: fallback for stat total
  const getStatTotal = (player: any) => {
    // If stat total exists, return, else fallback
    if (player.total !== undefined) return player.total;
    // fallback: cost/1000
    return (player.cost / 1000).toFixed(0);
  };

  // Injury & News Feed mock data and category filter state
  const newsFeed = [
    { id: 1, player: "Christian Petracca", team: "Melbourne", category: "Injuries", note: "Knee soreness – Test", time: "1h ago" },
    { id: 2, player: "Tom Stewart", team: "Geelong", category: "Team News", note: "Named to return after rest", time: "2h ago" },
    { id: 3, player: "Toby Greene", team: "GWS", category: "Suspensions", note: "1-match ban upheld", time: "4h ago" },
    { id: 4, player: "Tim Taranto", team: "Richmond", category: "Injuries", note: "Calf strain – 2 weeks", time: "6h ago" },
    { id: 5, player: "Bailey Smith", team: "Western Bulldogs", category: "Team News", note: "Moved to midfield group", time: "8h ago" },
  ];
  const [category, setCategory] = useState<string>("All");
  const filteredNews = category === "All" ? newsFeed : newsFeed.filter(n => n.category === category);

  // State for round snapshots of teams
  const [roundTeams, setRoundTeams] = useState<{ [round: number]: { [key: string]: Player[] } }>({});
  const [selectedRound, setSelectedRound] = useState<number | "">("");

  // Trade proposals mock state and log
  const [proposals, setProposals] = useState<{ id: number; team: string; player: string; status: "Pending" | "Accepted" | "Rejected" }[]>([]);
  const [proposalTeam, setProposalTeam] = useState<string>("");
  const [proposalPlayer, setProposalPlayer] = useState<string>("");
  const [proposalLog, setProposalLog] = useState<string[]>([]);

  const handleDrop = (player: Player) => {
    if (lineup[player.position].length >= positionLimits[player.position]) return;
    if (budget - player.cost < 0) return;
    if (Object.values(lineup).flat().find((p) => p.id === player.id)) return;
    if (bench.find(p => p.id === player.id)) return;

    setLineup((prev) => ({
      ...prev,
      [player.position]: [...prev[player.position], player]
    }));
    setBudget((prev) => prev - player.cost);
  };

  const handleDropToBench = (player: Player) => {
    if (bench.length >= 4) return;
    if (budget - player.cost < 0) return;
    if (Object.values(lineup).flat().find((p) => p.id === player.id)) return;
    if (bench.find(p => p.id === player.id)) return;

    setBench((prev) => [...prev, player]);
    setBudget((prev) => prev - player.cost);
  };

  const transferList = allPlayers.filter(
    (p) => !Object.values(lineup).flat().some((lp) => lp.id === p.id) && !bench.some(b => b.id === p.id)
  );

  // Filter Trade Market players by health, avg, games played
  const tablePlayers =
    tradeFilter === "Free Agents"
      ? transferList
      : tradeFilter === "Owned"
        ? Object.values(lineup).flat()
        : [
            { ...allPlayers[6], team: "Snaggers" },
            { ...allPlayers[2], team: "Bambang's Best" }
          ];

  // Stat threshold filter logic
  const meetsStatThreshold = (player: any) => {
    if (statQualifier === "Off") return true;
    const statValue = player[statQualifier.toLowerCase()] ?? 0;
    return statValue >= statThreshold;
  };

  const filteredPlayers = tablePlayers
    .filter(p => positionFilter === "All" || p.position === positionFilter)
    .filter(p => !healthyOnly || p.status !== "Injured")
    .filter(p => avgFilter === "" || (p.cost / 10000) >= avgFilter)
    .filter(p => gamesFilter === "" || 10 >= gamesFilter)
    .filter(meetsStatThreshold);

  // Additional stat filter (after other filters)
  const statFilteredPlayers = filteredPlayers.filter((player) => {
    if (selectedStat) {
      const value = player.stats?.[selectedStat];
      if (value == null) return false;
      if (statMin !== null && value < statMin) return false;
      if (statMax !== null && value > statMax) return false;
    }
    return true;
  });

  // Sorted by selected stat
  const sortedPlayers = [...statFilteredPlayers].sort((a, b) => {
    if (!sortStat) return 0;
    // Only allow sorting by known numeric keys of Player
    const aValue = (a as any)[sortStat] ?? 0;
    const bValue = (b as any)[sortStat] ?? 0;
    return bValue - aValue;
  });

  // Handle proposal submission
  const submitProposal = () => {
    if (!proposalTeam || !proposalPlayer) return;
    const newProposal = {
      id: proposals.length + 1,
      team: proposalTeam,
      player: proposalPlayer,
      status: "Pending" as const
    };
    setProposals(prev => [...prev, newProposal]);
    setProposalLog(prev => [...prev, `Proposal #${newProposal.id} sent to ${proposalTeam} for player ${proposalPlayer}`]);
    setProposalTeam("");
    setProposalPlayer("");
  };

  // Handle accept/reject proposal
  const handleProposalResponse = (id: number, accepted: boolean) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, status: accepted ? "Accepted" : "Rejected" } : p));
    setProposalLog(prev => [...prev, `Proposal #${id} was ${accepted ? "accepted" : "rejected"}`]);
  };

  // Handle round selection change
  const handleRoundChange = (round: number | "") => {
    setSelectedRound(round);
    if (round !== "") {
      const snapshot = roundTeams[round];
      if (snapshot) {
        setLineup(snapshot);
      }
    }
  };

  // Tag and notes state per player id
  const [playerTags, setPlayerTags] = useState<{ [playerId: string]: string }>({});
  const [playerNotes, setPlayerNotes] = useState<{ [playerId: string]: string }>({});

  // Handle tag change
  const handleTagChange = (playerId: string, tag: string) => {
    setPlayerTags(prev => ({ ...prev, [playerId]: tag }));
  };

  // Handle notes change
  const handleNotesChange = (playerId: string, note: string) => {
    setPlayerNotes(prev => ({ ...prev, [playerId]: note }));
  };

  // Load user team from Firestore on login
  useEffect(() => {
    if (!user?.uid) return;
    loadUserTeam(user.uid).then((data) => {
      setLineup(data.lineup);
      setBench(data.bench);
      setBudget(data.budget);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Save user team to Firestore when lineup, bench, or budget changes
  useEffect(() => {
    if (!user?.uid) return;
    saveUserTeam(user.uid, lineup, bench, budget);
  }, [user?.uid, lineup, bench, budget]);

  // Load user trades from Firestore on login
  useEffect(() => {
    if (!user?.uid) return;
    loadUserTrades(user.uid).then((data) => {
      if (Array.isArray(data)) setProposals(data);
    });
  }, [user?.uid]);

  // Save user trades to Firestore when proposals change
  useEffect(() => {
    if (!user?.uid) return;
    saveUserTrades(user.uid, proposals);
  }, [user?.uid, proposals]);

  // Load player notes/tags from Firestore on login
  useEffect(() => {
    if (!user?.uid) return;
    loadUserPlayerNotes(user.uid).then((data) => {
      setPlayerNotes(data.playerNotes);
      setPlayerTags(data.playerTags);
    });
  }, [user?.uid]);

  // Save player notes/tags to Firestore when changed
  useEffect(() => {
    if (!user?.uid) return;
    saveUserPlayerNotes(user.uid, playerNotes, playerTags);
  }, [user?.uid, playerNotes, playerTags]);

  return (
    <DndProvider backend={HTML5Backend}>
      <section className="min-h-screen bg-gray-950 text-white px-6 py-10">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold">My Fantasy Team</h1>
          <a href="/" className="text-indigo-400 hover:text-indigo-200 text-sm underline">← Back to Home</a>
        </header>
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-4 text-white">Fantasy Lineup Editor</h2>
          <p className="text-gray-400 mb-4">Salary Cap Remaining: ${budget.toLocaleString()}</p>
          <div className="grid grid-cols-4 gap-4 mb-4">
            {Object.keys(lineup).map((pos) => (
              <PositionSlot key={pos} position={pos} players={lineup[pos]} onDrop={handleDrop} />
            ))}
          </div>
          {/* Bench area below lineup */}
          <div className="mb-8">
            <h4 className="text-white font-bold mb-2">Bench (Max 4 players)</h4>
            <div className="grid grid-cols-4 gap-4">
              {bench.length === 0 && <div className="text-gray-500 text-xs">Drop players here</div>}
              {bench.map((p) => (
                <div key={p.id} className="p-4 border rounded bg-gray-800 text-white text-sm">
                  {p.name} ({p.position ? p.position.charAt(0).toUpperCase() + p.position.slice(1).toLowerCase() : ""}) - ${p.cost.toLocaleString()}
                </div>
              ))}
              <div
                className={`p-4 border rounded min-h-[80px] border-dashed border-gray-600 ${bench.length < 4 ? "bg-gray-800" : "bg-gray-700 cursor-not-allowed"}`}
              >
                {bench.length < 4 ? "Drop player here" : "Bench full"}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setLineup({ DEF: [], MID: [], RUC: [], FWD: [] });
              setBench([]);
              setBudget(salaryCap);
            }}
            className="mb-8 bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded"
          >
            Clear Lineup
          </button>
        </div>

        {/* Trade Market */}
        <div className="mt-12 relative">
          <h3 className="text-2xl font-bold mb-4">Trade Market</h3>

          {/* AI Recommendations box top right */}
          <div className="absolute top-0 right-0 bg-gray-800 p-4 rounded shadow-md w-72 text-sm text-white mb-4">
            <h4 className="font-semibold mb-2">AI Recommendations</h4>
            <ul className="list-disc list-inside space-y-1">
              <li>Suggesting trade for Max Gawn based on RUC depth...</li>
              <li>Consider dropping injured players to free cap space.</li>
              <li>Strong midfielders available under salary cap.</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-4 mb-4">
            <select
              value={tradeFilter}
              onChange={(e) => setTradeFilter(e.target.value as "Owned" | "Free Agents" | "Waivers")}
              className="px-4 py-2 bg-gray-800 text-white border border-gray-600 rounded"
            >
              <option value="Owned">Owned Players</option>
              <option value="Free Agents">Free Agents</option>
              <option value="Waivers">Waiver Wire</option>
            </select>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value as "All" | "DEF" | "MID" | "RUC" | "FWD")}
              className="px-4 py-2 bg-gray-800 text-white border border-gray-600 rounded"
            >
              <option value="All">All Positions</option>
              <option value="DEF">Defenders</option>
              <option value="MID">Midfielders</option>
              <option value="RUC">Rucks</option>
              <option value="FWD">Forwards</option>
            </select>
            <select
              value={selectedStat}
              onChange={(e) => setSelectedStat(e.target.value)}
              className="bg-gray-800 text-white rounded px-4 py-2 mr-2"
            >
              <option value="">Stat Filter</option>
              <option value="kicks">Kicks</option>
              <option value="handballs">Handballs</option>
              <option value="marks">Marks</option>
              <option value="tackles">Tackles</option>
              <option value="goals">Goals</option>
              <option value="hitouts">Hitouts</option>
              <option value="clearances">Clearances</option>
              <option value="inside50s">Inside 50s</option>
              <option value="rebound50s">Rebound 50s</option>
              <option value="contestedPossessions">Contested Possessions</option>
            </select>
            <input
              type="number"
              value={statMin === null ? "" : statMin}
              onChange={(e) => setStatMin(e.target.value === "" ? null : Number(e.target.value))}
              placeholder="Min"
              className="w-20 bg-gray-800 text-white rounded px-2 py-1 mr-2"
            />
            <input
              type="number"
              value={statMax === null ? "" : statMax}
              onChange={(e) => setStatMax(e.target.value === "" ? null : Number(e.target.value))}
              placeholder="Max"
              className="w-20 bg-gray-800 text-white rounded px-2 py-1 mr-2"
            />
            {/* Min Avg SC filter removed */}
            <input
              type="number"
              placeholder="Min Games Played"
              value={gamesFilter}
              onChange={e => setGamesFilter(e.target.value === "" ? "" : Number(e.target.value))}
              className="px-4 py-2 bg-gray-800 text-white border border-gray-600 rounded w-32"
            />
            <label className="flex items-center space-x-2 text-sm">
              <input
                type="checkbox"
                checked={healthyOnly}
                onChange={e => setHealthyOnly(e.target.checked)}
                className="form-checkbox"
              />
              <span>Healthy Only</span>
            </label>
            <select
              value={sortStat}
              onChange={(e) => setSortStat(e.target.value)}
              className="bg-gray-800 text-white px-2 py-1 rounded ml-4"
            >
              <option value="">Sort By</option>
              <option value="kicks">Kicks</option>
              <option value="handballs">Handballs</option>
              <option value="marks">Marks</option>
              <option value="tackles">Tackles</option>
              <option value="goals">Goals</option>
            </select>
            {/* Timeframe dropdown for stat averages */}
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="rounded px-3 py-1 bg-gray-700 text-white"
            >
              <option value="season">Season Avg</option>
              <option value="last3">Last 3 Rounds</option>
              <option value="last5">Last 5 Rounds</option>
              <option value="24months">Last 24 Months</option>
            </select>
          </div>
          {/* Stat period dropdown */}
          <div className="mb-4">
            <label className="text-white mr-2">Stats Period:</label>
            <select
              value={statPeriod}
              onChange={(e) => setStatPeriod(e.target.value)}
              className="bg-gray-800 text-white px-2 py-1 rounded"
            >
              <option value="season">Season Avg</option>
              <option value="last3">Last 3 Rounds</option>
              <option value="last5">Last 5 Rounds</option>
              <option value="24months">Last 24 Months</option>
            </select>
          </div>
          {/* Stat avg/total getter functions by timeframe */}

          <div className="overflow-x-auto">
            <table className="min-w-full bg-gray-900 text-white text-sm rounded overflow-hidden">
              <thead className="bg-gray-800 text-gray-300">
                <tr>
                  <th className="text-left p-2">Player</th>
                  <th className="text-left p-2">Team</th>
                  <th className="text-left p-2">Position</th>
                  <th className="text-right p-2">Cost</th>
                  <th className="text-center p-2">Status</th>
                  <th className="text-right p-2">Avg</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Kicks (Avg)</th>
                  <th className="text-center p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-gray-400 py-6">No players found.</td>
                  </tr>
                ) : (
                  sortedPlayers.map((player) => (
                    <tr key={player.id} className="border-b border-gray-700 hover:bg-gray-800 cursor-pointer" onClick={() => setSelectedPlayer(player)}>
                      <td className="p-2">{player.name}</td>
                      <td className="p-2">{player.team}</td>
                      <td className="p-2">{player.position}</td>
                      <td className="p-2 text-right">${player.cost.toLocaleString()}</td>
                      <td className="p-2 text-center">
                        <span className={player.status === "Injured" ? "text-red-400" : "text-green-400"}>
                          {player.status}
                        </span>
                      </td>
                      <td className="p-2 text-right">{getStatAvg(player)}</td>
                      <td className="p-2 text-right">{getStatTotal(player)}</td>
                      <td className="p-2 text-right">{getStatByPeriod(player, "kicks")}</td>
                      <td className="p-2 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDrop(player); }}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded"
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Trade Proposals Section */}
          <section className="mt-8 bg-gray-900 p-4 rounded">
            <h4 className="text-xl font-bold mb-3">Trade Proposals</h4>
            <div className="flex flex-wrap gap-4 mb-4">
              <select
                value={proposalTeam}
                onChange={e => setProposalTeam(e.target.value)}
                className="bg-gray-800 text-white px-3 py-2 rounded"
              >
                <option value="">Select Team</option>
                <option value="Bambang's Best">Bambang's Best</option>
                <option value="The Crumbers">The Crumbers</option>
                <option value="Snaggers">Snaggers</option>
              </select>
              <input
                type="text"
                placeholder="Player Name"
                value={proposalPlayer}
                onChange={e => setProposalPlayer(e.target.value)}
                className="bg-gray-800 text-white px-3 py-2 rounded flex-grow min-w-[150px]"
              />
              <button
                onClick={submitProposal}
                className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-white"
              >
                Submit Proposal
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto text-sm">
              {proposals.length === 0 && <p className="text-gray-400">No proposals yet.</p>}
              {proposals.map(p => (
                <div key={p.id} className="flex justify-between items-center border-b border-gray-700 py-1">
                  <div>
                    <span className="font-semibold">#{p.id}</span> to <span className="italic">{p.team}</span> for <span>{p.player}</span> - <span>{p.status}</span>
                  </div>
                  {p.status === "Pending" && (
                    <div className="space-x-2">
                      <button onClick={() => handleProposalResponse(p.id, true)} className="bg-green-600 hover:bg-green-500 px-2 py-1 rounded text-white text-xs">Accept</button>
                      <button onClick={() => handleProposalResponse(p.id, false)} className="bg-red-600 hover:bg-red-500 px-2 py-1 rounded text-white text-xs">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-gray-400 max-h-24 overflow-y-auto border-t border-gray-700 pt-2">
              <h5 className="font-semibold mb-1">Proposal Log</h5>
              {proposalLog.length === 0 ? <p>No logs yet.</p> : (
                <ul className="list-disc list-inside">
                  {proposalLog.map((log, idx) => <li key={idx}>{log}</li>)}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* Injury & News Feed Widget */}
        <div className="mt-12">
          <h3 className="text-2xl font-bold mb-4">Injury & News Feed</h3>
          <div className="flex space-x-4 mb-4">
            {["All", "Injuries", "Suspensions", "Team News"].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 rounded-full text-sm ${
                  category === cat ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="bg-gray-900 rounded-lg p-4 max-h-72 overflow-y-auto space-y-3">
            {filteredNews.map((n) => (
              <div key={n.id} className="border-b border-gray-700 pb-2">
                <p className="text-sm font-semibold text-white">{n.player} <span className="text-xs text-gray-400">({n.team})</span></p>
                <p className="text-xs text-gray-400">{n.note}</p>
                <p className="text-xs text-indigo-400 italic">{n.time} — {n.category}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Your Team Summary */}
        <div className="mt-12">
          <h3 className="text-2xl font-bold mb-6">Your Team</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {["DEF", "MID", "RUC", "FWD"].map((posKey) => {
              const players = lineup[posKey];
              const labelMap: Record<string, string> = {
                DEF: "Defenders",
                MID: "Midfielders",
                RUC: "Rucks",
                FWD: "Forwards"
              };
              return (
                <div key={posKey} className="position-tile bg-gray-900 rounded p-4">
                  <h4 className="text-lg font-semibold mb-3">{labelMap[posKey]}</h4>
                  {players.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No players selected</p>
                  ) : (
                    players.map((p) => (
                      <div key={p.id} className="mb-4 border-b border-gray-700 pb-2">
                        <p className="text-sm font-medium text-white">{p.name}</p>
                        <p className="text-xs text-gray-400">
                          {p.team ? p.team.charAt(0).toUpperCase() + p.team.slice(1).toLowerCase() : ""} • ${p.cost.toLocaleString()} •{" "}
                          <span className={p.status === "Injured" ? "text-red-400" : "text-green-400"}>{p.status}</span>
                        </p>
                        <div className="mt-2">
                          <label className="block text-xs font-semibold mb-1">Tag:</label>
                          <select
                            value={playerTags[p.id] || ""}
                            onChange={e => handleTagChange(p.id, e.target.value)}
                            className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs"
                          >
                            <option value="">Select tag</option>
                            <option value="Star">Star</option>
                            <option value="Injured">Injured</option>
                            <option value="Trade Target">Trade Target</option>
                            <option value="Bench">Bench</option>
                          </select>
                        </div>
                        <div className="mt-2">
                          <label className="block text-xs font-semibold mb-1">Notes:</label>
                          <textarea
                            value={playerNotes[p.id] || ""}
                            onChange={e => handleNotesChange(p.id, e.target.value)}
                            className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs resize-none"
                            rows={2}
                            placeholder="Add notes..."
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Performance Chart Section */}
        <div className="bg-gray-800 p-4 rounded-lg mt-8">
          <h2 className="text-xl font-semibold text-white mb-2">Performance Chart</h2>
          <Line data={chartData} options={chartOptions} />
        </div>

        {/* Round teams snapshot select */}
        <section className="mt-12 bg-gray-900 p-4 rounded">
          <h3 className="text-2xl font-bold mb-4">Saved Teams by Round</h3>
          <select
            value={selectedRound}
            onChange={e => handleRoundChange(e.target.value === "" ? "" : Number(e.target.value))}
            className="bg-gray-800 text-white px-3 py-2 rounded"
          >
            <option value="">Select Round</option>
            {Object.keys(roundTeams).map(r => (
              <option key={r} value={r}>Round {r}</option>
            ))}
          </select>
          {selectedRound !== "" && (
            <div className="mt-4 text-gray-300 text-sm">
              Loaded team snapshot for round {selectedRound}.
            </div>
          )}
        </section>


        {/* Other Teams Section */}
        <section className="mt-12">
          <h3 className="text-2xl font-bold mb-4">Other Teams</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { teamName: "Bambang's Best", players: [allPlayers[1], allPlayers[4]] },
              { teamName: "The Crumbers", players: [allPlayers[3], allPlayers[5]] }
            ].map((team, idx) => (
              <div key={idx} className="bg-gray-900 rounded-lg p-4">
                <h4 className="text-lg font-semibold text-white mb-2">{team.teamName}</h4>
                {team.players.map((p) => (
                  <div key={p.id} className="text-sm text-white mb-1">
                    {p.name} ({p.position ? p.position.charAt(0).toUpperCase() + p.position.slice(1).toLowerCase() : ""}) – {p.team ? p.team.charAt(0).toUpperCase() + p.team.slice(1).toLowerCase() : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* Free Agents Section */}
        <section className="mt-12">
          <h3 className="text-2xl font-bold mb-4">Free Agents</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {transferList.map((player) => (
              <div key={player.id} className="bg-gray-800 rounded p-3 text-sm text-white">
                <p className="font-semibold">{player.name}</p>
                <p className="text-xs text-gray-400">{player.team ? player.team.charAt(0).toUpperCase() + player.team.slice(1).toLowerCase() : ""} • {player.position ? player.position.charAt(0).toUpperCase() + player.position.slice(1).toLowerCase() : ""}</p>
                <p className="text-xs text-indigo-400">${player.cost.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Waiver Wire Section with bid input and highest bid display */}
        <section className="mt-12">
          <h3 className="text-2xl font-bold mb-4">Waiver Wire</h3>
          <div className="bg-gray-900 rounded-lg p-4 space-y-3">
            {[
              { order: 1, team: "Snaggers", player: allPlayers[6] },
              { order: 2, team: "Bambang's Best", player: allPlayers[2] }
            ].map((w, idx) => {
              const [bid, setBid] = useState<string>("");
              const [highestBid, setHighestBid] = useState<number>(0);
              const handleBidChange = (value: string) => {
                setBid(value);
                const num = Number(value);
                if (!isNaN(num) && num > highestBid) {
                  setHighestBid(num);
                }
              };
              return (
                <div key={idx} className="text-sm text-white border-b border-gray-700 pb-2 flex flex-col md:flex-row md:items-center md:justify-between space-y-2 md:space-y-0">
                  <div>
                    <p className="font-semibold">{w.order}. {w.team}</p>
                    <p className="text-xs text-gray-400">{w.player.name} • {w.player.position ? w.player.position.charAt(0).toUpperCase() + w.player.position.slice(1).toLowerCase() : ""} • {w.player.team ? w.player.team.charAt(0).toUpperCase() + w.player.team.slice(1).toLowerCase() : ""}</p>
                    <p className="text-xs text-indigo-400">Highest Bid: ${highestBid.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="0"
                      placeholder="Your Bid"
                      value={bid}
                      onChange={e => handleBidChange(e.target.value)}
                      className="bg-gray-800 text-white px-2 py-1 rounded w-24 text-xs"
                      onClick={e => e.stopPropagation()}
                    />
                    <button
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-xs"
                      onClick={e => {
                        e.stopPropagation();
                        const numBid = Number(bid);
                        if (!isNaN(numBid) && numBid > highestBid) {
                          setHighestBid(numBid);
                          setBid("");
                        }
                      }}
                    >
                      Place Bid
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <PlayerModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
      </section>
    </DndProvider>
  );
}

// Persist statQualifier and statThreshold across tabs using localStorage
// (Moved outside of component previously, must be inside component. Already handled above)