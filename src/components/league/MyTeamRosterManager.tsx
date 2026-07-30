'use client';

import { useEffect, useMemo, useState } from 'react';
import MyTeamPanel from '@/components/MyTeamPanel';
import type { League, LeagueMember } from '@/types/leagues';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import type { Player, Team } from '@/types/players';
import {
  isRecord,
  LEAGUE_CATEGORY_PRESET,
  normalizeFantasyCategoryList,
} from './leagueTabPanelUtils';

interface MyTeamRosterManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}
type LeagueRosterRecord = Record<string, unknown> & {
  players?: Player[];
  playerIds?: Array<string | number>;
};

interface NormalizedLeagueRosterResponse {
  roster: LeagueRosterRecord | null;
  players: Player[];
  selectedCategories: FantasyCategoryKey[];
}

function normalizeLeagueRosterResponse(
  payload: unknown,
  fallbackCategories: readonly FantasyCategoryKey[] = LEAGUE_CATEGORY_PRESET
): NormalizedLeagueRosterResponse {
  const responseBody =
    isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : null;
  const roster =
    responseBody && isRecord(responseBody.roster)
      ? (responseBody.roster as LeagueRosterRecord)
      : null;
  const leagueSettings =
    responseBody && isRecord(responseBody.leagueSettings) ? responseBody.leagueSettings : null;
  const rosterPlayers = roster && Array.isArray(roster.players) ? roster.players : [];
  const responsePlayers =
    responseBody && Array.isArray(responseBody.players) ? (responseBody.players as Player[]) : [];

  return {
    roster,
    players: rosterPlayers.length > 0 ? rosterPlayers : responsePlayers,
    selectedCategories: normalizeFantasyCategoryList(
      leagueSettings?.selectedCategories,
      fallbackCategories
    ),
  };
}

function getRosterPlayerIds(roster: LeagueRosterRecord | null, players: Player[]): string[] {
  if (roster && Array.isArray(roster.playerIds) && roster.playerIds.length > 0) {
    return roster.playerIds.map((playerId) => String(playerId));
  }

  return players.map((player) => String(player.id));
}

