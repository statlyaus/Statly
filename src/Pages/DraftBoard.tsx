// src/Pages/DraftBoard.tsx

import React, { useEffect, useState } from 'react';
import WatchList from '../components/WatchList';
import AvailablePlayersTable from '../components/AvailablePlayersTable';
import DraftOrderBar from '../components/DraftOrderBar';
import MyTeamPanel from '../components/MyTeamPanel';
import DraftBanner from '../components/DraftBanner';
import { useDraft } from '../Hooks/useDraft';
import { fetchFromAPI } from '../lib/api';
import type { Player, Team } from '../types';
import { useAuth } from '../AuthContext';
import { saveUserWatchlist, loadUserWatchlist } from '../firebaseHelpers';
import StatFilters from '../components/StatFilters';

export default function DraftBoardPage() {
  const initialTeams: Team[] = [
    { id: '1', name: 'Team 1', players: [] },
    { id: '2', name: 'Team 2', players: [] },
    { id: '3', name: 'Team 3', players: [] },
  ];
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [timer, setTimer] = useState(30);
  const [statQualifier, setStatQualifier] = useState('kicks');
  const [statThreshold, setStatThreshold] = useState(0);
  const [timeframe, setTimeframe] = useState('season');

  useEffect(() => {
    fetchFromAPI<Player[]>('/api/players')
      .then((json) => {
        console.log('Fetched players from API:', json); // Debug log
        setPlayers(json);
      })
      .finally(() => setLoading(false));
  }, []);

  const draft = useDraft(players, initialTeams, 10); // 10 rounds

  // Load watchlist from Firestore on login
  useEffect(() => {
    if (!user?.uid) return;
    loadUserWatchlist(user.uid).then((watchlist) => {
      if (Array.isArray(watchlist)) {
        draft.setPlayers((prev) =>
          prev.map((p) => ({
            ...p,
            isWatched: watchlist.includes(p.id),
          }))
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Save watchlist to Firestore when watchedIds change
  useEffect(() => {
    if (!user?.uid) return;
    saveUserWatchlist(user.uid, draft.watchedIds);
  }, [user?.uid, draft.watchedIds]);

  // Debug: log undraftedPlayers and draftedIds
  useEffect(() => {
    console.log('Draft undraftedPlayers:', draft.undraftedPlayers);
    console.log('Draft draftedIds:', draft.draftedIds);
  }, [draft.undraftedPlayers, draft.draftedIds]);

  // Reset timer on pick change
  useEffect(() => {
    setTimer(30);
  }, [draft.currentPickIndex]);

  // Countdown and auto-pick
  useEffect(() => {
    if (draft.draftComplete) return;
    if (timer <= 0) {
      draft.handleAutoDraft();
      return;
    }
    const interval = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(interval);
  }, [timer, draft.draftComplete, draft.currentPickIndex]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!players.length) return <div className="p-4">No players loaded from API.</div>;

  return (
    <div className="p-4 space-y-4">
      <DraftBanner
        title={draft.currentTeam ? `It's ${draft.currentTeam.name}'s pick!` : 'Draft is live!'}
        round={draft.round}
        pick={draft.pickInRound}
        yourPickIndex={0}
        timeLeft={timer}
      />
      <div className="flex gap-2 mb-2">
        <DraftOrderBar teams={draft.teams} currentPickIndex={draft.currentPickIndex} />
        <button onClick={draft.handleUndoDraft} disabled={draft.pickHistory.length === 0}>
          Undo
        </button>
        <button onClick={draft.handleAutoDraft} disabled={draft.draftComplete}>
          Auto Draft
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <WatchList
          initialPlayers={draft.players}
          watchedIds={draft.watchedIds}
          onWatchToggle={draft.handleWatchToggle}
        />
        <AvailablePlayersTable
          players={draft.undraftedPlayers}
          isMyPick={true}
          watchedIds={draft.watchedIds}
          draftedIds={draft.draftedIds}
          onWatchToggle={draft.handleWatchToggle}
          onConfirmDraft={draft.handleConfirmDraft}
        />
        {draft.teams.length > 0 && (
          <MyTeamPanel
            team={draft.teams[draft.currentPickIndex % draft.teams.length]}
            players={draft.players}
          />
        )}
      </div>
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
    </div>
  );
}
