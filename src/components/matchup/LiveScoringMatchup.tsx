'use client';

import React, { useState, useEffect } from 'react';

import {
  Flame as FireIcon,
  Pause as PauseIcon,
  Play as PlayIcon,
  RefreshCw as ArrowPathIcon,
  Trophy as TrophyIcon,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import { cn } from '@/lib/utils';

// Types
interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  liveScore: number;
  projectedScore: number;
  gameStatus: 'not_started' | 'live' | 'finished';
  gameTime?: string;
  isPlaying: boolean;
  captain?: boolean;
  viceCaptain?: boolean;
  stats?: {
    disposals: number;
    kicks: number;
    handballs: number;
    marks: number;
    tackles: number;
    goals: number;
    behinds: number;
  };
}

interface TeamLineup {
  teamName: string;
  totalScore: number;
  projectedTotal: number;
  players: Player[];
  captainMultiplier: number;
  viceCaptainMultiplier: number;
}

interface MatchupData {
  week: number;
  status: 'upcoming' | 'live' | 'completed';
  userTeam: TeamLineup;
  opponentTeam: TeamLineup;
  gameProgress: {
    quarter: number;
    timeRemaining: string;
    gamesInProgress: number;
    gamesCompleted: number;
    totalGames: number;
  };
}

interface LiveScoringMatchupProps {
  matchupData?: MatchupData;
  onRefresh?: () => void;
  isLive?: boolean;
}

// Mock data
const mockMatchupData: MatchupData = {
  week: 12,
  status: 'live',
  userTeam: {
    teamName: 'The Bulldogs',
    totalScore: 1847,
    projectedTotal: 2156,
    captainMultiplier: 2,
    viceCaptainMultiplier: 1.5,
    players: [
      {
        id: '1',
        name: 'Marcus Bontempelli',
        position: 'MID',
        team: 'WBD',
        liveScore: 89,
        projectedScore: 115,
        gameStatus: 'live',
        gameTime: 'Q3 8:42',
        isPlaying: true,
        captain: true,
        stats: {
          disposals: 23,
          kicks: 15,
          handballs: 8,
          marks: 7,
          tackles: 4,
          goals: 1,
          behinds: 1,
        },
      },
      {
        id: '2',
        name: 'Max Gawn',
        position: 'RUC',
        team: 'MEL',
        liveScore: 65,
        projectedScore: 108,
        gameStatus: 'finished',
        isPlaying: false,
        viceCaptain: true,
        stats: {
          disposals: 18,
          kicks: 12,
          handballs: 6,
          marks: 9,
          tackles: 3,
          goals: 0,
          behinds: 1,
        },
      },
    ],
  },
  opponentTeam: {
    teamName: 'Tigers Elite',
    totalScore: 1923,
    projectedTotal: 2089,
    captainMultiplier: 2,
    viceCaptainMultiplier: 1.5,
    players: [],
  },
  gameProgress: {
    quarter: 3,
    timeRemaining: '8:42',
    gamesInProgress: 4,
    gamesCompleted: 5,
    totalGames: 9,
  },
};