export function MyTeamRosterManager({ league, members, currentUserId }: MyTeamRosterManagerProps) {
  const [_selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<LeagueRosterRecord | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const rosterCategoryFallback = useMemo(
    () => normalizeFantasyCategoryList(league.categories, LEAGUE_CATEGORY_PRESET),
    [league.categories]
  );
  const [selectedCategories, setSelectedCategories] = useState<FantasyCategoryKey[]>(() => [
    ...rosterCategoryFallback,
  ]);

  useEffect(() => {
    setSelectedCategories([...rosterCategoryFallback]);
  }, [rosterCategoryFallback]);

  // Get current user's team from league members
  const currentUserTeam = members.find((member) => member.userId === currentUserId);

  // Fetch roster data from real API
  useEffect(() => {
    if (!league?.id || !currentUserId) return;

    const fetchRosterData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`);
        if (response.ok) {
          const rosterData = await response.json();
          const nextRoster = normalizeLeagueRosterResponse(rosterData, rosterCategoryFallback);
          setRoster(nextRoster.roster);
          setPlayers(nextRoster.players);
          setSelectedCategories(nextRoster.selectedCategories);
        } else {
          console.error('Failed to fetch roster data');
        }
      } catch (error) {
        console.error('Error fetching roster:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchRosterData();
  }, [league?.id, currentUserId, rosterCategoryFallback]);

  // Convert roster data to Team format for MyTeamPanel
  const teamPlayerIds = getRosterPlayerIds(roster, players);
  const team: Team | undefined = roster
    ? {
        id: String(roster.id ?? currentUserTeam?.id),
        name: currentUserTeam?.teamName || 'My Team',
        players: teamPlayerIds,
      }
    : undefined;

  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    setLastAction(`Selected player: ${player.name}`);
  };

  const handleTeamAction = async (action: string, player?: Player) => {
    if (!league?.id || !currentUserId) return;

    setLoading(true);
    try {
      let actionData: Record<string, unknown> = {};

      switch (action) {
        case 'captain':
          if (player) {
            actionData = {
              actionType: 'SET_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as captain...`);
          }
          break;
        case 'viceCaptain':
          if (player) {
            actionData = {
              actionType: 'SET_VICE_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as vice-captain...`);
          }
          break;
        case 'optimize':
          actionData = {
            actionType: 'OPTIMIZE_LINEUP',
            details: {},
          };
          setLastAction('Optimizing lineup...');
          break;
        case 'drop':
          if (player) {
            actionData = {
              actionType: 'DROP_PLAYER',
              details: { playerId: player.id },
            };
            setLastAction(`Dropping ${player.name}...`);
          }
          break;
        case 'trade':
          setLastAction('Opening trade interface...');
          return; // Handle trade UI separately
        case 'waivers':
          setLastAction('Opening waiver claims...');
          return; // Handle waiver UI separately
        default: {
          const playerName = player ? player.name : '';
          setLastAction(`${action} action ${playerName ? `for ${playerName}` : ''}`);
          return;
        }
      }

      // Submit team action to API
      const response = await fetch(`/api/leagues/${league.id}/actions/${currentUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(actionData),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Team action submitted:', result);

        // Refresh roster data after successful action
        setTimeout(() => {
          const refreshRoster = async () => {
            try {
              const rosterResponse = await fetch(
                `/api/leagues/${league.id}/roster/${currentUserId}`
              );
              if (rosterResponse.ok) {
                const rosterData = await rosterResponse.json();
                const nextRoster = normalizeLeagueRosterResponse(
                  rosterData,
                  rosterCategoryFallback
                );
                setRoster(nextRoster.roster);
                setPlayers(nextRoster.players);
                setSelectedCategories(nextRoster.selectedCategories);
                setLastAction(`${action} completed successfully`);
              }
            } catch (error) {
              console.error('Failed to refresh roster:', error);
            }
          };
          void refreshRoster();
        }, 1000);
      } else {
        const error = await response.json();
        setLastAction(`Error: ${error.message || 'Action failed'}`);
      }
    } catch (error) {
      console.error('Team action failed:', error);
      setLastAction('Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!league?.id || !currentUserId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`);
      if (response.ok) {
        const rosterData = await response.json();
        const nextRoster = normalizeLeagueRosterResponse(rosterData, rosterCategoryFallback);
        setRoster(nextRoster.roster);
        setPlayers(nextRoster.players);
        setSelectedCategories(nextRoster.selectedCategories);
        setLastAction('Team data refreshed');
      } else {
        setLastAction('Refresh failed');
      }
    } catch (error) {
      console.error('Failed to refresh roster:', error);
      setLastAction('Refresh failed');
    } finally {
      setLoading(false);
    }
  };

  if (!currentUserId) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">Please sign in to manage your roster.</p>
      </div>
    );
  }

  if (!currentUserTeam) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">You are not a member of this league.</p>
      </div>
    );
  }

  if (loading && !roster) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-blue-600">Loading roster...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* League Context Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-blue-900">{league.name}</h3>
            <p className="text-sm text-blue-700">
              Team: {currentUserTeam.teamName} • Members: {members.length}/{league.maxTeams}
            </p>
          </div>
          {lastAction && (
            <div className="text-sm text-blue-600 bg-blue-100 px-3 py-1 rounded">{lastAction}</div>
          )}
        </div>
      </div>

      {/* MyTeamPanel Integration */}
      <MyTeamPanel
        team={team}
        players={players}
        onPlayerSelect={handlePlayerSelect}
        onTeamAction={handleTeamAction}
        onRefresh={handleRefresh}
        showAdvancedFeatures={true}
        sortByValue={true}
        selectedCategories={selectedCategories}
        maxHeight="600px"
        isLoading={loading}
      />
    </div>
  );
}
