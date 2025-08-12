"use client";

import { useState, useMemo } from 'react';
import Tabs from '@/components/Tabs';
import Table from '@/components/Table';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import LivePickHeader from '@/components/LivePickHeader';
import PickFeed from '@/components/PickFeed';
import DraftWatchlist, { useWatchlist } from '@/components/DraftWatchlist';
import { calculateTotalValue, FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import FantasyLeagueSettings from '@/components/FantasyLeagueSettings';
import type { 
  PlayerStats,
  LeagueSettings 
} from '@/types/fantasyCategories';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  stats?: PlayerStats;
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
  isAvailable?: boolean;
}

interface Pick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
  };
}

interface DraftData {
  id: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  participants: DraftParticipant[];
  picks: Pick[];
}

interface DraftRoomClientProps {
  players: DraftPlayer[];
  draftData: DraftData;
}

const POSITIONS = ['ALL', 'DEF', 'MID', 'RUC', 'FWD'];
const CLUBS = [
  'ALL', 'Adelaide', 'Brisbane', 'Carlton', 'Collingwood', 'Essendon', 
  'Fremantle', 'Geelong', 'Gold Coast', 'GWS', 'Hawthorn', 'Melbourne', 
  'North Melbourne', 'Port Adelaide', 'Richmond', 'St Kilda', 'Sydney', 
  'West Coast', 'Western Bulldogs'
];

