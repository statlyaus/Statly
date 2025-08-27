'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  PlusIcon,
  MinusIcon,
} from '@heroicons/react/24/outline';
import { formatInTimezone, getBrowserTimeZone } from '@/lib/timezone';
import { type LeagueActivityItem } from '@/services/leagueDataService';

// Types
interface WaiverClaim {
  id: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerTeam: string;
  action: 'add' | 'drop' | 'trade';
  dropPlayerId?: string;
  dropPlayerName?: string;
  bidAmount?: number;
  priority: number;
  status: 'pending' | 'successful' | 'failed' | 'outbid';
  submittedAt: Date;
  processedAt?: Date;
  userId: string;
  userName: string;
}

interface FAABBalance {
  userId: string;
  userName: string;
  currentBalance: number;
  totalBudget: number;
  pendingBids: number;
  successfulBids: number;
  rank: number;
}

interface WaiverSettings {
  waiverPeriod: number; // hours
  fAABBudget: number;
  minimumBid: number;
  maxClaims: number;
  processingDay: string;
  processingTime: string;
}

interface PlayerOption {
  id: string;
  name: string;
  team?: string;
  position?: string;
  ownership?: number;
}

type ActivityFeedItem = LeagueActivityItem & { playerName?: string; dropPlayerName?: string; teamName?: string };

interface WaiverFAABSystemProps {
  currentBalance?: number;
  pendingBids?: number;
  totalBudget?: number;
  userTeamName?: string;
  minimumBid?: number;
  userClaims?: WaiverClaim[];
  availablePlayers?: PlayerOption[];
  rosterDropOptions?: PlayerOption[];
  onSubmitClaim?: (claim: Partial<WaiverClaim>) => void;
  onCancelClaim?: (id: string) => void;
  activityItems?: ActivityFeedItem[];
  // New optional lazy-loading hooks for players
  onLoadMorePlayers?: () => void;
  loadingMorePlayers?: boolean;
  hasMorePlayers?: boolean;
}

// Mock data
const mockUserClaims: WaiverClaim[] = [
  {
    id: '1',
    playerId: 'p1',
    playerName: 'Tom Mitchell',
    playerPosition: 'MID',
    playerTeam: 'HAW',
    action: 'add',
    dropPlayerId: 'p2',
    dropPlayerName: 'Jack Steele',
    bidAmount: 25,
    priority: 1,
    status: 'pending',
    submittedAt: new Date('2025-08-14T10:30:00'),
    userId: 'user1',
    userName: 'You',
  },
  {
    id: '2',
    playerId: 'p3',
    playerName: 'Bailey Smith',
    playerPosition: 'MID',
    playerTeam: 'WBD',
    action: 'add',
    bidAmount: 15,
    priority: 2,
    status: 'outbid',
    submittedAt: new Date('2025-08-13T15:20:00'),
    processedAt: new Date('2025-08-14T09:00:00'),
    userId: 'user1',
    userName: 'You',
  },
];

const mockFAABBalances: FAABBalance[] = [
  {
    userId: 'user1',
    userName: 'You',
    currentBalance: 75,
    totalBudget: 100,
    pendingBids: 25,
    successfulBids: 0,
    rank: 5,
  },
  {
    userId: 'user2',
    userName: 'The Swans',
    currentBalance: 82,
    totalBudget: 100,
    pendingBids: 18,
    successfulBids: 0,
    rank: 2,
  },
  {
    userId: 'user3',
    userName: 'Eagles Soaring',
    currentBalance: 45,
    totalBudget: 100,
    pendingBids: 0,
    successfulBids: 55,
    rank: 8,
  },
  {
    userId: 'user4',
    userName: 'Tiger Power',
    currentBalance: 90,
    totalBudget: 100,
    pendingBids: 10,
    successfulBids: 0,
    rank: 1,
  },
];

const mockWaiverSettings: WaiverSettings = {
  waiverPeriod: 48,
  fAABBudget: 100,
  minimumBid: 1,
  maxClaims: 5,
  processingDay: 'Wednesday',
  processingTime: '09:00',
};

