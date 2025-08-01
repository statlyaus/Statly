import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Player, Team } from '../types';

export function useDraft(initialPlayers: Player[], initialTeams: Team[], totalRounds = 10) {
  const [players, setPlayers] = useState<Player[]>(initialPlayers);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [currentPickIndex, setCurrentPickIndex] = useState(0);
  const [pickHistory, setPickHistory] = useState<{ teamId: string; playerId: string }[]>([]);

  // Calculate round and pick within round
  const picksPerRound = teams.length;
  const round = teams.length === 0 ? 0 : Math.floor(currentPickIndex / picksPerRound) + 1;
  const pickInRound = picksPerRound > 0 ? (currentPickIndex % picksPerRound) + 1 : 0;

  const draftedIds = useMemo(() => teams.flatMap((t) => t.players ?? []), [teams]);
  const watchedIds = useMemo(() => players.filter((p) => p.isWatched).map((p) => p.id), [players]);
  const undraftedPlayers = useMemo(
    () => players.filter((p) => !draftedIds.includes(p.id)),
    [players, draftedIds]
  );
  const currentTeam = teams.length > 0 ? teams[currentPickIndex % teams.length] : null;

  useEffect(() => {
    setPlayers(initialPlayers);
  }, [initialPlayers]);

  const handleConfirmDraft = useCallback(
    (player: Player) => {
      if (!currentTeam || !currentTeam.id || draftedIds.includes(player.id)) return;
      const updatedTeams = teams.map((team) =>
        team.id === currentTeam.id
          ? { ...team, players: [...(team.players ?? []), player.id] }
          : team
      );
      setTeams(updatedTeams);
      setPickHistory((prev) => [...prev, { teamId: currentTeam.id, playerId: player.id }]);
      setCurrentPickIndex((prev) => prev + 1);
    },
    [currentTeam, draftedIds, teams]
  );

  const handleUndoDraft = useCallback(() => {
    if (pickHistory.length === 0) return;
    const lastPick = pickHistory[pickHistory.length - 1];
    setTeams((prevTeams) =>
      prevTeams.map((team) =>
        team.id === lastPick.teamId
          ? { ...team, players: (team.players ?? []).filter((id) => id !== lastPick.playerId) }
          : team
      )
    );
    setPickHistory((prev) => prev.slice(0, -1));
    setCurrentPickIndex((prev) => Math.max(0, prev - 1));
  }, [pickHistory]);

  const handleWatchToggle = useCallback((playerId: string) => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, isWatched: !p.isWatched } : p))
    );
  }, []);

  // Optionally: auto-draft the top available player
  const handleAutoDraft = useCallback(() => {
    // Find the first watched player who is still undrafted
    const watchedUndrafted = players.filter((p) => p.isWatched && !draftedIds.includes(p.id));
    if (watchedUndrafted.length > 0) {
      handleConfirmDraft(watchedUndrafted[0]);
      return;
    }
    // Otherwise, draft the top available player
    if (undraftedPlayers.length > 0) {
      handleConfirmDraft(undraftedPlayers[0]);
    }
  }, [players, draftedIds, undraftedPlayers, handleConfirmDraft]);

  const draftComplete = teams.length > 0 && currentPickIndex >= picksPerRound * totalRounds;

  return {
    players,
    teams,
    setPlayers,
    setTeams,
    currentPickIndex,
    currentTeam,
    draftedIds,
    watchedIds,
    undraftedPlayers,
    handleConfirmDraft,
    handleUndoDraft,
    handleWatchToggle,
    handleAutoDraft,
    pickHistory,
    round,
    pickInRound,
    draftComplete,
    totalRounds,
  };
}
