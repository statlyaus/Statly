'use client';

import React, { useState, useCallback, useMemo } from 'react';

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Plus, Trash2, Search, Sparkles } from 'lucide-react';

import { useAlert, AlertContainer } from '@/components/ui';
import type { DraftPlayer } from '@/types/draft';

interface DraftQueueProps {
  queue: string[];
  availablePlayers: DraftPlayer[];
  onQueueUpdate: (queue: string[]) => void;
  isLoading: boolean;
  confirm?: (options: {
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    variant?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    cancelText?: string;
  }) => void;
}

export default function DraftQueue({
  queue,
  availablePlayers,
  onQueueUpdate,
  isLoading,
  confirm,
}: DraftQueueProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { success, error, alerts, removeAlert } = useAlert();
  const controlsDisabled = isLoading;

  // Get player details for queue items
  const queuePlayers = queue
    .map((id) => availablePlayers.find((p) => p.id === id))
    .filter(Boolean) as DraftPlayer[];

  const queuePlayerIds = useMemo(() => new Set(queue), [queue]);

  // Handle drag and drop reordering
  const handleDragEnd = useCallback(
    async (result: any) => {
      if (!result.destination) return;

      const items = Array.from(queue);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);

      try {
        await Promise.resolve(onQueueUpdate(items));
      } catch (e) {
        error('Failed to update queue', e instanceof Error ? e.message : String(e));
      }
    },
    [queue, onQueueUpdate, error]
  );

  // Remove player from queue
  const handleRemovePlayer = useCallback(
    async (playerId: string) => {
      const newQueue = queue.filter((id) => id !== playerId);
      try {
        await Promise.resolve(onQueueUpdate(newQueue));
      } catch (e) {
        error('Failed to update queue', e instanceof Error ? e.message : String(e));
      }
    },
    [queue, onQueueUpdate, error]
  );

  // Clear entire queue
  const handleClearQueue = useCallback(() => {
    if (typeof confirm === 'function') {
      confirm({
        title: 'Clear Queue',
        message: 'Are you sure you want to clear your entire queue? This cannot be undone.',
        variant: 'warning',
        confirmText: 'Clear',
        cancelText: 'Cancel',
        onConfirm: async () => {
          try {
            await Promise.resolve(onQueueUpdate([]));
            success('Queue cleared');
          } catch (e) {
            error('Failed to clear queue', e instanceof Error ? e.message : String(e));
          }
        },
      });
    } else {
      // Fallback to blocking confirm if no provider
      if (
        window.confirm('Are you sure you want to clear your entire queue? This cannot be undone.')
      ) {
        try {
          onQueueUpdate([]);
          success('Queue cleared');
        } catch (e) {
          error('Failed to clear queue', e instanceof Error ? e.message : String(e));
        }
      }
    }
  }, [confirm, onQueueUpdate, success, error]);

  // Add player to queue
  const handleAddToQueue = useCallback(
    async (player: DraftPlayer) => {
      if (queue.includes(player.id) || controlsDisabled) return;

      const newQueue = [...queue, player.id];
      try {
        await Promise.resolve(onQueueUpdate(newQueue));
      } catch (e) {
        error('Failed to update queue', e instanceof Error ? e.message : String(e));
      }
    },
    [queue, onQueueUpdate, controlsDisabled, error]
  );

  const availableForQueue = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return availablePlayers
      .filter((player) => !queuePlayerIds.has(player.id) && player.isAvailable)
      .filter((player) => {
        if (!query) return true;
        return (
          player.name.toLowerCase().includes(query) ||
          player.club.toLowerCase().includes(query) ||
          player.position.toLowerCase().includes(query)
        );
      })
      .slice(0, 40);
  }, [availablePlayers, queuePlayerIds, searchQuery]);

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" aria-atomic="true">
        <AlertContainer alerts={alerts} onRemove={removeAlert} position="top-right" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Draft Strategy
                </div>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">Your Queue</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Reorder by drag and drop. The top player becomes your next preferred auto-pick.
                </p>
              </div>
              <button
                onClick={handleClearQueue}
                disabled={queue.length === 0 || controlsDisabled}
                className="inline-flex items-center rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {controlsDisabled ? 'Saving…' : 'Clear'}
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <span className="rounded-full bg-slate-950 px-3 py-1 font-medium text-white">
                {queue.length} queued
              </span>
              <span>{controlsDisabled ? 'Saving queue changes' : 'Drag rows to reprioritize'}</span>
            </div>
          </div>

          <div className="p-6">
            {queue.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
                  <Sparkles className="h-6 w-6 text-slate-500" />
                </div>
                <p className="text-lg font-semibold text-slate-950">Queue is empty</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Add players from the shortlist to build your fallback order before the draft goes
                  live.
                </p>
              </div>
            ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="draft-queue">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="space-y-3"
                    >
                      {queuePlayers.map((player, index) => (
                        <Draggable key={player.id} draggableId={player.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`rounded-2xl border p-4 transition-all ${
                                snapshot.isDragging
                                  ? 'border-blue-300 bg-blue-50 shadow-lg'
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-4">
                                <div
                                  {...provided.dragHandleProps}
                                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"
                                  aria-label={`Move ${player.name}`}
                                >
                                  <GripVertical className="h-4 w-4" />
                                </div>

                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                                  {index + 1}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="truncate text-sm font-semibold text-slate-950">
                                      {player.name}
                                    </h4>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                      {player.position}
                                    </span>
                                    {player.adp && (
                                      <span className="text-xs text-slate-500">
                                        ADP {player.adp}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-sm text-slate-500">{player.club}</div>
                                </div>

                                <button
                                  onClick={() => void handleRemovePlayer(player.id)}
                                  disabled={controlsDisabled}
                                  className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                                  aria-label={`Remove ${player.name} from queue`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}
          </div>
        </section>

        <aside className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Shortlist
                </div>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">Add to Queue</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {availableForQueue.length} shown
              </span>
            </div>

            <label className="mt-4 block">
              <span className="sr-only">Search players to add to queue</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by player, club, or position"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
                />
              </div>
            </label>
          </div>

          <div className="max-h-[720px] overflow-y-auto p-4">
            {availableForQueue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No available players match your current search.
              </div>
            ) : (
              <div className="space-y-3">
                {availableForQueue.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-950">
                          {player.name}
                        </h4>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {player.position}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {player.club}
                        {player.adp && <span className="ml-2">ADP {player.adp}</span>}
                      </div>
                    </div>

                    <button
                      onClick={() => void handleAddToQueue(player)}
                      disabled={controlsDisabled}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-2xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