export default function WaiverFAABSystem({
  userClaims = mockUserClaims,
  availablePlayers = [],
  rosterDropOptions = [],
  onSubmitClaim,
  onCancelClaim,
  activityItems = [],
  currentBalance,
  pendingBids,
  totalBudget,
  userTeamName,
  minimumBid,
  onLoadMorePlayers,
  loadingMorePlayers,
  hasMorePlayers,
}: WaiverFAABSystemProps) {
  const [activeTab, setActiveTab] = useState<
    'my-claims' | 'faab-balances' | 'league-activity' | 'submit-claim'
  >('my-claims');
  const timeZone = useMemo(() => getBrowserTimeZone(), []);

  // Infinite scroll for players list (optional)
  const playersSentinelRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!onLoadMorePlayers || !hasMorePlayers) return;
    const node = playersSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !loadingMorePlayers) {
          onLoadMorePlayers();
        }
      },
      { root: null, rootMargin: '200px', threshold: 0 }
    );
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      observer.disconnect();
    };
  }, [onLoadMorePlayers, hasMorePlayers, loadingMorePlayers, availablePlayers.length]);

  // Keyboard accessible tabs
  const tabs = useMemo(
    () =>
      [
        { id: 'my-claims', label: 'My Claims' },
        { id: 'faab-balances', label: 'FAAB Balances' },
        { id: 'league-activity', label: 'League Activity' },
        { id: 'submit-claim', label: 'Submit Claim' },
      ] as const,
    []
  );
  const tabRefs = useRef<HTMLButtonElement[]>([]);
  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      const last = tabs.length - 1;
      if (e.key === 'ArrowRight' || e.key === 'Right') {
        e.preventDefault();
        const next = idx === last ? 0 : idx + 1;
        tabRefs.current[next]?.focus();
        setActiveTab(tabs[next].id);
      } else if (e.key === 'ArrowLeft' || e.key === 'Left') {
        e.preventDefault();
        const prev = idx === 0 ? last : idx - 1;
        tabRefs.current[prev]?.focus();
        setActiveTab(tabs[prev].id);
      } else if (e.key === 'Home') {
        e.preventDefault();
        tabRefs.current[0]?.focus();
        setActiveTab(tabs[0].id);
      } else if (e.key === 'End') {
        e.preventDefault();
        tabRefs.current[last]?.focus();
        setActiveTab(tabs[last].id);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActiveTab(tabs[idx].id);
      }
    },
    [tabs]
  );

  const userBalance = useMemo(() => {
    const mock = mockFAABBalances.find((b: FAABBalance) => b.userName === 'You');
    const minBid = typeof minimumBid === 'number' ? minimumBid : mockWaiverSettings.minimumBid;
    return {
      currentBalance: typeof currentBalance === 'number' ? currentBalance : (mock?.currentBalance ?? 0),
      pendingBids: typeof pendingBids === 'number' ? pendingBids : (mock?.pendingBids ?? 0),
      totalBudget: typeof totalBudget === 'number' ? totalBudget : (mock?.totalBudget ?? mockWaiverSettings.fAABBudget),
      minimumBid: minBid,
      rank: mock?.rank ?? 0,
      userName: 'You',
      userId: 'user1',
      successfulBids: mock?.successfulBids ?? 0,
    } as const;
  }, [currentBalance, pendingBids, totalBudget, minimumBid]);

  const nextProcessing = useMemo(() => {
    const now = new Date();
    const nextWed = new Date();
    nextWed.setDate(now.getDate() + ((3 - now.getDay() + 7) % 7));
    nextWed.setHours(9, 0, 0, 0);

    if (nextWed <= now) {
      nextWed.setDate(nextWed.getDate() + 7);
    }

    return nextWed;
  }, []);

  const timeUntilProcessing = useMemo(() => {
    const now = new Date();
    const diff = nextProcessing.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }, [nextProcessing]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <ClockIcon className="w-5 h-5 text-yellow-500" />;
      case 'successful':
        return <CheckCircleIcon className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="w-5 h-5 text-red-500" />;
      case 'outbid':
        return <ExclamationTriangleIcon className="w-5 h-5 text-orange-500" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'successful':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'outbid':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Form state
  const [newClaim, setNewClaim] = useState({
    playerId: '',
    playerName: '',
    playerPosition: '',
    playerTeam: '',
    action: 'add' as 'add' | 'drop',
    dropPlayerId: '',
    dropPlayerName: '',
    bidAmount: mockWaiverSettings.minimumBid,
    priority: 1,
  });

  const handleSubmitClaim = () => {
    if (newClaim.action === 'add' && !newClaim.playerId) return;
    if (newClaim.action === 'drop' && !newClaim.dropPlayerId) return;
    if (
      newClaim.action === 'add' &&
      (!newClaim.playerName || !newClaim.bidAmount || newClaim.bidAmount < userBalance.minimumBid)
    )
      return;

    const claim: Partial<WaiverClaim> = {
      playerId: newClaim.playerId,
      playerName: newClaim.playerName,
      playerPosition: newClaim.playerPosition,
      playerTeam: newClaim.playerTeam,
      action: newClaim.action,
      dropPlayerId: newClaim.dropPlayerId || undefined,
      dropPlayerName: newClaim.dropPlayerName || undefined,
      bidAmount: newClaim.action === 'add' ? newClaim.bidAmount : undefined,
      priority: newClaim.priority,
      status: 'pending',
      submittedAt: new Date(),
      userId: 'user1',
      userName: 'You',
    };

    onSubmitClaim?.(claim);

    // Reset form
    setNewClaim({
      playerId: '',
      playerName: '',
      playerPosition: '',
      playerTeam: '',
      action: 'add',
      dropPlayerId: '',
      dropPlayerName: '',
      bidAmount: mockWaiverSettings.minimumBid,
      priority: 1,
    });

    setActiveTab('my-claims');
  };

  const onSelectAddPlayer = (playerId: string) => {
    const p = availablePlayers.find((ap) => ap.id === playerId);
    if (!p) return;
    setNewClaim((prev) => ({
      ...prev,
      playerId: p.id,
      playerName: p.name,
      playerTeam: p.team || '',
      playerPosition: p.position || '',
    }));
  };

  const onSelectDropPlayer = (playerId: string) => {
    if (!playerId) {
      setNewClaim((prev) => ({ ...prev, dropPlayerId: '', dropPlayerName: '' }));
      return;
    }
    const p = rosterDropOptions.find((rp) => rp.id === playerId);
    setNewClaim((prev) => ({
      ...prev,
      dropPlayerId: playerId,
      dropPlayerName: p?.name || playerId,
    }));
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Waivers & FAAB</h1>
          <p className="text-gray-600 mt-1">{userTeamName ? `Team: ${userTeamName}` : 'Manage your waiver claims and FAAB budget'}</p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-green-600">
            ${userBalance.currentBalance || 0}
          </div>
          <div className="text-sm text-gray-500">FAAB Remaining</div>
          <div className="text-xs text-gray-400">${userBalance.pendingBids || 0} pending</div>
        </div>
      </div>

      {/* Processing Timer */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Next Processing</h3>
            <p className="text-gray-600">
              {formatInTimezone(nextProcessing, timeZone, 'PPP')} at {mockWaiverSettings.processingTime}
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{timeUntilProcessing}</div>
            <div className="text-sm text-gray-600">Remaining</div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div
        className="flex space-x-1 bg-gray-100 p-1 rounded-lg"
        role="tablist"
        aria-label="Waivers sections"
      >
        {tabs.map((t, idx) => (
          <button
            key={t.id}
            id={`waivers-tab-${t.id}`}
            role="tab"
            aria-selected={activeTab === t.id}
            aria-controls={`waivers-panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            ref={(el) => {
              if (el) tabRefs.current[idx] = el;
            }}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
            onClick={() => setActiveTab(t.id)}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === t.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'my-claims' && (
          <motion.div
            key="my-claims"
            id="waivers-panel-my-claims"
            role="tabpanel"
            aria-labelledby="waivers-tab-my-claims"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Your Waiver Claims</h3>
            </div>

            {userClaims.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <ClockIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No active waiver claims</p>
                <button
                  onClick={() => setActiveTab('submit-claim')}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Submit Your First Claim
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {userClaims.map((claim, index) => (
                  <motion.div
                    key={claim.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {getStatusIcon(claim.status)}
                        <div>
                          <div className="font-semibold text-gray-900">
                            {claim.action === 'add' ? 'Add' : 'Drop'} {claim.playerName}
                          </div>
                          <div className="text-sm text-gray-600">
                            {claim.playerPosition} - {claim.playerTeam}
                            {claim.dropPlayerName && ` • Drop ${claim.dropPlayerName}`}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Submitted {formatInTimezone(claim.submittedAt, timeZone, 'PP p')}
                          </div>
                          {userTeamName && (
                            <div className="text-xs text-gray-500">Team: {userTeamName}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-bold text-gray-900">${claim.bidAmount}</div>
                          <div className="text-sm text-gray-500">Priority {claim.priority}</div>
                        </div>

                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(claim.status)}`}
                        >
                          {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
                        </span>

                        {claim.status === 'pending' && (
                          <button
                            onClick={() => onCancelClaim?.(claim.id)}
                            className="px-3 py-1 text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'faab-balances' && (
          <motion.div
            key="faab-balances"
            id="waivers-panel-faab-balances"
            role="tabpanel"
            aria-labelledby="waivers-tab-faab-balances"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">FAAB Balances</h3>
              <p className="text-sm text-gray-600">
                Total budget: ${userBalance.totalBudget} per team
              </p>
            </div>

            {/* If we have real balance, just show the user's card */}
            {typeof currentBalance === 'number' ? (
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-blue-100 text-blue-800">
                      {userBalance.rank || 0}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">You</div>
                      <div className="text-sm text-gray-600">
                        ${userBalance.successfulBids} spent • ${userBalance.pendingBids} pending
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">${userBalance.currentBalance}</div>
                    <div className="text-sm text-gray-500">Available</div>
                    <div className="w-24 bg-gray-200 rounded-full h-2 mt-2">
                      <div
                        className="bg-green-600 h-2 rounded-full"
                        style={{ width: `${Math.min(100, (userBalance.currentBalance / (userBalance.totalBudget || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {mockFAABBalances.map((balance: FAABBalance, index: number) => (
                  <motion.div
                    key={balance.userId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`p-6 ${balance.userName === 'You' ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            balance.rank <= 3 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {balance.rank}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">
                            {balance.userName}
                            {balance.userName === 'You' && (
                              <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">You</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600">
                            ${balance.successfulBids} spent • ${balance.pendingBids} pending
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-2xl font-bold text-gray-900">${balance.currentBalance}</div>
                        <div className="text-sm text-gray-500">Available</div>

                        {/* Balance Bar */}
                        <div className="w-24 bg-gray-200 rounded-full h-2 mt-2">
                          <div
                            className="bg-green-600 h-2 rounded-full"
                            style={{ width: `${(balance.currentBalance / balance.totalBudget) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'league-activity' && (
          <motion.div
            key="league-activity"
            id="waivers-panel-league-activity"
            role="tabpanel"
            aria-labelledby="waivers-tab-league-activity"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg p-6"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Recent League Activity</h3>
            {activityItems.length === 0 ? (
              <p className="text-sm text-gray-600">No recent activity.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {activityItems.map((item: ActivityFeedItem) => {
                  const isSuccess = item.type === 'waiver-successful';
                  const isFailed = item.type === 'waiver-failed';
                  const isCancelled = item.type === 'waiver-cancelled';
                  const isSubmitted = item.type === 'waiver-submitted';
                  const Icon = isSuccess
                    ? CheckCircleIcon
                    : isFailed
                    ? XCircleIcon
                    : isCancelled
                    ? ExclamationTriangleIcon
                    : ClockIcon;
                  const actionText = isSuccess
                    ? 'won a claim for'
                    : isFailed
                    ? 'lost a claim for'
                    : isCancelled
                    ? 'cancelled a claim for'
                    : isSubmitted
                    ? 'submitted a claim for'
                    : 'updated';
                  const playerText = item.playerName || item.playerId || 'a player';
                  const dropText = item.dropPlayerName ? ` • drop ${item.dropPlayerName}` : '';
                  return (
                    <li key={item.id} className="py-3 flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <Icon
                          className={`w-5 h-5 ${
                            isSuccess
                              ? 'text-green-500'
                              : isFailed
                              ? 'text-red-500'
                              : isCancelled
                              ? 'text-orange-500'
                              : 'text-gray-500'
                          }`}
                        />
                        <div>
                          <div className="text-sm text-gray-900">
                            <span className="font-medium">{item.teamName || item.userId || 'Team'}</span> {actionText}{' '}
                            <span className="font-medium">{playerText}</span>
                            {dropText}
                            {typeof item.priority === 'number' ? ` • prio ${item.priority}` : ''}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatInTimezone(item.timestamp, timeZone, 'PP p')}
                            {typeof item.bidAmount === 'number' ? ` • $${item.bidAmount}` : ''}
                            {item.reason ? ` • ${item.reason}` : ''}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}

        {activeTab === 'submit-claim' && (
          <motion.div
            key="submit-claim"
            id="waivers-panel-submit-claim"
            role="tabpanel"
            aria-labelledby="waivers-tab-submit-claim"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg p-6"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Submit Waiver Claim</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="actionType"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Action Type
                  </label>
                  <select
                    id="actionType"
                    value={newClaim.action}
                    onChange={(e) =>
                      setNewClaim((prev) => ({ ...prev, action: e.target.value as 'add' | 'drop' }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="add">Add Player</option>
                    <option value="drop">Drop Player</option>
                  </select>
                </div>

                {newClaim.action === 'add' && (
                  <div>
                    <label htmlFor="addPlayerSelect" className="block text-sm font-medium text-gray-700 mb-2">
                      Select Player to Add
                    </label>
                    <select
                      id="addPlayerSelect"
                      value={newClaim.playerId}
                      onChange={(e) => onSelectAddPlayer(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select a player</option>
                      {availablePlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.team ? `• ${p.team}` : ''} {p.position ? `(${p.position})` : ''}
                          {typeof p.ownership === 'number' ? ` • Own ${p.ownership}%` : ''}
                        </option>
                      ))}
                    </select>
                    {hasMorePlayers && (
                      <div className="mt-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={onLoadMorePlayers}
                          disabled={loadingMorePlayers}
                          className={`px-3 py-2 border rounded-md text-sm ${loadingMorePlayers ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                        >
                          {loadingMorePlayers ? 'Loading more…' : 'Load more players'}
                        </button>
                        <div ref={playersSentinelRef} className="h-1 w-1" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="dropPlayerSelect" className="block text-sm font-medium text-gray-700 mb-2">
                    {newClaim.action === 'add' ? 'Optional: Select Player to Drop' : 'Select Player to Drop'}
                  </label>
                  <select
                    id="dropPlayerSelect"
                    value={newClaim.dropPlayerId}
                    onChange={(e) => onSelectDropPlayer(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">None</option>
                    {rosterDropOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.team ? `• ${p.team}` : ''} {p.position ? `(${p.position})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                {newClaim.action === 'add' && (
                  <div>
                    <label
                      htmlFor="bidAmount"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      FAAB Bid Amount
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setNewClaim((prev) => ({
                            ...prev,
                            bidAmount: Math.max(userBalance.minimumBid, prev.bidAmount - 1),
                          }))
                        }
                        className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                      >
                        <MinusIcon className="w-4 h-4" />
                      </button>
                      <input
                        id="bidAmount"
                        type="number"
                        value={newClaim.bidAmount}
                        onChange={(e) =>
                          setNewClaim((prev) => ({
                            ...prev,
                            bidAmount: parseInt(e.target.value, 10) || 0,
                          }))
                        }
                        min={userBalance.minimumBid}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                      />
                      <button
                        onClick={() =>
                          setNewClaim((prev) => ({
                            ...prev,
                            bidAmount: prev.bidAmount + 1,
                          }))
                        }
                        className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                      >
                        <PlusIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Minimum bid: ${userBalance.minimumBid}</p>
                  </div>
                )}

                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Claim Summary</h4>
                  <div className="text-sm space-y-1">
                    <div>
                      Action: {newClaim.action === 'add' ? 'Add' : 'Drop'}{' '}
                      {newClaim.playerName || (newClaim.action === 'drop' ? newClaim.dropPlayerName : 'Player')}
                    </div>
                    {newClaim.action === 'add' && (
                      <>
                        <div>Bid: ${newClaim.bidAmount}</div>
                        <div>Priority: {newClaim.priority}</div>
                        {newClaim.dropPlayerName && <div>Drop: {newClaim.dropPlayerName}</div>}
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleSubmitClaim}
                  disabled={
                    (newClaim.action === 'add' && (!newClaim.playerId || newClaim.bidAmount < userBalance.minimumBid)) ||
                    (newClaim.action === 'drop' && !newClaim.dropPlayerId) ||
                    (typeof currentBalance === 'number' && typeof pendingBids === 'number' && newClaim.action === 'add' && (pendingBids + (newClaim.bidAmount || 0) > currentBalance))
                  }
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Submit Claim
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
