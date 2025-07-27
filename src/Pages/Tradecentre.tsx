
import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Player } from '../types';
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FaPlus, FaTimes } from "react-icons/fa";
// Stat categories for per-player stat display
const statCategories = [
  { key: 'kicks', label: 'Kicks' },
  { key: 'handballs', label: 'Handballs' },
  { key: 'marks', label: 'Marks' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'goals', label: 'Goals' },
  { key: 'hitouts', label: 'Hitouts' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'inside50s', label: 'Inside 50s' },
  { key: 'rebound50s', label: 'Rebound 50s' },
  { key: 'contestedPossessions', label: 'CP' },
];
import axios from "axios";
import aflPlayers from "../Data/aflPlayers";

// Helper to render comment text with inline GIFs
const renderCommentWithGIFs = (text: string) => {
  const gifRegex = /\[GIF:(https:\/\/[^\]]+)\]/g;
  const parts = text.split(gifRegex);
  return parts.map((part, index) =>
    part.startsWith("http") ? (
      <img key={index} src={part} alt="GIF" className="inline-block h-20 mx-1" />
    ) : (
      <span key={index}>{part}</span>
    )
  );
};

const TradeCentre = () => {
  // Build playerStats dictionary for quick lookup (id -> stats/ranks)
  const playerStats = useMemo(() => {
    // Assume aflPlayers contains all players, and each player has stat/rank fields
    const statsDict = {};
    for (const p of aflPlayers) {
      statsDict[p.id] = {
        kicks: p.kicks ?? null,
        kicksRank: p.kicks_rank ?? null,
        handballs: p.handballs ?? null,
        handballsRank: p.handballs_rank ?? null,
        marks: p.marks ?? null,
        marksRank: p.marks_rank ?? null,
        tackles: p.tackles ?? null,
        tacklesRank: p.tackles_rank ?? null,
        goals: p.goals ?? null,
        goalsRank: p.goals_rank ?? null,
        hitouts: p.hitouts ?? null,
        hitoutsRank: p.hitouts_rank ?? null,
        clearances: p.clearances ?? null,
        clearancesRank: p.clearances_rank ?? null,
        inside50s: p.inside50s ?? null,
        inside50sRank: p.inside50s_rank ?? null,
        rebound50s: p.rebound50s ?? null,
        rebound50sRank: p.rebound50s_rank ?? null,
        contestedPossessions: p.contestedPossessions ?? null,
        contestedPossessionsRank: p.contestedPossessions_rank ?? null,
      };
    }
    return statsDict;
  }, []);
  const initialMyTeamRef = useRef<Player[]>(aflPlayers.slice(0, 10));
  const initialOpponentTeamRef = useRef<Player[]>(aflPlayers.slice(10, 20));
  const initialThirdTeamRef = useRef<Player[]>(aflPlayers.slice(20, 30));

  const [myTeam, setMyTeam] = useState<Player[]>(initialMyTeamRef.current);
  const [opponentTeam, setOpponentTeam] = useState<Player[]>(initialOpponentTeamRef.current);
  const [thirdTeam, setThirdTeam] = useState<Player[]>(initialThirdTeamRef.current);
  const [positionFilter, setPositionFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  // Removed unused selectedMyPlayers and selectedOpponentPlayers
  const [selectedTeamAPlayers, setSelectedTeamAPlayers] = useState<number[]>([]);
  const [selectedTeamBPlayers, setSelectedTeamBPlayers] = useState<number[]>([]);
  const [selectedTeamCPlayers, setSelectedTeamCPlayers] = useState<number[]>([]);
  // Removed unused stampVisible
  const [comment, setComment] = useState<string>("");
  const [gifSearch, setGifSearch] = useState<string>("");
  // Gif type definition
  type Gif = {
    id: string;
    title: string;
    images: {
      original: { url: string };
      fixed_height_small: { url: string };
    };
  };
  const [gifResults, setGifResults] = useState<Gif[]>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState<boolean>(false);
  const [gifError, setGifError] = useState<string>("");
  // Simulate message thread state for chat-like preview, now supports replies
  const [messageThread, setMessageThread] = useState<any[]>([]);
  const handleGifSearch = async () => {
    if (!gifSearch.trim()) return;
    setIsLoadingGifs(true);
    setGifError("");
    try {
      const res = await axios.get("https://api.giphy.com/v1/gifs/search", {
        params: {
          api_key: "NimviRkJMMeTN367yH1VvFULO1SVGUw5", // Statly GIPHY key
          q: gifSearch,
          limit: 6
        },
      });
      if (res.data.data.length === 0) {
        setGifError("No results found.");
      }
      setGifResults(res.data.data);
    } catch (error) {
      console.error("GIF search failed", error);
      setGifError("Failed to load GIFs. Please try again.");
    } finally {
      setIsLoadingGifs(false);
    }
  };

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      body.trade-confirmed::after {
        content: "TRADE CONFIRMED";
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translateX(-50%);
        font-size: 3rem;
        color: white;
        background-color: rgba(0,0,0,0.8);
        padding: 1rem 2rem;
        border-radius: 0.5rem;
        z-index: 50;
        animation: flash 2s ease-in-out;
      }
      @keyframes flash {
        0%, 100% { opacity: 0; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);


  // Removed unused resetTeams function

  // New trade summary function for three teams
  const getTradeSummary = () => {
    return {
      fromA: selectedTeamAPlayers.map(id => aflPlayers.find(p => p.id === id)),
      fromB: selectedTeamBPlayers.map(id => aflPlayers.find(p => p.id === id)),
      fromC: selectedTeamCPlayers.map(id => aflPlayers.find(p => p.id === id)),
    };
  };

  // Simulate message thread state for chat-like preview

  const handleConfirmTrade = () => {
    const confirmTrade = confirm("Are you sure you want to propose this trade?");
    if (confirmTrade) {
      // Simulate sending trade proposal and comment (with rendered GIFs) to message thread
      const newMessage = {
        id: Date.now(),
        type: "TRADE_PROPOSAL",
        timestamp: new Date().toISOString(),
        from: "Multi-Team Trade",
        to: "Involved Teams",
        avatar: "/avatars/your-team.png",
        content: comment,
        trades: getTradeSummary(),
        replies: [],
      };
      setMessageThread([...messageThread, newMessage]);
      // Scroll the comment box into view for feedback
      const commentBox = document.getElementById("tradeComment");
      if (commentBox) {
        commentBox.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setStampVisible(true);
      document.body.classList.add("trade-confirmed");
      setTimeout(() => {
        alert("Trade proposed!");
        setStampVisible(false);
        document.body.classList.remove("trade-confirmed");
      }, 2000);
    }
  };

  // Trade is ready if at least one player selected from each team
  const tradeReady =
    selectedTeamAPlayers.length > 0 &&
    selectedTeamBPlayers.length > 0 &&
    selectedTeamCPlayers.length > 0;

  return (
    <>
      <nav className="flex justify-start gap-6 items-center px-6 py-4 bg-white border-b shadow-sm sticky top-0 z-10">
        <Link to="/" className="text-blue-600 font-medium hover:underline">🏠 Home</Link>
        <Link to="/my-team" className="text-blue-600 font-medium hover:underline">👥 My Team</Link>
        <Link to="/player-stats" className="text-blue-600 font-medium hover:underline">📊 Player Stats</Link>
        <Link to="/rosters" className="text-blue-600 font-medium hover:underline">📋 Rosters</Link>
      </nav>
      <div className="p-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium text-lg transition-colors"
        >
          ← Back to Home
        </Link>
        <hr className="my-4 border-gray-200" />
      </div>
      <div
        className="min-h-screen px-4 py-6 bg-cover bg-center"
        style={{
          backgroundImage: `url('/backgrounds/nyc-skyline.jpg')`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
        }}
      >
        {/* Banner Section */}
        <div style={{
          width: '100%',
          height: '180px',
          backgroundImage: 'url("/assets/banner.png")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          color: 'white',
          fontSize: '2.5rem',
          fontWeight: 'bold',
          textShadow: '2px 2px 5px #000',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          TRADE CENTRE
        </div>
        {/* Sticky filter bar below banner */}
        <div className="sticky top-[80px] z-30 bg-white shadow-md p-4 flex flex-wrap gap-4 items-center justify-between mb-4">
          <select className="border px-3 py-1 rounded-md">
            <option value="">All Positions</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
            <option value="RUC">RUC</option>
          </select>
          <select className="border px-3 py-1 rounded-md">
            <option value="">All Teams</option>
            {/* Dynamically render teams if available */}
            {[...new Set(aflPlayers.map((p) => p.team))].map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search players..."
            className="border px-3 py-1 rounded-md flex-1 min-w-[200px]"
          />
        </div>
        {/* Trade Summary below banner - responsive grid layout */}
        <motion.div
          layout
          animate={{ scale: 1, transition: { duration: 0.2 } }}
          className="bg-white rounded-lg shadow p-4 mb-8"
        >
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Trade Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">
            {/* Team A Summary */}
            <div>
              <div className="bg-green-50 border border-green-200 rounded p-2 mb-2">
                <h3 className="font-bold mb-1">Team A (You) - Players Involved</h3>
                {getTradeSummary().fromA.length === 0
                  ? <p className="text-gray-400 italic">None</p>
                  : getTradeSummary().fromA.map((p) => p && (
                    <div key={p.id} className="border-b border-gray-200 pb-2 mb-2">
                      <p className="font-semibold">{p.name} ({p.team} – {p.position})</p>
                    </div>
                  ))}
              </div>
              <CategorySummary players={getTradeSummary().fromA.filter((p): p is Player => p !== undefined)} teamColor="green" />
            </div>
            {/* Team B Summary */}
            <div>
              <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
                <h3 className="font-bold mb-1">Team B - Players Involved</h3>
                {getTradeSummary().fromB.length === 0
                  ? <p className="text-gray-400 italic">None</p>
                  : getTradeSummary().fromB.map((p) => p && (
                    <div key={p.id} className="border-b border-gray-200 pb-2 mb-2">
                      <p className="font-semibold">{p.name} ({p.team} – {p.position})</p>
                    </div>
                  ))}
              </div>
              <CategorySummary players={getTradeSummary().fromB.filter((p): p is Player => p !== undefined)} teamColor="blue" />
            </div>
            {/* Team C Summary */}
            <div>
              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-2">
                <h3 className="font-bold mb-1">Team C - Players Involved</h3>
                {getTradeSummary().fromC.length === 0
                  ? <p className="text-gray-400 italic">None</p>
                  : getTradeSummary().fromC.map((p) => p && (
                    <div key={p.id} className="border-b border-gray-200 pb-2 mb-2">
                      <p className="font-semibold">{p.name} ({p.team} – {p.position})</p>
                    </div>
                  ))}
              </div>
              <CategorySummary players={getTradeSummary().fromC.filter((p): p is Player => p !== undefined)} teamColor="yellow" />
            </div>
          </div>
          <button
            onClick={handleConfirmTrade}
            className={`mt-4 w-full py-3 text-white font-semibold rounded-md transition ${
              tradeReady
                ? 'bg-green-500 hover:bg-green-600'
                : 'bg-red-500 hover:bg-red-600 border-2 border-red-600'
            }`}
            disabled={!tradeReady}
          >
            Confirm Trade
          </button>
        </motion.div>

        {/* Teams grid below Trade Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Team A Section */}
          <div className="team-section">
            <motion.h2
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="text-xl font-bold mb-2 border-b pb-1"
            >
              Team A – Robert's Rovers
            </motion.h2>
            <div className="filters mb-3 flex gap-3 items-center">
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Position:
                </label>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  <option value="DEF">DEF</option>
                  <option value="MID">MID</option>
                  <option value="FWD">FWD</option>
                  <option value="RUC">RUC</option>
                </select>
              </div>
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Team:
                </label>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  {[...new Set(aflPlayers.map((p) => p.team))].map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Player list for Team A */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delayChildren: 0.1, staggerChildren: 0.05 }}
              className="bg-white border border-gray-200 p-2 min-h-[500px] overflow-y-auto"
            >
              <AnimatePresence>
                {myTeam
                  .filter((p) => (positionFilter ? p.position === positionFilter : true))
                  .filter((p) => (teamFilter ? p.team === teamFilter : true))
                  .sort((a, b) => a.position.localeCompare(b.position))
                  .map((player) => {
                    const isSelected = selectedTeamAPlayers.includes(player.id);
                    // Compose stats object for PlayerStatsSummary
                    const stats = {
                      kicks: { avg: player.kicks ?? "—", rank: player.kicks_rank ?? "—" },
                      handballs: { avg: player.handballs ?? "—", rank: player.handballs_rank ?? "—" },
                      marks: { avg: player.marks ?? "—", rank: player.marks_rank ?? "—" },
                      tackles: { avg: player.tackles ?? "—", rank: player.tackles_rank ?? "—" },
                      goals: { avg: player.goals ?? "—", rank: player.goals_rank ?? "—" },
                      hitouts: { avg: player.hitouts ?? "—", rank: player.hitouts_rank ?? "—" },
                      clearances: { avg: player.clearances ?? "—", rank: player.clearances_rank ?? "—" },
                      inside50s: { avg: player.inside50s ?? "—", rank: player.inside50s_rank ?? "—" },
                      rebound50s: { avg: player.rebound50s ?? "—", rank: player.rebound50s_rank ?? "—" },
                      contestedPossessions: { avg: player.contestedPossessions ?? "—", rank: player.contestedPossessions_rank ?? "—" },
                    };
                    return (
                      <motion.div
                        key={player.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div
                          className="rounded-md border-2 border-neutral-300 hover:border-blue-500 hover:shadow-md p-4 transition-all bg-white relative"
                          aria-label={`Player card for ${player.name}`}
                          title={`${player.name} | ${player.team} | ${player.position}`}
                        >
                          <h2 className="text-lg font-semibold mb-1">{player.name}</h2>
                          <div className="text-[11px] text-gray-700 mb-2">
                            {player.team} — {player.position}
                          </div>
                          {/* Enhanced stat category layout */}
                          <div className="mt-3 text-sm text-gray-700">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div><strong>Kicks:</strong> {player.kicks ?? "—"} <span className="text-green-600">#{player.kicks_rank ?? "—"}</span></div>
                              <div><strong>Handballs:</strong> {player.handballs ?? "—"} <span className="text-green-600">#{player.handballs_rank ?? "—"}</span></div>
                              <div><strong>Marks:</strong> {player.marks ?? "—"} <span className="text-green-600">#{player.marks_rank ?? "—"}</span></div>
                              <div><strong>Tackles:</strong> {player.tackles ?? "—"} <span className="text-green-600">#{player.tackles_rank ?? "—"}</span></div>
                              <div><strong>Goals:</strong> {player.goals ?? "—"} <span className="text-green-600">#{player.goals_rank ?? "—"}</span></div>
                              <div><strong>CP:</strong> {player.contestedPossessions ?? "—"} <span className="text-green-600">#{player.contestedPossessions_rank ?? "—"}</span></div>
                            </div>
                          </div>
                          {/* Player status badges */}
                          <div className="flex flex-row flex-wrap gap-1 mt-2">
                            <span className="bg-gray-200 text-gray-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              {player.status}
                            </span>
                            <span className="bg-lime-100 text-lime-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Bye: {player.byeRound ?? "N/A"}
                            </span>
                            <span className="bg-red-100 text-red-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Inj: {player.gamesMissedInjury}
                            </span>
                            <span className="bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Omit: {player.gamesMissedOmitted}
                            </span>
                          </div>
                          {isSelected ? (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-red-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamAPlayers(selectedTeamAPlayers.filter(id => id !== player.id))}
                            >
                              Remove from Trade
                            </motion.button>
                          ) : (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-blue-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamAPlayers([...selectedTeamAPlayers, player.id])}
                            >
                              Add to Trade
                            </motion.button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
            </motion.div>
          </div>
          {/* Team B Section */}
          <div className="team-section">
            <div className="text-xl font-bold mb-2 border-b pb-1">
              Team B
            </div>
            <div className="filters mb-3 flex gap-3 items-center">
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Position:
                </label>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  <option value="DEF">DEF</option>
                  <option value="MID">MID</option>
                  <option value="FWD">FWD</option>
                  <option value="RUC">RUC</option>
                </select>
              </div>
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Team:
                </label>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  {[...new Set(aflPlayers.map((p) => p.team))].map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Player list for Team B */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delayChildren: 0.1, staggerChildren: 0.05 }}
              className="bg-white border border-gray-200 p-2 min-h-[500px] overflow-y-auto"
            >
              <AnimatePresence>
                {opponentTeam
                  .filter((p) => (positionFilter ? p.position === positionFilter : true))
                  .filter((p) => (teamFilter ? p.team === teamFilter : true))
                  .sort((a, b) => a.position.localeCompare(b.position))
                  .map((player) => {
                    const isSelected = selectedTeamBPlayers.includes(player.id);
                    const stats = {
                      kicks: { avg: player.kicks ?? "—", rank: player.kicks_rank ?? "—" },
                      handballs: { avg: player.handballs ?? "—", rank: player.handballs_rank ?? "—" },
                      marks: { avg: player.marks ?? "—", rank: player.marks_rank ?? "—" },
                      tackles: { avg: player.tackles ?? "—", rank: player.tackles_rank ?? "—" },
                      goals: { avg: player.goals ?? "—", rank: player.goals_rank ?? "—" },
                      hitouts: { avg: player.hitouts ?? "—", rank: player.hitouts_rank ?? "—" },
                      clearances: { avg: player.clearances ?? "—", rank: player.clearances_rank ?? "—" },
                      inside50s: { avg: player.inside50s ?? "—", rank: player.inside50s_rank ?? "—" },
                      rebound50s: { avg: player.rebound50s ?? "—", rank: player.rebound50s_rank ?? "—" },
                      contestedPossessions: { avg: player.contestedPossessions ?? "—", rank: player.contestedPossessions_rank ?? "—" },
                    };
                    return (
                      <motion.div
                        key={player.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div
                          className="rounded-md border-2 border-neutral-300 hover:border-blue-500 hover:shadow-md p-4 transition-all bg-white relative"
                          aria-label={`Player card for ${player.name}`}
                          title={`${player.name} | ${player.team} | ${player.position}`}
                        >
                          <h2 className="text-lg font-semibold mb-1">{player.name}</h2>
                          <div className="text-[11px] text-gray-700 mb-2">
                            {player.team} — {player.position}
                          </div>
                          {/* Enhanced stat category layout */}
                          <div className="mt-3 text-sm text-gray-700">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div><strong>Kicks:</strong> {player.kicks ?? "—"} <span className="text-green-600">#{player.kicks_rank ?? "—"}</span></div>
                              <div><strong>Handballs:</strong> {player.handballs ?? "—"} <span className="text-green-600">#{player.handballs_rank ?? "—"}</span></div>
                              <div><strong>Marks:</strong> {player.marks ?? "—"} <span className="text-green-600">#{player.marks_rank ?? "—"}</span></div>
                              <div><strong>Tackles:</strong> {player.tackles ?? "—"} <span className="text-green-600">#{player.tackles_rank ?? "—"}</span></div>
                              <div><strong>Goals:</strong> {player.goals ?? "—"} <span className="text-green-600">#{player.goals_rank ?? "—"}</span></div>
                              <div><strong>CP:</strong> {player.contestedPossessions ?? "—"} <span className="text-green-600">#{player.contestedPossessions_rank ?? "—"}</span></div>
                            </div>
                          </div>
                          {/* Player status badges */}
                          <div className="flex flex-row flex-wrap gap-1 mt-2">
                            <span className="bg-gray-200 text-gray-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              {player.status}
                            </span>
                            <span className="bg-lime-100 text-lime-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Bye: {player.byeRound ?? "N/A"}
                            </span>
                            <span className="bg-red-100 text-red-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Inj: {player.gamesMissedInjury}
                            </span>
                            <span className="bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Omit: {player.gamesMissedOmitted}
                            </span>
                          </div>
                          {isSelected ? (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-red-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamBPlayers(selectedTeamBPlayers.filter((id) => id !== player.id))}
                            >
                              Remove from Trade
                            </motion.button>
                          ) : (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-blue-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamBPlayers([...selectedTeamBPlayers, player.id])}
                            >
                              Add to Trade
                            </motion.button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
            </motion.div>
          </div>
          {/* Team C Section */}
          <div className="team-section">
            <div className="text-xl font-bold mb-2 border-b pb-1">
              Team C
            </div>
            <div className="filters mb-3 flex gap-3 items-center">
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Position:
                </label>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  <option value="DEF">DEF</option>
                  <option value="MID">MID</option>
                  <option value="FWD">FWD</option>
                  <option value="RUC">RUC</option>
                </select>
              </div>
              <div className="flex gap-3 items-center">
                <label className="text-gray-800 font-semibold text-sm">
                  Filter by Team:
                </label>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="px-2 py-1 text-sm border bg-white border-gray-300 focus:outline-none"
                >
                  <option value="">All</option>
                  {[...new Set(aflPlayers.map((p) => p.team))].map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Player list for Team C */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delayChildren: 0.1, staggerChildren: 0.05 }}
              className="bg-white border border-gray-200 p-2 min-h-[500px] overflow-y-auto"
            >
              <AnimatePresence>
                {thirdTeam
                  .filter((p) => (positionFilter ? p.position === positionFilter : true))
                  .filter((p) => (teamFilter ? p.team === teamFilter : true))
                  .sort((a, b) => a.position.localeCompare(b.position))
                  .map((player) => {
                    const isSelected = selectedTeamCPlayers.includes(player.id);
                    const stats = {
                      kicks: { avg: player.kicks ?? "—", rank: player.kicks_rank ?? "—" },
                      handballs: { avg: player.handballs ?? "—", rank: player.handballs_rank ?? "—" },
                      marks: { avg: player.marks ?? "—", rank: player.marks_rank ?? "—" },
                      tackles: { avg: player.tackles ?? "—", rank: player.tackles_rank ?? "—" },
                      goals: { avg: player.goals ?? "—", rank: player.goals_rank ?? "—" },
                      hitouts: { avg: player.hitouts ?? "—", rank: player.hitouts_rank ?? "—" },
                      clearances: { avg: player.clearances ?? "—", rank: player.clearances_rank ?? "—" },
                      inside50s: { avg: player.inside50s ?? "—", rank: player.inside50s_rank ?? "—" },
                      rebound50s: { avg: player.rebound50s ?? "—", rank: player.rebound50s_rank ?? "—" },
                      contestedPossessions: { avg: player.contestedPossessions ?? "—", rank: player.contestedPossessions_rank ?? "—" },
                    };
                    return (
                      <motion.div
                        key={player.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div
                          className="rounded-md border-2 border-neutral-300 hover:border-blue-500 hover:shadow-md p-4 transition-all bg-white relative"
                          aria-label={`Player card for ${player.name}`}
                          title={`${player.name} | ${player.team} | ${player.position}`}
                        >
                          <h2 className="text-lg font-semibold mb-1">{player.name}</h2>
                          <div className="text-[11px] text-gray-700 mb-2">
                            {player.team} — {player.position}
                          </div>
                          {/* Enhanced stat category layout */}
                          <div className="mt-3 text-sm text-gray-700">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <div><strong>Kicks:</strong> {player.kicks ?? "—"} <span className="text-green-600">#{player.kicks_rank ?? "—"}</span></div>
                              <div><strong>Handballs:</strong> {player.handballs ?? "—"} <span className="text-green-600">#{player.handballs_rank ?? "—"}</span></div>
                              <div><strong>Marks:</strong> {player.marks ?? "—"} <span className="text-green-600">#{player.marks_rank ?? "—"}</span></div>
                              <div><strong>Tackles:</strong> {player.tackles ?? "—"} <span className="text-green-600">#{player.tackles_rank ?? "—"}</span></div>
                              <div><strong>Goals:</strong> {player.goals ?? "—"} <span className="text-green-600">#{player.goals_rank ?? "—"}</span></div>
                              <div><strong>CP:</strong> {player.contestedPossessions ?? "—"} <span className="text-green-600">#{player.contestedPossessions_rank ?? "—"}</span></div>
                            </div>
                          </div>
                          {/* Player status badges */}
                          <div className="flex flex-row flex-wrap gap-1 mt-2">
                            <span className="bg-gray-200 text-gray-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              {player.status}
                            </span>
                            <span className="bg-lime-100 text-lime-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Bye: {player.byeRound ?? "N/A"}
                            </span>
                            <span className="bg-red-100 text-red-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Inj: {player.gamesMissedInjury}
                            </span>
                            <span className="bg-yellow-100 text-yellow-700 rounded px-1 py-0.5 text-[10px] font-semibold">
                              Omit: {player.gamesMissedOmitted}
                            </span>
                          </div>
                          {isSelected ? (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-red-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamCPlayers(selectedTeamCPlayers.filter((id) => id !== player.id))}
                            >
                              Remove from Trade
                            </motion.button>
                          ) : (
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              whileHover={{ scale: 1.05 }}
                              animate={{ opacity: 1 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="px-4 py-2 bg-blue-600 text-white rounded transition mt-3"
                              onClick={() => setSelectedTeamCPlayers([...selectedTeamCPlayers, player.id])}
                            >
                              Add to Trade
                            </motion.button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
      {/* Fragment for comment and GIF section */}
        <div className="mt-8">
          {/* Comment & GIF section moved below teams grid */}
          <label htmlFor="tradeComment" className="block text-sm font-medium text-gray-700 mb-1">
            Add Comment:
          </label>
          <textarea
            id="tradeComment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-gray-900"
            rows={3}
            placeholder="Enter a message to send with your trade offer..."
          />
          <div className="flex gap-2 mt-2">
            {["🔥", "✅", "💼", "🧠", "📉", "📈", "🛑", "💰"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setComment(comment + emoji)}
                className="text-xl hover:scale-110 transform transition"
                title={`Add ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <input
              type="text"
              value={gifSearch}
              onChange={(e) => setGifSearch(e.target.value)}
              placeholder="Search GIFs..."
              className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGifSearch}
              className="mt-1 text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Search GIFs
            </button>
            <div className="mt-2">
              {isLoadingGifs && (
                <p className="text-sm text-gray-500 italic">Searching...</p>
              )}
              {gifError && (
                <p className="text-sm text-red-600">{gifError}</p>
              )}
              <div className="grid grid-cols-3 gap-2 mt-2">
                {gifResults.map((gif: Gif) => (
                  <img
                    key={gif.id}
                    src={gif.images.fixed_height_small.url}
                    alt={gif.title}
                    className="cursor-pointer rounded hover:ring-2 hover:ring-emerald-500"
                    onClick={() =>
                      setComment(comment + ` [GIF:${gif.images.original.url}]`)
                    }
                  />
                ))}
              </div>
            </div>
            {/* Inbox Preview Bubble */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Inbox Preview</h3>
              <div className="bg-white border rounded p-2 max-h-36 overflow-y-auto space-y-2 text-sm">
                {messageThread.map((msg, idx) => (
                  <div key={msg.id ?? idx}>
                    <div className="flex items-start gap-2">
                      <img src={msg.avatar} alt={msg.from} className="w-8 h-8 rounded-full" />
                      <div className="bg-emerald-100 text-gray-800 rounded-lg px-3 py-2 max-w-[80%]">
                        <div className="font-medium text-sm mb-1">{msg.from}</div>
                        {renderCommentWithGIFs(msg.content)}
                        <div className="text-xs text-gray-500 mt-1">{new Date(msg.timestamp).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <input
                        type="text"
                        placeholder="Write a reply..."
                        className="text-sm border rounded px-2 py-1 w-full mb-1"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                            const updated = [...messageThread];
                            updated[idx] = {
                              ...updated[idx],
                              replies: [
                                ...(updated[idx].replies || []),
                                {
                                  from: "You",
                                  content: e.currentTarget.value,
                                  timestamp: new Date().toISOString(),
                                },
                              ],
                            };
                            setMessageThread(updated);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <div className="space-y-1">
                        {(msg.replies || []).map((reply: any, rIdx: number) => (
                          <div key={rIdx} className="ml-4 p-2 bg-gray-200 text-gray-700 text-sm rounded">
                            <strong>{reply.from}:</strong> {reply.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
    </>
  );
};

export default TradeCentre;

// Add team-section and team-heading CSS for styled team panels
const style = document.createElement('style');
style.innerHTML = `
.team-section {
  margin-bottom: 2rem;
  padding: 1rem;
  border-top: 3px solid #ccc;
}
`;
if (typeof document !== "undefined" && !document.getElementById("team-section-style")) {
  style.id = "team-section-style";
  document.head.appendChild(style);
}

// Removed unused getTeamColor function

// Emoji badge for stat rank
const getRankBadge = (rank: number) => {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  if (rank <= 10) return "🏅";
  if (rank <= 25) return "🎖️";
  if (rank <= 50) return "🔰";
  return "";
};

// CategorySummary component for team stat summaries
const CategorySummary = ({ players, teamColor }: { players: Player[]; teamColor: string }) => {
  // Define stat categories and background color mapping
  const categories = [
    { key: "kicks", label: "Kicks", showAverage: true },
    { key: "handballs", label: "Handballs", showAverage: true },
    { key: "marks", label: "Marks", showAverage: true },
    { key: "tackles", label: "Tackles", showAverage: true },
    { key: "goals", label: "Goals", showAverage: true },
  ];
  // Tailwind background color mapping
  const bgMap: { [key: string]: string } = {
    green: "bg-green-50 border-green-200",
    blue: "bg-blue-50 border-blue-200",
    yellow: "bg-yellow-50 border-yellow-200",
  };
  // Compute total for each category
  const totals: { [key: string]: number } = {};
  for (const cat of categories) {
    totals[cat.key] = (players || []).reduce((sum, p) => sum + (p && typeof (p as any)[cat.key] === "number" ? (p as any)[cat.key] : 0), 0);
  }
  // Compute best (lowest) rank for each category
  const bestRanks: { [key: string]: number | null } = {};
  for (const cat of categories) {
    const ranks = (players || [])
      .map((p) => p && typeof (p as any)[cat.key + "_rank"] === "number" ? (p as any)[cat.key + "_rank"] : null)
      .filter((r) => r !== null);
    bestRanks[cat.key] = ranks.length ? Math.min(...(ranks as number[])) : null;
  }
  return (
    <div className={`border rounded px-3 py-2 ${bgMap[teamColor] || "bg-gray-50 border-gray-200"}`}>
      <div className="font-semibold mb-1">Category Summary</div>
      {categories.map((cat) => {
        const avg =
          players && players.length
            ? (totals[cat.key] / players.length).toFixed(1)
            : "0.0";
        return (
          <div key={cat.key} className="flex items-center gap-2 text-sm mb-1">
            <span className="w-20">{cat.label}:</span>
            <span className="font-bold">{totals[cat.key]}</span>
            <span className="text-gray-500 text-xs">(Avg: {avg})</span>
            {bestRanks[cat.key] !== null && (
              <span className="ml-2">
                {getRankBadge(bestRanks[cat.key] as number)}
                <sup className="text-[10px] text-gray-500 ml-1 align-top">
                  #{bestRanks[cat.key]}
                </sup>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// (PlayerStatsSummary is now unused)