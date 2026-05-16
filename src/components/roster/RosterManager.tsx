'use client';

import { useState, useEffect } from 'react';

import { ArrowUpDown, CheckCircle, Clock, Plus, TriangleAlert, User, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
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

type LockoutStatus = 'open' | 'locked' | 'pending';

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

const panelClassName = 'rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm';
const helpTextClassName = 'text-sm text-muted-foreground';
const iconClassName = 'mr-3 h-5 w-5 text-muted-foreground';
const emptySlotClassName = 'border-border bg-muted/30';
const filledSlotClassName = 'border-border bg-card';
const requiredEmptySlotClassName = 'border-destructive/30 bg-destructive/10';
const interactiveSlotClassName =
  'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function getDefaultLockoutStatus(): LockoutStatus {
  return 'open';
}

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
  const lockoutStatus = getDefaultLockoutStatus();

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
          icon: XCircle,
          text: 'Lineup Locked',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
        };
      case 'pending':
        return {
          icon: Clock,
          text: 'Lockout Soon',
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/60',
        };
      default:
        return {
          icon: CheckCircle,
          text: 'Lineup Open',
          color: 'text-foreground',
          bgColor: 'bg-muted/40',
        };
    }
  };

  const lockoutInfo = getLockoutStatusInfo();
  const canEditRoster = !readonly && lockoutStatus === 'open';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">Roster Management</h2>
          <p className={helpTextClassName}>Set your lineup for the upcoming round</p>
        </div>

        {/* Lockout Status */}
        <div className={`flex items-center rounded-md px-3 py-2 ${lockoutInfo.bgColor}`}>
          <lockoutInfo.icon className={`mr-2 h-4 w-4 ${lockoutInfo.color}`} />
          <span className={`text-sm font-medium ${lockoutInfo.color}`}>{lockoutInfo.text}</span>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <div className="flex items-center">
            <TriangleAlert className="mr-2 h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}

      {/* Roster Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Starting Lineup */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Starting Lineup</h3>

          {DEFAULT_ROSTER_STRUCTURE.filter(
            (pos) => pos.position !== 'BENCH' && pos.position !== 'EMG'
          ).map(({ position, label }) => (
            <div key={position} className={panelClassName}>
              <h4 className="mb-3 text-sm font-medium text-foreground">{label}</h4>
              <div className="space-y-2">
                {getSlotsByPosition(position).map((slot, index) => (
                  <div
                    key={slot.id}
                    className={`flex w-full items-center justify-between rounded-md border p-3 transition-colors ${
                      slot.player
                        ? filledSlotClassName
                        : slot.isRequired
                          ? requiredEmptySlotClassName
                          : emptySlotClassName
                    }`}
                  >
                    <button
                      type="button"
                      className={`flex flex-1 items-center text-left ${canEditRoster ? interactiveSlotClassName : ''}`}
                      onClick={() => canEditRoster && setSelectedSlot(slot.id)}
                      disabled={!canEditRoster}
                      aria-label={
                        slot.player
                          ? `${slot.player.name} in ${slot.position} ${index + 1} slot`
                          : `Empty ${slot.position} ${index + 1} slot`
                      }
                    >
                      <User className={iconClassName} />
                      <div>
                        {slot.player ? (
                          <>
                            <p className="text-sm font-medium text-foreground">
                              {slot.player.name}
                            </p>
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {slot.player.team ? (
                                <TeamLogo team={slot.player.team} size={14} withCircle decorative />
                              ) : null}
                              <span>{slot.player.team || '—'}</span>
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">Empty Slot</p>
                        )}
                      </div>
                    </button>

                    {canEditRoster && (
                      <div className="flex items-center space-x-2">
                        {slot.player && (
                          <button
                            type="button"
                            onClick={() => removePlayerFromSlot(slot.id)}
                            className="rounded text-destructive hover:text-destructive/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Remove ${slot.player?.name ?? 'player'} from ${slot.position}`}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedSlot(slot.id)}
                          className="rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Select player for ${slot.position} ${index + 1} slot`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bench & Emergencies */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Bench & Emergencies</h3>

          {DEFAULT_ROSTER_STRUCTURE.filter(
            (pos) => pos.position === 'BENCH' || pos.position === 'EMG'
          ).map(({ position, label }) => (
            <div key={position} className={panelClassName}>
              <h4 className="mb-3 text-sm font-medium text-foreground">{label}</h4>
              <div className="space-y-2">
                {getSlotsByPosition(position).map((slot, index) => (
                  <div
                    key={slot.id}
                    className={`flex w-full items-center justify-between rounded-md border p-3 transition-colors ${
                      slot.player ? filledSlotClassName : emptySlotClassName
                    }`}
                  >
                    <button
                      type="button"
                      className={`flex flex-1 items-center text-left ${canEditRoster ? interactiveSlotClassName : ''}`}
                      onClick={() => canEditRoster && setSelectedSlot(slot.id)}
                      disabled={!canEditRoster}
                      aria-label={
                        slot.player
                          ? `${slot.player.name} in ${slot.position} ${index + 1} slot`
                          : `Empty ${slot.position} ${index + 1} slot`
                      }
                    >
                      <User className={iconClassName} />
                      <div>
                        {slot.player ? (
                          <>
                            <p className="text-sm font-medium text-foreground">
                              {slot.player.name}
                            </p>
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {slot.player.team ? (
                                <TeamLogo team={slot.player.team} size={14} withCircle decorative />
                              ) : null}
                              <span>{slot.player.team || '—'}</span>
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">Empty Slot</p>
                        )}
                      </div>
                    </button>

                    {canEditRoster && (
                      <div className="flex items-center space-x-2">
                        {slot.player && (
                          <button
                            type="button"
                            onClick={() => removePlayerFromSlot(slot.id)}
                            className="rounded text-destructive hover:text-destructive/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Remove ${slot.player?.name ?? 'player'} from ${slot.position}`}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedSlot(slot.id)}
                          className="rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Select player for ${slot.position} ${index + 1} slot`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Roster Status */}
      <div className={panelClassName}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-foreground">Lineup Status</h4>
            <p className="text-xs text-muted-foreground">
              {isRosterComplete()
                ? 'All required positions filled'
                : 'Some positions still need players'}
            </p>
          </div>
          <div
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              isRosterComplete()
                ? 'border-border bg-muted/40 text-foreground'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
            onClick={() => setSelectedSlot(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="mx-4 max-h-96 w-full max-w-md overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-border p-4">
                <h3 className="text-lg font-semibold text-foreground">Select Player</h3>
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-ring focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="overflow-y-auto max-h-64">
                {filteredPlayers.map((player) => (
                  <button
                    key={player.id}
                    onClick={() => addPlayerToSlot(selectedSlot, player.id)}
                    disabled={loading}
                    className="w-full border-b border-border p-3 text-left transition-colors last:border-b-0 hover:bg-accent/40 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{player.name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {player.team ? (
                            <TeamLogo team={player.team} size={14} withCircle decorative />
                          ) : null}
                          <span>
                            {player.team || '—'} • {player.position}
                          </span>
                        </p>
                      </div>
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}

                {filteredPlayers.length === 0 && (
                  <div className="p-4 text-center text-muted-foreground">
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