export default function DraftRoomClient({ players, draftData }: DraftRoomClientProps) {
  const [tab, setTab] = useState('available');
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; player?: DraftPlayer }>({ open: false });
  const [fantasySettingsModal, setFantasySettingsModal] = useState(false);
  const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>({
    id: draftData.id,
    name: 'Default League',
    selectedCategories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'contestedPossessions', 'effectiveDisposals', 'inside50s', 'intercepts'],
    maxCategories: 5,
    scoringType: 'total'
  });
  
  // Use shared watchlist hook
  const {
    watchlistItems,
    isInWatchlist,
    toggleWatchlist
  } = useWatchlist();
  
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('ALL');
  const [clubFilter, setClubFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'position' | 'club'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);

  // Filter and sort players
  const filteredPlayers = useMemo(() => {
    let filtered = players.filter(player => {
      // Filter out already picked players
      const isPicked = draftData.picks.some(pick => pick.player.id === player.id);
      if (isPicked) return false;

      // Search filter
      if (search && !player.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }

      // Position filter
      if (positionFilter !== 'ALL' && player.position !== positionFilter) {
        return false;
      }

      // Club filter
      if (clubFilter !== 'ALL' && player.club !== clubFilter) {
        return false;
      }

      return true;
    });

    // Sort players
    filtered.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];
      
      if (sortOrder === 'desc') {
        [aValue, bValue] = [bValue, aValue];
      }
      
      return aValue.localeCompare(bValue);
    });

    return filtered;
  }, [players, draftData.picks, search, positionFilter, clubFilter, sortBy, sortOrder]);

  // Get watchlist players
  const watchlistPlayers = useMemo(() => {
    return watchlistItems
      .map(item => {
        const player = players.find(p => p.id === item.playerId);
        if (!player) return null;
        
        // Check if already picked
        const isPicked = draftData.picks.some(pick => pick.player.id === player.id);
        if (isPicked) return null;
        
        return { ...player, rank: item.rank };
      })
      .filter(Boolean)
      .sort((a, b) => a!.rank - b!.rank) as (DraftPlayer & { rank: number })[];
  }, [watchlistItems, players, draftData.picks]);

  // Get current picking team
  const currentPickingTeam = useMemo(() => {
    if (draftData.status === 'COMPLETED') return null;
    
    // Calculate current slot based on snake logic
    const teamCount = draftData.participants.length;
    const round = Math.ceil(draftData.currentPick / teamCount);
    const direction = (round % 2 === 1) ? 'FORWARD' : 'REVERSE';
    
    let slot: number;
    if (direction === 'FORWARD') {
      slot = ((draftData.currentPick - 1) % teamCount) + 1;
    } else {
      slot = teamCount - ((draftData.currentPick - 1) % teamCount);
    }
    
    return draftData.participants.find(p => p.slot === slot);
  }, [draftData]);

  // Check if it's your turn to pick
  const isYourTurn = useMemo(() => {
    return currentPickingTeam?.slot === 1; // You are always slot 1
  }, [currentPickingTeam]);

  const handlePlayerSelect = (player: DraftPlayer) => {
    setConfirmModal({ open: true, player });
  };

  const handleConfirmPick = async () => {
    if (!confirmModal.player) return;
    
    setIsLoading(true);
    try {
      // Use the current picking team's member ID, or override with your ID if admin
      const memberId = isYourTurn 
        ? currentPickingTeam?.member.id || draftData.participants[0].member.id
        : currentPickingTeam?.member.id || draftData.participants[0].member.id;

      const response = await fetch(`/api/drafts/${draftData.id}/pick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playerId: confirmModal.player.id,
          memberId: memberId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to make pick');
      }

      // Refresh the page to show updated data
      window.location.reload();
    } catch (error) {
      console.error('Error making pick:', error);
      alert('Failed to make pick. Please try again.');
    } finally {
      setIsLoading(false);
      setConfirmModal({ open: false });
    }
  };

  const PlayerRow = ({ player }: { player: DraftPlayer }) => {
    const playerInWatchlist = isInWatchlist(player.id);
    
    return (
      <tr key={player.id} className="border-b hover:bg-gray-50">
        <td className="sticky left-0 bg-white hover:bg-gray-50 px-4 py-3 border-r border-gray-200 z-10">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => toggleWatchlist(player.id)}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                playerInWatchlist 
                  ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' 
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
              }`}
              title={playerInWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
            </button>
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-gray-600">
                {player.name.split(' ')[0]?.[0]}{player.name.split(' ')[1]?.[0] || ''}
              </span>
            </div>
            <div>
              <div className="font-medium text-gray-900">{player.name}</div>
              <div className="text-sm text-gray-500">{player.club} • {player.position}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-center">
          <span className="text-sm font-semibold text-green-600">
            {player.stats ? calculateTotalValue(player.stats).toFixed(1) : '0.0'}
          </span>
        </td>
        {leagueSettings.selectedCategories.map(category => {
          const perGameValue = player.stats && player.stats.games > 0 
            ? (player.stats[category] || 0) / player.stats.games 
            : 0;
          const categoryData = FANTASY_CATEGORIES[category];
          const displayValue = categoryData?.format === 'percentage' 
            ? `${perGameValue.toFixed(1)}%`
            : perGameValue.toFixed(1);
          
          return (
            <td key={category} className="px-2 py-3 text-center">
              <span className="text-xs">
                {player.stats ? displayValue : '0.0'}
              </span>
            </td>
          );
        })}
        <td className="px-3 py-3 text-center">
          <Button
            onClick={() => handlePlayerSelect(player)}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
          >
            {isLoading ? 'Drafting...' : 'Draft'}
          </Button>
        </td>
      </tr>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Live Pick Header */}
      <LivePickHeader 
        draftData={draftData}
        timePerPick={120} // You can make this configurable later
        isYourTurn={isYourTurn}
        yourSlot={1} // You are always slot 1
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Quick Action Prompt */}
        {isYourTurn && draftData.status === 'LIVE' && (
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-4 rounded-lg shadow-lg border-l-4 border-yellow-400">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
              <div>
                <h3 className="font-bold text-lg">🎯 Your Turn to Pick!</h3>
                <p className="text-green-100">Browse the Available Players tab below and select your next draft pick.</p>
              </div>
            </div>
          </div>
        )}

        {/* Draft Header with Settings */}
        <div className="bg-white rounded-lg border p-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Draft Room</h2>
            <p className="text-gray-600 text-sm">
              Showing {leagueSettings.selectedCategories.length} fantasy categories: {' '}
              {leagueSettings.selectedCategories.map(cat => cat.charAt(0).toUpperCase() + cat.slice(1)).join(', ')}
            </p>
          </div>
          <Button
            onClick={() => setFantasySettingsModal(true)}
            className="bg-purple-600 text-white hover:bg-purple-700 px-4 py-2 text-sm"
          >
            ⚙️ Fantasy Settings
          </Button>
        </div>

      {/* Tabs */}
      <Tabs
        tabs={[
          { value: 'available', label: `Available Players (${filteredPlayers.length})` },
          { value: 'watchlist', label: `Watchlist (${watchlistPlayers.length})` },
          { value: 'picks', label: `Draft Board (${draftData.picks.length})` },
          { value: 'pick-feed', label: 'Pick Feed' },
          { value: 'my-team', label: 'My Team' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Available Players Tab */}
      {tab === 'available' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white rounded-lg border p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label htmlFor="search" className="block text-sm font-medium mb-1">Search</label>
                <input
                  id="search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search players..."
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              
              <div>
                <label htmlFor="position" className="block text-sm font-medium mb-1">Position</label>
                <select
                  id="position"
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  {POSITIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="club" className="block text-sm font-medium mb-1">Club</label>
                <select
                  id="club"
                  value={clubFilter}
                  onChange={(e) => setClubFilter(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  {CLUBS.map(club => (
                    <option key={club} value={club}>{club}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sortBy" className="block text-sm font-medium mb-1">Sort By</label>
                <select
                  id="sortBy"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'name' | 'position' | 'club')}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="name">Name</option>
                  <option value="position">Position</option>
                  <option value="club">Club</option>
                </select>
              </div>

              <div>
                <label htmlFor="sortOrder" className="block text-sm font-medium mb-1">Order</label>
                <select
                  id="sortOrder"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="asc">A-Z</option>
                  <option value="desc">Z-A</option>
                </select>
              </div>
            </div>
          </div>

          {/* Players Table */}
          <div className="bg-white rounded-lg border overflow-x-auto">
            <Table className="text-left w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 bg-gray-50 px-4 py-3 font-medium text-left border-r border-gray-200 z-10">Player</th>
                  <th className="px-3 py-3 font-medium text-center">Total</th>
                  {leagueSettings.selectedCategories.map(category => {
                    const categoryData = FANTASY_CATEGORIES[category];
                    return (
                      <th key={category} className="px-2 py-3 font-medium text-center text-xs whitespace-nowrap">
                        {categoryData?.abbrev || category}
                      </th>
                    );
                  })}
                  <th className="px-3 py-3 font-medium text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((player) => (
                  <PlayerRow key={player.id} player={player} />
                ))}
                {filteredPlayers.length === 0 && (
                  <tr>
                    <td colSpan={3 + leagueSettings.selectedCategories.length} className="px-4 py-8 text-center text-gray-500">
                      No players found matching your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {/* Watchlist Tab */}
      {tab === 'watchlist' && (
        <div className="h-[600px]">
          <DraftWatchlist
            players={players}
            draftedPlayerIds={draftData.picks.map(pick => pick.player.id)}
            onDraftPlayer={handlePlayerSelect}
            canDraft={isYourTurn || true} // Allow admin override
            className="h-full"
          />
        </div>
      )}

      {/* Draft Board Tab */}
      {tab === 'picks' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <Table className="text-left">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 font-medium">Pick</th>
                <th className="px-4 py-3 font-medium">Round</th>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Club</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {draftData.picks.map((pick) => (
                <tr key={pick.id} className="odd:bg-neutral-50">
                  <td className="px-4 py-2 font-bold">#{pick.overall}</td>
                  <td className="px-4 py-2">{pick.round}</td>
                  <td className="px-4 py-2">{pick.member.displayName}</td>
                  <td className="px-4 py-2 font-medium">{pick.player.name}</td>
                  <td className="px-4 py-2">{pick.player.position}</td>
                  <td className="px-4 py-2">{pick.player.club}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {new Date(pick.madeAt).toLocaleTimeString()}
                    {pick.auto && <span className="ml-1 text-orange-500">(Auto)</span>}
                  </td>
                </tr>
              ))}
              {draftData.picks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No picks made yet
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {/* Pick Feed Tab */}
      {tab === 'pick-feed' && (
        <div className="h-[600px]">
          <PickFeed
            picks={draftData.picks}
            participants={draftData.participants}
            userMemberId={draftData.participants[0]?.member.id || ''}
            watchlistPlayerIds={watchlistItems.map(item => item.playerId)}
            className="h-full"
          />
        </div>
      )}

      {/* My Team Tab */}
      {tab === 'my-team' && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="p-4 bg-green-50 border-b">
            <h3 className="font-bold text-green-800">Your Team (Slot 1)</h3>
            <p className="text-sm text-green-600">
              {draftData.picks.filter(pick => pick.member.id === draftData.participants[0]?.member.id).length} players selected
            </p>
          </div>
          <Table className="text-left">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-3 font-medium">Pick #</th>
                <th className="px-4 py-3 font-medium">Round</th>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Club</th>
                <th className="px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {draftData.picks
                .filter(pick => pick.member.id === draftData.participants[0]?.member.id)
                .map((pick) => (
                <tr key={pick.id} className="odd:bg-green-25 hover:bg-green-50">
                  <td className="px-4 py-2 font-bold text-green-700">#{pick.overall}</td>
                  <td className="px-4 py-2">{pick.round}</td>
                  <td className="px-4 py-2 font-medium">{pick.player.name}</td>
                  <td className="px-4 py-2">{pick.player.position}</td>
                  <td className="px-4 py-2">{pick.player.club}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {new Date(pick.madeAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
              {draftData.picks.filter(pick => pick.member.id === draftData.participants[0]?.member.id).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No picks made yet. Make your first pick when it&apos;s your turn!
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal open={confirmModal.open} onClose={() => setConfirmModal({ open: false })}>
        {confirmModal.player && (
          <div className="p-6">
            <h3 className="text-lg font-bold mb-4">
              {isYourTurn ? 'Confirm Your Draft Pick' : 'Admin Override Pick'}
            </h3>
            <div className="mb-6">
              <p className="text-gray-600 mb-2">
                {isYourTurn 
                  ? 'You are about to draft:' 
                  : `Making pick for ${currentPickingTeam?.member.displayName}:`
                }
              </p>
              <div className={`p-4 rounded ${isYourTurn ? 'bg-green-50' : 'bg-blue-50'}`}>
                <p className="font-bold text-lg">{confirmModal.player.name}</p>
                <p className="text-gray-600">{confirmModal.player.position} - {confirmModal.player.club}</p>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Pick #{draftData.currentPick} of {draftData.totalPicks}
                {!isYourTurn && ' (Admin Override)'}
              </p>
            </div>
            <div className="flex gap-4">
              <Button
                onClick={handleConfirmPick}
                disabled={isLoading}
                className={`px-6 py-2 rounded disabled:opacity-50 ${
                  isYourTurn 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isLoading ? 'Making Pick...' : (isYourTurn ? 'Confirm Pick' : 'Override Pick')}
              </Button>
              <Button
                onClick={() => setConfirmModal({ open: false })}
                className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Fantasy Settings Modal */}
      <Modal open={fantasySettingsModal} onClose={() => setFantasySettingsModal(false)}>
        <div className="max-w-4xl w-full max-h-[80vh] overflow-y-auto">
          <FantasyLeagueSettings
            initialSettings={leagueSettings}
            onSave={(settings) => {
              setLeagueSettings(settings);
              setFantasySettingsModal(false);
            }}
            onCancel={() => setFantasySettingsModal(false)}
            maxCategories={9}
          />
        </div>
      </Modal>
    </div>
  </div>
  );
}
