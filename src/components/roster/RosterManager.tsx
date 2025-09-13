'use client';

import { useState, useEffect } from 'react';

import {
  UserIcon,
  PlusIcon,
  ArrowsUpDownIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import type { Player } from '@/types/players';

interface RosterSlot {
  id: string;
  position: string;
  playerId?: string;
  player?: Player;
  isRequired: boolean;
  isLocked: boolean;
}

interface RosterManagerProps {
  leagueId: string;
  teamId?: string;
  rosterSlots?: RosterSlot[];
  availablePlayers?: Player[];
  onRosterChange?: (slots: RosterSlot[]) => void;
  readonly?: boolean;
}

const DEFAULT_ROSTER_STRUCTURE = [
  // Starting lineup
  { position: 'DEF', count: 6, label: 'Defenders' },
  { position: 'MID', count: 8, label: 'Midfielders' },
  { position: 'RUC', count: 2, label: 'Rucks' },
  { position: 'FWD', count: 6, label: 'Forwards' },
  // Bench
  { position: 'BENCH', count: 4, label: 'Bench' },
  // Emergencies
  { position: 'EMG', count: 2, label: 'Emergencies' },
];

export default function RosterManager({
  leagueId: _leagueId,
  teamId: _teamId,
  rosterSlots = [],
  availablePlayers = [],
  onRosterChange,
  readonly = false,
}: RosterManagerProps) {
  const { user: _user } = useAuth();
  const [slots, setSlots] = useState<RosterSlot[]>(rosterSlots);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutStatus, setLockoutStatus] = useState<'open' | 'locked' | 'pending'>('open');

  // Initialize default roster structure if no slots provided
  useEffect(() => {
    if (rosterSlots.length === 0) {
      const defaultSlots: RosterSlot[] = [];

      DEFAULT_ROSTER_STRUCTURE.forEach(({ position, count }) => {
        for (let i = 0; i < count; i++) {
          defaultSlots.push({
            id: `${position}_${i + 1}`,
            position,
            isRequired: position !== 'BENCH' && position !== 'EMG',
            isLocked: false,
          });
        }
      });

      setSlots(defaultSlots);
    }
  }, [rosterSlots]);

  // Simulate lockout status check
  useEffect(() => {
    // In a real app, this would check against round lockout times
    const checkLockoutStatus = () => {
      const now = new Date();
      const roundStart = new Date('2025-08-22T19:50:00'); // Example round start
      const timeDiff = roundStart.getTime() - now.getTime();

      if (timeDiff <= 0) {
        setLockoutStatus('locked');
      } else if (timeDiff <= 2 * 60 * 60 * 1000) {
        // 2 hours before
        setLockoutStatus('pending');
      } else {
        setLockoutStatus('open');
      }
    };

    checkLockoutStatus();
    const interval = setInterval(checkLockoutStatus, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  const addPlayerToSlot = async (slotId: string, playerId: string) => {
    if (readonly || lockoutStatus === 'locked') return;

    setLoading(true);
    setError(null);

    try {
      // Find the player and slot
      const player = availablePlayers.find((p) => p.id === playerId);
      if (!player) {
        throw new Error('Player not found');
      }

      // Update the slot
      const updatedSlots: RosterSlot[] = slots.map((slot) => {
        if (slot.id === slotId) {
          return { ...slot, playerId, player };
        }
        if (slot.playerId === playerId) {
          const { playerId: _removedPlayerId, player: _removedPlayer, ...rest } = slot;
          return rest as RosterSlot;
        }
        return slot;
      });

      setSlots(updatedSlots);
      onRosterChange?.(updatedSlots);
      setSelectedSlot(null);

      // In a real app, save to backend
      // await saveRosterChange(leagueId, teamId, slotId, playerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update roster');
    } finally {
      setLoading(false);
    }
  };

  const removePlayerFromSlot = async (slotId: string) => {
    if (readonly || lockoutStatus === 'locked') return;

    setLoading(true);
    try {
      const updatedSlots: RosterSlot[] = slots.map((slot) => {
        if (slot.id === slotId) {
          const { playerId: _removedPlayerId, player: _removedPlayer, ...rest } = slot;
          return rest as RosterSlot;
        }
        return slot;
      });

      setSlots(updatedSlots);
      onRosterChange?.(updatedSlots);

      // In a real app, save to backend
      // await saveRosterChange(leagueId, teamId, slotId, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update roster');
    } finally {
      setLoading(false);
    }
  };

  const filteredPlayers = availablePlayers.filter(
    (player) =>
      player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      player.team?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSlotsByPosition = (position: string) => {
    return slots.filter((slot) => slot.position === position);
  };

  const isRosterComplete = () => {
    return slots.filter((slot) => slot.isRequired).every((slot) => slot.playerId);
  };

  const getLockoutStatusInfo = () => {
    switch (lockoutStatus) {
      case 'locked':
        return {
          icon: XCircleIcon,
          text: 'Lineup Locked',
          color: 'text-red-600',
          bgColor: 'bg-red-50',
        };
      case 'pending':
        return {
          icon: ClockIcon,
          text: 'Lockout Soon',
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50',
        };
      default:
        return {
          icon: CheckCircleIcon,
          text: 'Lineup Open',
          color: 'text-green-600',
          bgColor: 'bg-green-50',
        };
    }
  };

  const lockoutInfo = getLockoutStatusInfo();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Roster Management</h2>
          <p className="text-sm text-gray-600">Set your lineup for the upcoming round</p>
        </div>

        {/* Lockout Status */}
        <div className={`flex items-center px-3 py-2 rounded-lg ${lockoutInfo.bgColor}`}>
          <lockoutInfo.icon className={`w-4 h-4 mr-2 ${lockoutInfo.color}`} />
          <span className={`text-sm font-medium ${lockoutInfo.color}`}>{lockoutInfo.text}</span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500 mr-2" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Roster Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Starting Lineup */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Starting Lineup</h3>

          {DEFAULT_ROSTER_STRUCTURE.filter(
            (pos) => pos.position !== 'BENCH' && pos.position !== 'EMG'
          ).map(({ position, label }) => (
            <div key={position} className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{label}</h4>
              <div className="space-y-2">
                {getSlotsByPosition(position).map((slot, index) => (
                  <button
                    key={slot.id}
                    className={`w-full flex items-center justify-between p-3 border rounded-lg transition-colors ${
                      slot.player
                        ? 'border-green-200 bg-green-50'
                        : slot.isRequired
                          ? 'border-red-200 bg-red-50'
                          : 'border-gray-200 bg-gray-50'
                    } ${!readonly && lockoutStatus === 'open' ? 'hover:bg-gray-100' : ''}`}
                    onClick={() =>
                      !readonly && lockoutStatus === 'open' && setSelectedSlot(slot.id)
                    }
                    disabled={readonly || lockoutStatus !== 'open'}
                    aria-label={
                      slot.player
                        ? `${slot.player.name} in ${slot.position} ${index + 1} slot`
                        : `Empty ${slot.position} ${index + 1} slot`
                    }
                  >
                    <div className="flex items-center">
                      <UserIcon className="w-5 h-5 text-gray-400 mr-3" />
                      <div>
                        {slot.player ? (
                          <>
                            <p className="text-sm font-medium text-gray-900">{slot.player.name}</p>
                            <p className="text-xs text-gray-500">{slot.player.team}</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Empty Slot</p>
                        )}
                      </div>
                    </div>

                    {!readonly && lockoutStatus === 'open' && (
                      <div className="flex items-center space-x-2">
                        {slot.player && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePlayerFromSlot(slot.id);
                            }}
                            className="text-red-500 hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
                            aria-label={`Remove ${slot.player?.name ?? 'player'} from ${slot.position}`}
                          >
                            <XCircleIcon className="w-4 h-4" />
                          </button>
                        )}
                        <PlusIcon className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bench & Emergencies */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Bench & Emergencies</h3>

          {DEFAULT_ROSTER_STRUCTURE.filter(
            (pos) => pos.position === 'BENCH' || pos.position === 'EMG'
          ).map(({ position, label }) => (
            <div key={position} className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{label}</h4>
              <div className="space-y-2">
                {getSlotsByPosition(position).map((slot) => (
                  <button
                    key={slot.id}
                    className={`w-full flex items-center justify-between p-3 border rounded-lg transition-colors ${
                      slot.player ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
                    } ${!readonly && lockoutStatus === 'open' ? 'hover:bg-gray-100' : ''}`}
                    onClick={() =>
                      !readonly && lockoutStatus === 'open' && setSelectedSlot(slot.id)
                    }
                    disabled={readonly || lockoutStatus !== 'open'}
                  >
                    <div className="flex items-center">
                      <UserIcon className="w-5 h-5 text-gray-400 mr-3" />
                      <div>
                        {slot.player ? (
                          <>
                            <p className="text-sm font-medium text-gray-900">{slot.player.name}</p>
                            <p className="text-xs text-gray-500">{slot.player.team}</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Empty Slot</p>
                        )}
                      </div>
                    </div>

                    {!readonly && lockoutStatus === 'open' && (
                      <div className="flex items-center space-x-2">
                        {slot.player && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removePlayerFromSlot(slot.id);
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            <XCircleIcon className="w-4 h-4" />
                          </button>
                        )}
                        <PlusIcon className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Roster Status */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-gray-900">Lineup Status</h4>
            <p className="text-xs text-gray-500">
              {isRosterComplete()
                ? 'All required positions filled'
                : 'Some positions still need players'}
            </p>
          </div>
          <div
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              isRosterComplete() ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {isRosterComplete() ? 'Complete' : 'Incomplete'}
          </div>
        </div>
      </div>

      {/* Player Selection Modal */}
      <AnimatePresence>
        {selectedSlot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
            onClick={() => setSelectedSlot(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-96 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Select Player</h3>
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="overflow-y-auto max-h-64">
                {filteredPlayers.map((player) => (
                  <button
                    key={player.id}
                    onClick={() => addPlayerToSlot(selectedSlot, player.id)}
                    disabled={loading}
                    className="w-full p-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{player.name}</p>
                        <p className="text-xs text-gray-500">
                          {player.team} • {player.position}
                        </p>
                      </div>
                      <ArrowsUpDownIcon className="w-4 h-4 text-gray-400" />
                    </div>
                  </button>
                ))}

                {filteredPlayers.length === 0 && (
                  <div className="p-4 text-center text-gray-500">
                    <p className="text-sm">No players found</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
