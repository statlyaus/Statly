'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  PlayIcon,
  CalendarIcon,
  UsersIcon,
  CogIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { fetchApi } from '@/lib/api';
import {
  DEFAULT_DRAFT_AUTO_PICK_RULES,
  DEFAULT_DRAFT_POSITION_LIMITS,
  POSITION_LIMIT_KEYS,
  TIME_PER_PICK_OPTIONS,
  getBenchSizeFromPositionLimits,
  getRosterSizeFromPositionLimits,
  normalizeDraftAutoPickRules,
  normalizeDraftPickOrderMode,
  normalizeDraftPositionLimits,
  type DraftAutoPickRules,
  type DraftPickOrderMode,
  type DraftPositionLimits,
  type PositionLimitKey,
} from '@/lib/draftSettings';
import type { League, LeagueMember } from '@/types/leagues';
import {
  isConnectivityError,
  getConnectivityErrorMessage,
  isExpectedTestLeague404,
} from '@/utils/errorHandling';

interface DraftParticipant {
  userId: string;
  memberId: string;
  displayName: string;
  draftOrder: number;
  isOwner: boolean;
}

interface DraftManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
  onDraftCreated?: (draftId: string) => void;
  onJoinDraftRoom?: (draftId: string) => void;
}

interface DraftSettings {
  scheduledTime: string;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  timeZone: string;
  enableReminders: boolean;
  pickOrder: DraftPickOrderMode;
  positionLimits: DraftPositionLimits;
  autoPickRules: DraftAutoPickRules;
}

interface ExistingDraft {
  id: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  startAt: string;
  createdAt: string;
}

interface DraftResponseShape {
  id: string;
  status?: string | null;
  startAt?: string | null;
  scheduledTime?: string | null;
  createdAt?: string | null;
  leagueId?: string | null;
  league?: { id?: string | null } | null;
}

interface LeagueDraftReadModel {
  draft?: DraftResponseShape | null;
}