export default function LiveScoringMatchup({
  matchupData = mockMatchupData,
  onRefresh,
  isLive = true,
}: LiveScoringMatchupProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Auto refresh every 30 seconds when live
  useEffect(() => {
    if (!isLive || !autoRefresh) return;

    const interval = setInterval(() => {
      onRefresh?.();
      setLastRefresh(new Date());
    }, 30000);

    return () => clearInterval(interval);
  }, [isLive, autoRefresh, onRefresh]);

  // Calculate team scores with multipliers
  const calculateTeamScore = (team: TeamLineup) => {
    let total = 0;
    team.players.forEach((player) => {
      let score = player.liveScore || 0;
      if (player.captain) score *= team.captainMultiplier;
      else if (player.viceCaptain) score *= team.viceCaptainMultiplier;
      total += score;
    });
    return total;
  };

  const userScore = calculateTeamScore(matchupData.userTeam);
  const opponentScore = calculateTeamScore(matchupData.opponentTeam);
  const scoreDifference = userScore - opponentScore;

  // Progress percentage for games
  const progressPercentage =
    (matchupData.gameProgress.gamesCompleted / matchupData.gameProgress.totalGames) * 100;

  const getGameStatusColor = (status: string) => {
    switch (status) {
      case 'live':
        return 'bg-primary/10 text-primary';
      case 'finished':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-primary/10 text-primary';
    }
  };

  const getPositionColor = (position: string) => {
    switch (position) {
      case 'FWD':
        return 'bg-destructive/10 text-destructive';
      case 'MID':
        return 'bg-primary/10 text-primary';
      case 'DEF':
        return 'bg-primary/10 text-primary';
      case 'RUC':
        return 'bg-accent text-accent-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Week {matchupData.week} Matchup</h1>
          <p className="mt-1 text-muted-foreground">Live scoring and projections</p>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              autoRefresh
                ? 'bg-primary/10 text-primary hover:bg-primary/15'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {autoRefresh ? <PlayIcon className="w-4 h-4" /> : <PauseIcon className="w-4 h-4" />}
            Auto Refresh
          </button>

          <button
            onClick={() => {
              onRefresh?.();
              setLastRefresh(new Date());
            }}
            className="flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh Now
          </button>
        </div>
      </div>

      {/* Live Status */}
      {isLive && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-primary/20 bg-primary/10 p-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 animate-pulse rounded-full bg-primary" />
                <span className="font-semibold text-primary">LIVE</span>
              </div>
              <div className="text-muted-foreground">
                Q{matchupData.gameProgress.quarter} - {matchupData.gameProgress.timeRemaining}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">
                  {matchupData.gameProgress.gamesInProgress}
                </div>
                <div className="text-sm text-muted-foreground">Games Live</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">
                  {matchupData.gameProgress.gamesCompleted}
                </div>
                <div className="text-sm text-muted-foreground">Games Complete</div>
              </div>
              <div className="w-32">
                <div className="mb-1 flex justify-between text-sm text-muted-foreground">
                  <span>Progress</span>
                  <span>{progressPercentage.toFixed(0)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Score Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-border bg-card p-6 text-center shadow-sm"
        >
          <h3 className="mb-2 text-lg font-semibold text-card-foreground">
            {matchupData.userTeam.teamName}
          </h3>
          <div className="text-4xl font-bold text-primary">{userScore}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Projected: {matchupData.userTeam.projectedTotal}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="text-center">
            <div
              className={`text-2xl font-bold mb-2 ${
                scoreDifference > 0
                  ? 'text-primary'
                  : scoreDifference < 0
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }`}
            >
              {scoreDifference > 0 ? '+' : ''}
              {scoreDifference}
            </div>
            <div className="text-sm text-muted-foreground">Point Difference</div>
            {scoreDifference > 0 && (
              <div className="mt-1 text-xs text-primary">You&apos;re ahead!</div>
            )}
            {scoreDifference < 0 && (
              <div className="mt-1 text-xs text-destructive">You&apos;re behind</div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border bg-card p-6 text-center shadow-sm"
        >
          <h3 className="mb-2 text-lg font-semibold text-card-foreground">
            {matchupData.opponentTeam.teamName}
          </h3>
          <div className="text-4xl font-bold text-destructive">{opponentScore}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Projected: {matchupData.opponentTeam.projectedTotal}
          </div>
        </motion.div>
      </div>

      {/* Player Performance */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold text-card-foreground">Your Players</h3>
          <p className="text-sm text-muted-foreground">Live scores and statistics</p>
        </div>

        <div className="divide-y divide-border">
          {matchupData.userTeam.players.map((player, index) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="cursor-pointer p-6 hover:bg-muted/60 focus-within:bg-muted/60"
              onClick={() => setSelectedPlayer(player)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPlayer(player);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`View ${player.name} live scoring details`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    {player.captain && (
                      <>
                        <TrophyIcon className="h-5 w-5 text-accent-foreground" />
                        <span className="sr-only">Captain</span>
                      </>
                    )}
                    {player.viceCaptain && (
                      <>
                        <FireIcon className="h-5 w-5 text-primary" />
                        <span className="sr-only">Vice Captain</span>
                      </>
                    )}
                    <div>
                      <div className="font-semibold text-card-foreground">{player.name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${getPositionColor(player.position)}`}
                        >
                          {player.position}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          {player.team ? (
                            <TeamLogo team={player.team} size={16} withCircle decorative />
                          ) : null}
                          <span>{player.team}</span>
                        </span>
                        {player.gameTime && (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getGameStatusColor(player.gameStatus)}`}
                          >
                            {player.gameTime}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-card-foreground">
                      {player.liveScore}
                      {player.captain && (
                        <span className="ml-1 text-sm text-accent-foreground">×2</span>
                      )}
                      {player.viceCaptain && (
                        <span className="ml-1 text-sm text-primary">×1.5</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Proj: {player.projectedScore}
                    </div>
                  </div>

                  <div className="text-center">
                    <div
                      className={cn(
                        'h-3 w-3 rounded-full',
                        player.isPlaying ? 'bg-primary' : 'bg-muted-foreground'
                      )}
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {player.isPlaying ? 'Playing' : 'Finished'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Player Stats Preview */}
              {player.stats && (
                <div className="mt-4 grid grid-cols-4 md:grid-cols-7 gap-4">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-card-foreground">
                      {player.stats.disposals}
                    </div>
                    <div className="text-xs text-muted-foreground">Disposals</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-card-foreground">
                      {player.stats.marks}
                    </div>
                    <div className="text-xs text-muted-foreground">Marks</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-card-foreground">
                      {player.stats.tackles}
                    </div>
                    <div className="text-xs text-muted-foreground">Tackles</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-card-foreground">
                      {player.stats.goals}
                    </div>
                    <div className="text-xs text-muted-foreground">Goals</div>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Player Detail Modal */}
      <AnimatePresence>
        {selectedPlayer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
            onClick={() => setSelectedPlayer(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-card-foreground">{selectedPlayer.name}</h3>
                <button
                  aria-label="Close player details"
                  onClick={() => setSelectedPlayer(null)}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {selectedPlayer.stats && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-card-foreground">
                      {selectedPlayer.stats.disposals}
                    </div>
                    <div className="text-sm text-muted-foreground">Disposals</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-card-foreground">
                      {selectedPlayer.stats.marks}
                    </div>
                    <div className="text-sm text-muted-foreground">Marks</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-card-foreground">
                      {selectedPlayer.stats.tackles}
                    </div>
                    <div className="text-sm text-muted-foreground">Tackles</div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <div className="text-2xl font-bold text-card-foreground">
                      {selectedPlayer.stats.goals}
                    </div>
                    <div className="text-sm text-muted-foreground">Goals</div>
                  </div>
                </div>
              )}

              <div className="mt-4 text-center">
                <div className="text-3xl font-bold text-primary">{selectedPlayer.liveScore}</div>
                <div className="text-sm text-muted-foreground">Live Score</div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Last Updated */}
      <div className="text-center text-sm text-muted-foreground">
        Last updated: {lastRefresh.toLocaleTimeString()}
      </div>
    </div>
  );
}
