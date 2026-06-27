'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  PlayIcon,
  CalendarIcon,
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

const DRAFT_START_OFFSET_MS = 10 * 60 * 1000;
const MINIMUM_DRAFT_START_OFFSET_MS = 5 * 60 * 1000;

const DRAFT_STATUSES = new Set(['SCHEDULED', 'LOBBY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'COMPLETED']);

function toDateTimeLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function getMinimumDraftStartDate(): Date {
  return new Date(Date.now() + MINIMUM_DRAFT_START_OFFSET_MS);
}

function getDraftStartDatePart(value: string): string {
  return value.split('T')[0] ?? '';
}

function getDraftStartTimePart(value: string): string {
  return value.split('T')[1]?.slice(0, 5) ?? '';
}

function toScheduledTimeValue(datePart: string, timePart: string): string {
  if (!datePart || !timePart) return '';
  return `${datePart}T${timePart}`;
}

function getTonightDraftStartDate(): Date {
  const candidate = new Date();
  candidate.setHours(20, 0, 0, 0);

  const minimum = getMinimumDraftStartDate();
  if (candidate.getTime() <= minimum.getTime()) {
    return minimum;
  }

  return candidate;
}

function getTomorrowDraftStartDate(): Date {
  const candidate = new Date();
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(19, 0, 0, 0);
  return candidate;
}

function formatDraftStartDateTime(value: string): string {
  const date = new Date(value);

  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDraftStartSummary(value: string, timeZone: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return 'Choose a draft start time.';
  }

  return `Draft starts ${formatDraftStartDateTime(value)} (${timeZone})`;
}

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

function shuffleMembers(orderedMembers: LeagueMember[]): LeagueMember[] {
  const shuffled = [...orderedMembers];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function validateDraftScheduledTime(scheduledTime: string): string | null {
  const selected = new Date(scheduledTime);

  if (Number.isNaN(selected.getTime())) {
    return 'Please choose a valid draft start time.';
  }

  if (selected.getTime() <= Date.now()) {
    return 'Scheduled time must be in the future.';
  }

  return null;
}

function getOrderedDraftMembers(input: {
  members: LeagueMember[];
  draftOrderMembers: LeagueMember[];
  draftSettings: DraftSettings;
  draftOrderRandomized: boolean;
}): LeagueMember[] {
  const orderedMembers =
    input.draftOrderMembers.length === input.members.length ? input.draftOrderMembers : input.members;

  if (input.draftSettings.pickOrder === 'random' && !input.draftOrderRandomized) {
    return shuffleMembers(orderedMembers);
  }

  return orderedMembers;
}

function buildDraftParticipants(input: {
  orderedMembers: LeagueMember[];
  league: League;
  currentUserId?: string;
}): DraftParticipant[] {
  let participants = input.orderedMembers.map((member, index) => ({
    userId: member.userId,
    memberId: member.id,
    displayName: member.teamName || `Team ${index + 1}`,
    draftOrder: index + 1,
    isOwner: member.userId === input.league.ownerId,
  }));

  if (input.league.id !== 'test-league-id' || !input.currentUserId) {
    return participants;
  }

  const alreadyIncluded = participants.some((participant) => participant.userId === input.currentUserId);
  if (!alreadyIncluded) {
    const lastIndex = participants.length - 1;
    const replacement = {
      userId: input.currentUserId,
      memberId: 'self',
      displayName: 'Your Team',
      draftOrder: participants[lastIndex]?.draftOrder || participants.length,
      isOwner: true,
    };

    if (lastIndex >= 0) participants[lastIndex] = replacement;
    else participants.push(replacement);
  }

  return participants.map((participant) => ({
    ...participant,
    isOwner: participant.userId === input.currentUserId,
  }));
}

function buildDraftCreatePayload(input: {
  league: League;
  members: LeagueMember[];
  draftSettings: DraftSettings;
  participants: DraftParticipant[];
  currentUserId?: string;
}) {
  const draftPayloadBase = {
    name: `${input.league.name} Draft`,
    leagueSize: input.members.length,
    draftType: input.draftSettings.draftType,
    timePerPick: input.draftSettings.timePerPick,
    scheduledTime: input.draftSettings.scheduledTime,
    timeZone: input.draftSettings.timeZone,
    enableReminders: input.draftSettings.enableReminders,
    pickOrder: input.draftSettings.pickOrder,
    positionLimits: input.draftSettings.positionLimits,
    autoPickRules: input.draftSettings.autoPickRules,
    rosterSize: getRosterSizeFromPositionLimits(input.draftSettings.positionLimits),
    benchSize: getBenchSizeFromPositionLimits(input.draftSettings.positionLimits),
    leagueData: {
      name: input.league.name,
      maxTeams: input.league.maxTeams,
      categories: input.league.categories,
      ownerId:
        input.league.id === 'test-league-id' && input.currentUserId
          ? input.currentUserId
          : input.league.ownerId,
    },
    participants: input.participants,
  } as const;

  return input.league.id === 'test-league-id'
    ? { ...draftPayloadBase }
    : { ...draftPayloadBase, leagueId: input.league.id };
}

function isDraftLinkedToLeague(league: League, createdDraft: DraftResponseShape): boolean {
  return (
    league.id === 'test-league-id' ||
    createdDraft.leagueId === league.id ||
    createdDraft.league?.id === league.id
  );
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
        next = {
          ...next,
          scheduledTime: toDateTimeLocalInputValue(new Date(Date.now() + DRAFT_START_OFFSET_MS)),
        };
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

  const updateScheduledDate = (datePart: string) => {
    setDraftSettings((prev) => ({
      ...prev,
      scheduledTime: toScheduledTimeValue(datePart, getDraftStartTimePart(prev.scheduledTime)),
    }));
  };

  const updateScheduledClockTime = (timePart: string) => {
    setDraftSettings((prev) => ({
      ...prev,
      scheduledTime: toScheduledTimeValue(getDraftStartDatePart(prev.scheduledTime), timePart),
    }));
  };

  const applyScheduledTimePreset = (date: Date) => {
    setDraftSettings((prev) => ({
      ...prev,
      scheduledTime: toDateTimeLocalInputValue(date),
    }));
  };

	  const createDraft = async () => {
	    if (!canCreateDraft) return;

	    setSavingDraft(true);
	    setError(null);

	    try {
	      const validationError = validateDraftScheduledTime(draftSettings.scheduledTime);
	      if (validationError) {
	        setError(validationError);
	        return;
	      }

	      const orderedMembers = getOrderedDraftMembers({
	        members,
	        draftOrderMembers,
	        draftSettings,
	        draftOrderRandomized,
	      });
	      const participants = buildDraftParticipants({ orderedMembers, league, currentUserId });
	      const draftPayload = buildDraftCreatePayload({
	        league,
	        members,
	        draftSettings,
	        participants,
	        currentUserId,
	      });

	      const response = await fetchApi('drafts', {
	        method: 'POST',
	        body: JSON.stringify(draftPayload),
	      });

	      if (response.success) {
	        const createdDraft = response.data as DraftResponseShape;

	        if (!isDraftLinkedToLeague(league, createdDraft)) {
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

  const minimumDraftStartValue = toDateTimeLocalInputValue(getMinimumDraftStartDate());
  const scheduledDatePart = getDraftStartDatePart(draftSettings.scheduledTime);
  const scheduledTimePart = getDraftStartTimePart(draftSettings.scheduledTime);
  const draftStartSummary = formatDraftStartSummary(
    draftSettings.scheduledTime,
    draftSettings.timeZone
  );
  const draftStartPresets = [
    {
      label: 'In 10 min',
      ariaLabel: 'Start in 10 minutes',
      date: new Date(Date.now() + DRAFT_START_OFFSET_MS),
    },
    {
      label: 'Tonight',
      ariaLabel: 'Start tonight',
      date: getTonightDraftStartDate(),
    },
    {
      label: 'Tomorrow',
      ariaLabel: 'Start tomorrow',
      date: getTomorrowDraftStartDate(),
    },
  ];
  const rosterSize = getRosterSizeFromPositionLimits(draftSettings.positionLimits);
  const benchSize = getBenchSizeFromPositionLimits(draftSettings.positionLimits);
  const totalDraftPicks = members.length * rosterSize;
  const readinessItems = [
    {
      label: 'League members',
      detail: `${members.length}/${league.maxTeams} teams joined`,
      complete: hasEnoughMembers,
      incompleteLabel: 'Need at least 4 teams',
    },
    {
      label: 'Commissioner access',
      detail: isCommissioner ? 'You can configure and launch the draft' : 'Owner or manager only',
      complete: isCommissioner,
      incompleteLabel: 'Commissioner only',
    },
    {
      label: 'Roster shape',
      detail: `${rosterSize} roster spots per team, ${benchSize} bench`,
      complete: true,
      incompleteLabel: '',
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <div className="border-b border-border p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <PlayIcon className="h-4 w-4 text-primary" />
              Draft Management
            </div>
            <h2 className="text-2xl font-semibold text-foreground">
              Prepare the league draft room
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Set the start time, draft order, roster limits, and auto-pick behaviour before the
              room opens to league members.
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-lg border border-border bg-background text-center sm:min-w-80">
            <div className="border-r border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Teams</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{members.length}</p>
            </div>
            <div className="border-r border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Rounds</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{rosterSize}</p>
            </div>
            <div className="p-3">
              <p className="text-xs font-medium text-muted-foreground">Picks</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{totalDraftPicks}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-6 flex items-center space-x-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
          <ExclamationTriangleIcon className="h-5 w-5 text-destructive" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {/* Existing Draft Display */}
      {existingDraft && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="m-6 rounded-lg border border-border bg-muted/50 p-4"
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
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Prerequisites Check */}
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {readinessItems.map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                    {item.complete ? (
                      <CheckCircleIcon className="h-5 w-5 shrink-0 text-primary" />
                    ) : (
                      <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-destructive" />
                    )}
                  </div>
                  {!item.complete && (
                    <p className="mt-3 text-xs font-medium text-destructive">
                      {item.incompleteLabel}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-2">
                <CogIcon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">Draft setup preview</h3>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Default format</p>
                  <p className="font-medium text-foreground">Snake draft</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pick clock</p>
                  <p className="font-medium text-foreground">2 minutes per pick</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Auto-pick</p>
                  <p className="font-medium text-foreground">Queue first, then best available</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Draft order</p>
                  <p className="font-medium text-foreground">Randomized unless changed</p>
                </div>
              </div>
            </div>
          </div>

          <aside className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm font-semibold text-foreground">Next step</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review the schedule and commissioner settings, then create the draft room for league
              members.
            </p>

            {/* Create Draft Button */}
            {canCreateDraft && (
              <button
                onClick={() => setShowDraftSettings(true)}
                className="mt-4 flex w-full items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CalendarIcon className="h-5 w-5" />
                <span>Prepare draft settings</span>
              </button>
            )}

            {!canCreateDraft && (
              <div className="mt-4 rounded-lg border border-border bg-background p-3 text-center">
                <span className="text-sm text-muted-foreground">
                  {!isCommissioner
                    ? 'Only a league commissioner can create a draft'
                    : !hasEnoughMembers
                      ? 'Need at least 4 members to create a draft'
                      : 'Draft requirements not met'}
                </span>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Draft Settings Modal */}
      {showDraftSettings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl"
          >
            <div className="border-b border-border p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Draft setup
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-foreground">Draft Settings</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Configure the launch time, order, roster shape, and automation before the draft
                    room opens.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
                  <p className="font-medium text-foreground">{members.length} teams</p>
                  <p className="text-muted-foreground">{totalDraftPicks} total picks</p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              {/* Scheduled Time */}
              <section className="rounded-lg border border-border bg-background p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">Draft Start Time</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{draftStartSummary}</p>
                  </div>
                  <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    Earliest {formatDraftStartDateTime(minimumDraftStartValue)}
                  </p>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label
                    htmlFor="scheduledDate"
                    className="flex flex-col gap-1 text-sm font-medium text-foreground"
                  >
                    Draft date
                    <input
                      id="scheduledDate"
                      type="date"
                      value={scheduledDatePart}
                      onChange={(e) => updateScheduledDate(e.target.value)}
                      className="h-11 rounded-lg border border-input bg-card px-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                      min={getDraftStartDatePart(minimumDraftStartValue)}
                    />
                  </label>

                  <label
                    htmlFor="scheduledClockTime"
                    className="flex flex-col gap-1 text-sm font-medium text-foreground"
                  >
                    Draft time
                    <input
                      id="scheduledClockTime"
                      type="time"
                      value={scheduledTimePart}
                      onChange={(e) => updateScheduledClockTime(e.target.value)}
                      className="h-11 rounded-lg border border-input bg-card px-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {draftStartPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      aria-label={preset.ariaLabel}
                      onClick={() => applyScheduledTimePreset(preset.date)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-background p-5">
                <div className="mb-4">
                  <h4 className="text-base font-semibold text-foreground">Format and Clock</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Choose the draft style and how long each team has on the clock.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
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
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
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
                      Time Per Pick
                    </label>
                    <select
                      id="timePerPick"
                      value={draftSettings.timePerPick}
                      onChange={(e) =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          timePerPick: parseInt(e.target.value),
                        }))
                      }
                      className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {TIME_PER_PICK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-background p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">Draft Order</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Randomize the order or fine-tune the queue before creating the room.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={randomizeDraftOrder}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    Randomize
                  </button>
                </div>
                <label
                  htmlFor="pickOrder"
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  Order mode
                </label>
                <select
                  id="pickOrder"
                  value={draftSettings.pickOrder}
                  onChange={(e) =>
                    setDraftSettings((prev) => ({
                      ...prev,
                      pickOrder: e.target.value as DraftPickOrderMode,
                    }))
                  }
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="random">Randomized order</option>
                  <option value="manual">Manual order</option>
                </select>
                {draftOrderRandomized && (
                  <p className="mt-2 text-xs font-medium text-primary">Draft order randomized.</p>
                )}
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
                  {draftOrderMembers.map((member, index) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 border-b border-border bg-card px-3 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {member.teamName}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveDraftOrderMember(member.id, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${member.teamName} up in draft order`}
                          className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                        >
                          <ArrowUpIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDraftOrderMember(member.id, 1)}
                          disabled={index === draftOrderMembers.length - 1}
                          aria-label={`Move ${member.teamName} down in draft order`}
                          className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                        >
                          <ArrowDownIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-background p-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">Position Limits</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Set how many players each team drafts by line.
                    </p>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {rosterSize} spots, {benchSize} bench
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {POSITION_LIMIT_KEYS.map((key) => (
                    <div key={key} className="rounded-lg border border-border bg-card p-3">
                      <label
                        htmlFor={`position-${key}`}
                        className="block text-xs font-semibold uppercase text-muted-foreground"
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
              </section>

              <section className="rounded-lg border border-border bg-background p-5">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="autoPickEnabled"
                        checked={draftSettings.autoPickRules.enabled}
                        onChange={(e) => updateAutoPickRules({ enabled: e.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-ring"
                      />
                      <div>
                        <label
                          htmlFor="autoPickEnabled"
                          className="text-sm font-medium text-foreground"
                        >
                          Auto-pick when clock expires
                        </label>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Keeps the draft moving when a manager misses their pick.
                        </p>
                      </div>
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
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="reminders"
                        checked={draftSettings.enableReminders}
                        onChange={(e) =>
                          setDraftSettings((prev) => ({
                            ...prev,
                            enableReminders: e.target.checked,
                          }))
                        }
                        className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-ring"
                      />
                      <div>
                        <label htmlFor="reminders" className="text-sm font-medium text-foreground">
                          Send draft reminders to league members
                        </label>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Notify managers before the scheduled draft start.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-3 border-t border-border bg-card p-6 sm:flex-row">
              <button
                onClick={() => setShowDraftSettings(false)}
                disabled={savingDraft}
                className="flex-1 rounded-lg border border-border px-4 py-3 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createDraft}
                disabled={savingDraft || !draftSettings.scheduledTime}
                className="flex flex-1 items-center justify-center space-x-2 rounded-lg bg-primary px-4 py-3 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