const DRAFT_STATUSES = new Set(['SCHEDULED', 'LOBBY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'COMPLETED']);

function normalizeExistingDraftStatus(status: string | null | undefined): ExistingDraft['status'] {
  const normalized = status?.toUpperCase();
  return DRAFT_STATUSES.has(normalized ?? '')
    ? (normalized as ExistingDraft['status'])
    : 'SCHEDULED';
}

function toExistingDraft(draft: DraftResponseShape): ExistingDraft {
  const startAt =
    draft.startAt ?? draft.scheduledTime ?? draft.createdAt ?? new Date().toISOString();

  return {
    id: draft.id,
    status: normalizeExistingDraftStatus(draft.status),
    startAt,
    createdAt: draft.createdAt ?? startAt,
  };
}

export default function DraftManager({
  league,
  members,
  currentUserId,
  onDraftCreated,
  onJoinDraftRoom,
}: DraftManagerProps) {
  const router = useRouter();
  const [showDraftSettings, setShowDraftSettings] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [existingDraft, setExistingDraft] = useState<ExistingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftOrderMemberIds, setDraftOrderMemberIds] = useState<string[]>(() =>
    members.map((member) => member.id)
  );
  const [draftOrderRandomized, setDraftOrderRandomized] = useState(false);

  const [draftSettings, setDraftSettings] = useState<DraftSettings>({
    scheduledTime: '',
    draftType: 'snake',
    timePerPick: 120,
    timeZone: 'Australia/Melbourne',
    enableReminders: true,
    pickOrder: normalizeDraftPickOrderMode(league.pickOrder),
    positionLimits: { ...DEFAULT_DRAFT_POSITION_LIMITS },
    autoPickRules: { ...DEFAULT_DRAFT_AUTO_PICK_RULES },
  });

  const effectiveOwnerId =
    league.id === 'test-league-id' && currentUserId ? currentUserId : league.ownerId;
  const currentMember = members.find((member) => member.userId === currentUserId);
  const isCommissioner =
    currentUserId === effectiveOwnerId ||
    currentMember?.role === 'owner' ||
    currentMember?.role === 'manager';
  const hasEnoughMembers = members.length >= 4;
  const canCreateDraft = isCommissioner && hasEnoughMembers && !existingDraft;
  const draftOrderMembers = draftOrderMemberIds
    .map((memberId) => members.find((member) => member.id === memberId))
    .filter((member): member is LeagueMember => Boolean(member));

  const refreshDraftState = useCallback(async () => {
    try {
      const response = await fetchApi(`leagues/${league.id}/draft`);
      const data = response.data as LeagueDraftReadModel | undefined;
      if (response.success && data?.draft) {
        setExistingDraft(toExistingDraft(data.draft));
      } else if (response.success) {
        setExistingDraft(null);
      }
    } catch (error) {
      // Handle different types of errors
      if (error instanceof Error) {
        if (isConnectivityError(error)) {
          console.warn('Development server not running or API unreachable');
          setError(getConnectivityErrorMessage());
        } else if (isExpectedTestLeague404(error, league.id)) {
          // Expected for test leagues, don't show error
          console.debug('Test league draft check - 404 expected');
        } else {
          console.error('Error checking existing draft:', error);
          setError(`Failed to check draft status: ${error.message}`);
        }
      } else {
        console.error('Unknown error checking draft:', error);
        setError('An unexpected error occurred while checking draft status');
      }
    }
  }, [league.id]);

  // Initialize schedule defaults on mount.
  useEffect(() => {
    setDraftSettings((prev) => {
      let next = prev;

      try {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (userTimeZone && userTimeZone !== next.timeZone) {
          next = { ...next, timeZone: userTimeZone };
        }
      } catch {
        // Ignore if not available
      }

      if (!next.scheduledTime) {
        const nowPlusTen = new Date(Date.now() + 10 * 60 * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const localStr = `${nowPlusTen.getFullYear()}-${pad(nowPlusTen.getMonth() + 1)}-${pad(
          nowPlusTen.getDate()
        )}T${pad(nowPlusTen.getHours())}:${pad(nowPlusTen.getMinutes())}`;
        next = { ...next, scheduledTime: localStr };
      }

      return next;
    });
  }, []);

  useEffect(() => {
    void refreshDraftState();
  }, [refreshDraftState]);

  useEffect(() => {
    setDraftOrderMemberIds((current) => {
      const activeIds = new Set(members.map((member) => member.id));
      const retained = current.filter((memberId) => activeIds.has(memberId));
      const missing = members
        .map((member) => member.id)
        .filter((memberId) => !retained.includes(memberId));
      return [...retained, ...missing];
    });
    setDraftOrderRandomized(false);
  }, [members]);

  const shuffleMembers = (orderedMembers: LeagueMember[]) => {
    const shuffled = [...orderedMembers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const randomizeDraftOrder = () => {
    setDraftOrderMemberIds((current) =>
      shuffleMembers(
        current
          .map((memberId) => members.find((member) => member.id === memberId))
          .filter((member): member is LeagueMember => Boolean(member))
      ).map((member) => member.id)
    );
    setDraftOrderRandomized(true);
    setDraftSettings((prev) => ({ ...prev, pickOrder: 'random' }));
  };

  const moveDraftOrderMember = (memberId: string, direction: -1 | 1) => {
    setDraftSettings((prev) => ({ ...prev, pickOrder: 'manual' }));
    setDraftOrderRandomized(false);
    setDraftOrderMemberIds((current) => {
      const fromIndex = current.indexOf(memberId);
      const toIndex = fromIndex + direction;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      return next;
    });
  };

  const updatePositionLimit = (key: PositionLimitKey, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setDraftSettings((prev) => ({
      ...prev,
      positionLimits: normalizeDraftPositionLimits({
        ...prev.positionLimits,
        [key]: Number.isFinite(parsed) ? parsed : DEFAULT_DRAFT_POSITION_LIMITS[key],
      }),
    }));
  };

  const updateAutoPickRules = (next: Partial<DraftAutoPickRules>) => {
    setDraftSettings((prev) => ({
      ...prev,
      autoPickRules: normalizeDraftAutoPickRules({ ...prev.autoPickRules, ...next }),
    }));
  };

  const createDraft = async () => {
    if (!canCreateDraft) return;

    setSavingDraft(true);
    setError(null);

    try {
      // Client-side validation to avoid server rejection due to clock skew/timezone issues
      const selected = new Date(draftSettings.scheduledTime);
      if (Number.isNaN(selected.getTime())) {
        setError('Please choose a valid draft start time.');
        setSavingDraft(false);
        return;
      }
      if (selected.getTime() <= Date.now()) {
        setError('Scheduled time must be in the future.');
        setSavingDraft(false);
        return;
      }

      // Step 1: Create the draft with league synchronization
      // Build participants; ensure current user is included for test leagues

      let orderedMembers =
        draftOrderMembers.length === members.length ? draftOrderMembers : members;
      if (draftSettings.pickOrder === 'random' && !draftOrderRandomized) {
        orderedMembers = shuffleMembers(orderedMembers);
      }

      let participants: DraftParticipant[] = orderedMembers.map((member, index) => ({
        userId: member.userId,
        memberId: member.id,
        displayName: member.teamName || `Team ${index + 1}`,
        draftOrder: index + 1,
        isOwner: member.userId === league.ownerId,
      }));

      if (league.id === 'test-league-id' && currentUserId) {
        const alreadyIncluded = participants.some((p) => p.userId === currentUserId);
        if (!alreadyIncluded) {
          // Replace the last bot with the current user
          const lastIndex = participants.length - 1;
          const replacement = {
            userId: currentUserId,
            memberId: 'self',
            displayName: 'Your Team',
            draftOrder: participants[lastIndex]?.draftOrder || participants.length,
            isOwner: true,
          };
          if (lastIndex >= 0) participants[lastIndex] = replacement;
          else participants.push(replacement);
        }
        // Ensure only the current user is marked owner in test mode
        participants = participants.map((p) => ({ ...p, isOwner: p.userId === currentUserId }));
      }

      const draftPayloadBase = {
        name: `${league.name} Draft`,
        leagueSize: members.length,
        draftType: draftSettings.draftType,
        timePerPick: draftSettings.timePerPick,
        scheduledTime: draftSettings.scheduledTime,
        timeZone: draftSettings.timeZone,
        enableReminders: draftSettings.enableReminders,
        pickOrder: draftSettings.pickOrder,
        positionLimits: draftSettings.positionLimits,
        autoPickRules: draftSettings.autoPickRules,
        rosterSize: getRosterSizeFromPositionLimits(draftSettings.positionLimits),
        benchSize: getBenchSizeFromPositionLimits(draftSettings.positionLimits),
        // Sync league data
        leagueData: {
          name: league.name,
          maxTeams: league.maxTeams,
          categories: league.categories,
          ownerId: league.id === 'test-league-id' && currentUserId ? currentUserId : league.ownerId,
        },
        // Sync member data
        participants,
      } as const;

      const draftPayload =
        league.id === 'test-league-id'
          ? { ...draftPayloadBase }
          : { ...draftPayloadBase, leagueId: league.id };

      const response = await fetchApi('drafts', {
        method: 'POST',
        body: JSON.stringify(draftPayload),
      });

      if (response.success) {
        const createdDraft = response.data as DraftResponseShape;
        const draftLinkedToLeague =
          league.id === 'test-league-id' ||
          createdDraft.leagueId === league.id ||
          createdDraft.league?.id === league.id;

        if (!draftLinkedToLeague) {
          throw new Error('Draft was created without the expected league link');
        }

        setExistingDraft(toExistingDraft(createdDraft));
        await refreshDraftState();

        setShowDraftSettings(false);

        const draftId = createdDraft.id;
        if (onDraftCreated) {
          onDraftCreated(draftId);
        } else {
          // Navigate to draft room by default
          router.push(`/drafts/${draftId}`);
        }
      } else {
        throw new Error(response.error || 'Failed to create draft');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (isConnectivityError(error)) {
          setError(getConnectivityErrorMessage());
        } else {
          setError(error.message);
        }
      } else {
        setError('Failed to create draft');
      }
      console.error('Draft creation error:', error);
    } finally {
      setSavingDraft(false);
    }
  };

  const joinDraftRoom = () => {
    if (existingDraft) {
      if (onJoinDraftRoom) {
        onJoinDraftRoom(existingDraft.id);
      } else {
        router.push(`/drafts/${existingDraft.id}`);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      SCHEDULED: 'bg-primary/10 text-primary',
      LOBBY: 'bg-muted text-muted-foreground',
      COUNTDOWN: 'bg-primary/10 text-primary',
      LIVE: 'bg-primary text-primary-foreground',
      PAUSED: 'bg-muted text-muted-foreground',
      COMPLETED: 'bg-muted text-muted-foreground',
    };

    return (
      <span
        className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[status as keyof typeof statusColors] || 'bg-muted text-muted-foreground'}`}
      >
        {status}
      </span>
    );
  };

  const formatDateTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleString('en-AU', {
      timeZone: draftSettings.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <PlayIcon className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold text-foreground">Draft Management</h2>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 flex items-center space-x-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
          <ExclamationTriangleIcon className="h-5 w-5 text-destructive" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {/* Existing Draft Display */}
      {existingDraft && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-lg border border-border bg-muted/50 p-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-2 flex items-center space-x-3">
                <CheckCircleIcon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Draft Created</h3>
                {getStatusBadge(existingDraft.status)}
              </div>
              <p className="mb-1 text-sm text-muted-foreground">
                Draft ID: <span className="font-mono text-xs">{existingDraft.id}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Scheduled: {formatDateTime(existingDraft.startAt)}
              </p>
            </div>
            <button
              onClick={joinDraftRoom}
              className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PlayIcon className="h-4 w-4" />
              <span>Join Draft Room</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Draft Creation Section */}
      {!existingDraft && (
        <div className="space-y-4">
          {/* Prerequisites Check */}
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <UsersIcon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                League Members: {members.length}/{league.maxTeams}
              </span>
              {hasEnoughMembers ? (
                <CheckCircleIcon className="h-5 w-5 text-primary" />
              ) : (
                <span className="text-xs text-destructive">Need at least 4 members</span>
              )}
            </div>

            <div className="flex items-center space-x-3">
              <CogIcon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Commissioner Access</span>
              {isCommissioner ? (
                <CheckCircleIcon className="h-5 w-5 text-primary" />
              ) : (
                <span className="text-xs text-destructive">Commissioner only</span>
              )}
            </div>
          </div>

          {/* Create Draft Button */}
          {canCreateDraft && (
            <div className="border-t border-border pt-4">
              <button
                onClick={() => setShowDraftSettings(true)}
                className="flex w-full items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarIcon className="h-5 w-5" />
                <span>Create Draft for League</span>
              </button>
            </div>
          )}

          {!canCreateDraft && (
            <div className="border-t border-border pt-4">
              <div className="rounded-lg bg-muted p-3 text-center">
                <span className="text-sm text-muted-foreground">
                  {!isCommissioner
                    ? 'Only a league commissioner can create a draft'
                    : !hasEnoughMembers
                      ? 'Need at least 4 members to create a draft'
                      : 'Draft requirements not met'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Draft Settings Modal */}
      {showDraftSettings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl"
          >
            <h3 className="mb-4 text-lg font-semibold text-foreground">Draft Settings</h3>

            <div className="space-y-4">
              {/* Scheduled Time */}
              <div>
                <label
                  htmlFor="scheduledTime"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Draft Start Time
                </label>
                <input
                  id="scheduledTime"
                  type="datetime-local"
                  value={draftSettings.scheduledTime}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({ ...prev, scheduledTime: e.target.value }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)} // At least 5 minutes from now
                />
              </div>

              {/* Draft Type */}
              <div>
                <label
                  htmlFor="draftType"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Draft Type
                </label>
                <select
                  id="draftType"
                  value={draftSettings.draftType}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      draftType: e.target.value as 'snake' | 'linear',
                    }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="snake">Snake Draft</option>
                  <option value="linear">Linear Draft</option>
                </select>
              </div>

              {/* Time Per Pick */}
              <div>
                <label
                  htmlFor="timePerPick"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Time Per Pick (seconds)
                </label>
                <select
                  id="timePerPick"
                  value={draftSettings.timePerPick}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({ ...prev, timePerPick: parseInt(e.target.value) }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {TIME_PER_PICK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="pickOrder" className="block text-sm font-medium text-foreground">
                    Draft Order
                  </label>
                  <button
                    type="button"
                    onClick={randomizeDraftOrder}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    Randomize
                  </button>
                </div>
                <select
                  id="pickOrder"
                  value={draftSettings.pickOrder}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      pickOrder: e.target.value as DraftPickOrderMode,
                    }))
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="random">Randomized order</option>
                  <option value="manual">Manual order</option>
                </select>
                <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-border">
                  {draftOrderMembers.map((member, index) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {index + 1}. {member.teamName}
                        </p>
                        <p className="text-xs text-muted-foreground">{member.role}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveDraftOrderMember(member.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${member.teamName} up in draft order`}
                          className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                        >
                          <ArrowUpIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDraftOrderMember(member.id, 1)}
                          disabled={index === draftOrderMembers.length - 1}
                          aria-label={`Move ${member.teamName} down in draft order`}
                          className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                        >
                          <ArrowDownIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 block text-sm font-medium text-foreground">Position Limits</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {POSITION_LIMIT_KEYS.map((key) => (
                    <div key={key}>
                      <label
                        htmlFor={`position-${key}`}
                        className="block text-xs text-muted-foreground"
                      >
                        {key}
                      </label>
                      <input
                        id={`position-${key}`}
                        type="number"
                        min={0}
                        max={key === 'BENCH' ? 20 : 30}
                        value={draftSettings.positionLimits[key]}
                        onChange={(e) => updatePositionLimit(key, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoPickEnabled"
                    checked={draftSettings.autoPickRules.enabled}
                    onChange={(e) => updateAutoPickRules({ enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                  />
                  <label htmlFor="autoPickEnabled" className="ml-2 text-sm text-foreground">
                    Auto-pick when clock expires
                  </label>
                </div>
                <label
                  htmlFor="autoPickStrategy"
                  className="mt-3 block text-sm font-medium text-foreground"
                >
                  Auto-pick Priority
                </label>
                <select
                  id="autoPickStrategy"
                  value={draftSettings.autoPickRules.strategy}
                  onChange={(e) =>
                    updateAutoPickRules({
                      strategy: e.target.value as DraftAutoPickRules['strategy'],
                    })
                  }
                  disabled={!draftSettings.autoPickRules.enabled}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:bg-muted disabled:text-muted-foreground"
                >
                  <option value="queue-first">Queue first, then best available</option>
                  <option value="best-available">Best available</option>
                  <option value="fill-positions">Fill position needs</option>
                </select>
              </div>

              {/* Enable Reminders */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="reminders"
                  checked={draftSettings.enableReminders}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({ ...prev, enableReminders: e.target.checked }))
                  }
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                />
                <label htmlFor="reminders" className="ml-2 text-sm text-foreground">
                  Send draft reminders to league members
                </label>
              </div>
            </div>

            <div className="mt-6 flex space-x-3">
              <button
                onClick={() => setShowDraftSettings(false)}
                disabled={savingDraft}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createDraft}
                disabled={savingDraft || !draftSettings.scheduledTime}
                className="flex flex-1 items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingDraft ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-4 w-4" />
                    <span>Create Draft</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
