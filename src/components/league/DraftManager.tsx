'use client';

import { useState, useEffect } from 'react';

import { useRouter } from 'next/navigation';

import {
  PlayIcon,
  UsersIcon,
  CogIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

import { fetchApi } from '@/lib/api';
import type { DraftType as LeagueDraftType, League, LeagueMember } from '@/types/leagues';
import {
  isConnectivityError,
  getConnectivityErrorMessage,
  isExpectedTestLeague404,
} from '@/utils/errorHandling';

interface DraftManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
  // Note: onDraftCreated and onJoinDraftRoom props were removed on 2024-12-19
  // as part of migration to router-based navigation. No remaining usages found.
}

interface DraftSettings {
  scheduledTime: string;
  draftType: LeagueDraftType;
  timePerPick: number;
  timeZone: string;
  enableReminders: boolean;
}

interface ExistingDraft {
  id: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  startAt: string;
  createdAt: string;
}

export default function DraftManager({ league, members, currentUserId }: DraftManagerProps) {
  const router = useRouter();
  const [savingOrder, setSavingOrder] = useState(false);
  const [checkingDraftStatus, setCheckingDraftStatus] = useState(false);
  const [existingDraft, setExistingDraft] = useState<ExistingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);

  const [draftSettings, setDraftSettings] = useState<DraftSettings>({
    scheduledTime: '',
    draftType: 'snake',
    timePerPick: 120,
    timeZone: 'Australia/Melbourne',
    enableReminders: league.draftSettings?.enableReminders ?? true,
  });

  const effectiveOwnerId =
    league.id === 'test-league-id' && currentUserId ? currentUserId : league.ownerId;
  const currentUserRole = members.find((member) => member.userId === currentUserId)?.role;
  const canManageDraft = currentUserId === effectiveOwnerId || currentUserRole === 'commissioner';
  const hasEnoughMembers = members.length >= 4;

  const refreshDraftStatus = async () => {
    try {
      setCheckingDraftStatus(true);
      const [draftResponse, draftSettingsResponse] = await Promise.all([
        fetchApi(`leagues/${league.id}/draft`),
        fetchApi(`leagues/${league.id}/draft-settings`).catch(() => null),
      ]);

      if (draftResponse.success && draftResponse.data?.hasDraft) {
        setExistingDraft({
          id: draftResponse.data.draftId,
          status: draftResponse.data.status || 'SCHEDULED',
          startAt: draftResponse.data.startAt,
          createdAt: draftResponse.data.createdAt,
        });
      } else {
        setExistingDraft(null);
      }

      if (draftSettingsResponse?.success && draftSettingsResponse.data) {
        setDraftSettings((prev) => ({
          ...prev,
          scheduledTime: draftSettingsResponse.data.draftDate
            ? new Date(draftSettingsResponse.data.draftDate).toISOString().slice(0, 16)
            : prev.scheduledTime,
          draftType: draftSettingsResponse.data.draftType || prev.draftType,
          timePerPick: draftSettingsResponse.data.timePerPick || prev.timePerPick,
          enableReminders:
            typeof draftSettingsResponse.data.enableReminders === 'boolean'
              ? draftSettingsResponse.data.enableReminders
              : prev.enableReminders,
        }));
      }
    } catch (error) {
      if (error instanceof Error) {
        if (isConnectivityError(error)) {
          console.warn('Development server not running or API unreachable');
          setError(getConnectivityErrorMessage());
        } else if (isExpectedTestLeague404(error, league.id)) {
          console.debug('Test league draft check - 404 expected');
        } else {
          console.error('Error checking existing draft:', error);
          setError(`Failed to check draft status: ${error.message}`);
        }
      } else {
        console.error('Unknown error checking draft:', error);
        setError('An unexpected error occurred while checking draft status');
      }
    } finally {
      setCheckingDraftStatus(false);
    }
  };

  useEffect(() => {
    const orderedMembers = [...members].sort((left, right) => {
      const leftSlot =
        typeof left.draftSlot === 'number' ? left.draftSlot : Number.MAX_SAFE_INTEGER;
      const rightSlot =
        typeof right.draftSlot === 'number' ? right.draftSlot : Number.MAX_SAFE_INTEGER;

      if (leftSlot !== rightSlot) return leftSlot - rightSlot;
      return new Date(left.joinedAt).getTime() - new Date(right.joinedAt).getTime();
    });

    setDraftOrder(orderedMembers.map((member) => member.userId));
  }, [members]);

  // Initialize check on mount
  useEffect(() => {
    // Normalize timezone to the user's actual system timezone to match server conversion
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (userTimeZone && userTimeZone !== draftSettings.timeZone) {
        setDraftSettings((prev) => ({ ...prev, timeZone: userTimeZone }));
      }
    } catch {
      // Ignore if not available
    }

    void refreshDraftStatus();
  }, [
    league.id,
    league.draftDate,
    league.draftSettings?.draftType,
    league.draftSettings?.timePerPick,
    league.draftSettings?.enableReminders,
  ]);

  const orderedMembers = draftOrder
    .map((userId) => members.find((member) => member.userId === userId))
    .filter((member): member is LeagueMember => Boolean(member));
  const hasSavedDraftOrder =
    orderedMembers.length > 0 &&
    orderedMembers.every((member, index) => {
      const draftSlot = typeof member.draftSlot === 'number' ? member.draftSlot : null;
      return draftSlot === index + 1;
    });
  const hasUnsavedDraftOrder =
    orderedMembers.length !== members.length ||
    orderedMembers.some((member, index) => member.userId !== draftOrder[index]);
  const hasDraftSchedule = Boolean(draftSettings.scheduledTime);
  const moveMember = (userId: string, direction: -1 | 1) => {
    setDraftOrder((current) => {
      const index = current.indexOf(userId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const randomizeDraftOrder = () => {
    setDraftOrder((current) => {
      const next = [...current];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  };

  const saveDraftOrder = async () => {
    if (!canManageDraft || savingOrder) return;

    try {
      setSavingOrder(true);
      setError(null);

      const response = await fetchApi(`leagues/${league.id}/members`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'reorderDraftSlots',
          orderedUserIds: draftOrder,
        }),
      });

      const provisioning = response?.data?.draftProvisioning;
      if (provisioning?.draft) {
        setExistingDraft({
          id: provisioning.draft.id,
          status: provisioning.draft.status,
          startAt: provisioning.draft.startAt,
          createdAt: provisioning.draft.createdAt,
        });
      } else {
        await refreshDraftStatus();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save draft order');
    } finally {
      setSavingOrder(false);
    }
  };

  const joinDraftRoom = () => {
    if (existingDraft) {
      router.push(`/drafts/${existingDraft.id}`);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      SCHEDULED: 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]',
      LOBBY: 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]',
      COUNTDOWN: 'bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]',
      LIVE: 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]',
      PAUSED: 'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]',
      COMPLETED: 'bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]',
    };

    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}`}
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
    <div className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <PlayIcon className="h-6 w-6 text-[color:var(--league-primary)]" />
          <h2 className="text-xl font-semibold text-[color:var(--league-text)]">
            Draft Management
          </h2>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 flex items-center space-x-2 rounded-2xl border border-[color:var(--league-danger-soft)] bg-[color:var(--league-danger-soft)] p-4">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
          <span className="text-[color:var(--league-danger)]">{error}</span>
        </div>
      )}

      {/* Existing Draft Display */}
      {existingDraft && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-[24px] border border-[color:var(--league-border)] bg-[linear-gradient(90deg,var(--league-success-soft),var(--league-surface))] p-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <CheckCircleIcon className="h-5 w-5 text-[color:var(--league-success)]" />
                <h3 className="font-semibold text-[color:var(--league-text)]">Draft Created</h3>
                {getStatusBadge(existingDraft.status)}
              </div>
              <p className="mb-1 text-sm text-[color:var(--league-text-muted)]">
                Draft ID: <span className="font-mono text-xs">{existingDraft.id}</span>
              </p>
              <p className="text-sm text-[color:var(--league-text-muted)]">
                Scheduled: {formatDateTime(existingDraft.startAt)}
              </p>
            </div>
            <button
              onClick={joinDraftRoom}
              className="flex items-center space-x-2 rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-white transition-colors hover:bg-[color:var(--league-primary-hover)]"
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
              <UsersIcon className="h-5 w-5 text-[color:var(--league-text-muted)]" />
              <span className="text-sm text-[color:var(--league-text-muted)]">
                League Members: {members.length}/{league.maxTeams}
              </span>
              {hasEnoughMembers ? (
                <CheckCircleIcon className="h-5 w-5 text-[color:var(--league-success)]" />
              ) : (
                <span className="text-xs text-[color:var(--league-danger)]">
                  Need at least 4 members
                </span>
              )}
            </div>

            <div className="flex items-center space-x-3">
              <CogIcon className="h-5 w-5 text-[color:var(--league-text-muted)]" />
              <span className="text-sm text-[color:var(--league-text-muted)]">
                Commissioner access
              </span>
              {canManageDraft ? (
                <CheckCircleIcon className="h-5 w-5 text-[color:var(--league-success)]" />
              ) : (
                <span className="text-xs text-[color:var(--league-danger)]">Commissioner only</span>
              )}
            </div>

            <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4 text-sm text-[color:var(--league-text-muted)]">
              Configure the draft date and pick clock from the league Settings tab. Use this Draft
              tab to save order changes and verify draft room status. Once schedule and order are
              both valid, the room is provisioned automatically.
            </div>
          </div>

          {canManageDraft && (
            <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[color:var(--league-text)]">
                    Draft order
                  </h3>
                  <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                    Reorder teams and save the slots here. The saved order becomes the draft board,
                    and valid schedule plus order will automatically create or update the draft
                    room.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={randomizeDraftOrder}
                    disabled={savingOrder}
                    className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-medium text-[color:var(--league-text)] transition hover:bg-white disabled:opacity-50"
                  >
                    Randomize
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveDraftOrder()}
                    disabled={savingOrder}
                    className="rounded-full bg-[color:var(--league-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[color:var(--league-primary-hover)] disabled:opacity-50"
                  >
                    {savingOrder ? 'Saving…' : 'Save Order'}
                  </button>
                </div>
              </div>

              <p className="mt-3 text-sm text-[color:var(--league-text-muted)]">
                {hasUnsavedDraftOrder
                  ? 'Draft order has local changes. Save it to update the scheduled draft room.'
                  : hasSavedDraftOrder
                    ? 'Draft order is saved and ready for automatic draft provisioning.'
                    : 'Set and save a draft order to complete draft setup.'}
              </p>

              <div className="mt-4 space-y-2">
                {orderedMembers.map((member, index) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--league-primary-soft)] text-sm font-semibold text-[color:var(--league-primary)]">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--league-text)]">
                          {member.teamName}
                        </p>
                        <p className="text-xs text-[color:var(--league-text-muted)]">
                          {member.role === 'owner'
                            ? 'League owner'
                            : member.role === 'commissioner'
                              ? 'League commissioner'
                              : 'League member'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => moveMember(member.userId, -1)}
                        disabled={index === 0 || savingOrder}
                        className="rounded-full border border-[color:var(--league-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] disabled:opacity-40"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMember(member.userId, 1)}
                        disabled={index === orderedMembers.length - 1 || savingOrder}
                        className="rounded-full border border-[color:var(--league-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] disabled:opacity-40"
                      >
                        Down
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManageDraft && (
            <div className="border-t border-[color:var(--league-border)] pt-4">
              <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4">
                <p className="text-sm text-[color:var(--league-text-muted)]">
                  {!hasEnoughMembers
                    ? 'Need at least 4 members before the draft room can be prepared.'
                    : !hasDraftSchedule
                      ? 'Set a draft date and pick clock in Settings to prepare the draft room automatically.'
                      : !hasSavedDraftOrder
                        ? 'Save a valid draft order here to finish preparing the draft room.'
                        : hasUnsavedDraftOrder
                          ? 'Save the latest draft order changes to update the draft room.'
                          : 'Draft prerequisites are satisfied. The room should already be prepared from the saved league setup.'}
                </p>
                <button
                  type="button"
                  onClick={() => void refreshDraftStatus()}
                  disabled={checkingDraftStatus}
                  className="mt-3 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2 text-sm font-medium text-[color:var(--league-text)] transition hover:bg-white disabled:opacity-50"
                >
                  {checkingDraftStatus ? 'Checking…' : 'Refresh Draft Status'}
                </button>
              </div>
            </div>
          )}

          {!canManageDraft && (
            <div className="border-t border-[color:var(--league-border)] pt-4">
              <div className="rounded-2xl bg-[color:var(--league-surface-muted)] p-3 text-center">
                <span className="text-sm text-[color:var(--league-text-muted)]">
                  Only the league owner or a commissioner can manage draft setup
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
