'use client';

import React, { useCallback, useState } from 'react';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { GripVertical, ListPlus, Pencil, Trash2, X } from 'lucide-react';
import type { DraftPlayer } from '@/types/draft';
import { cn } from '@/lib/utils';

interface DraftQueueProps {
  queue: string[];
  availablePlayers: DraftPlayer[];
  onQueueUpdate: (queue: string[]) => Promise<void>;
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
  const [isEditing, setIsEditing] = useState(false);
  const [isMutationPending, setIsMutationPending] = useState(false);
  const controlsDisabled = isLoading || isMutationPending;

  const queueEntries = queue.map((playerId) => ({
    playerId,
    player: availablePlayers.find((player) => player.id === playerId),
  }));

  const commitQueue = useCallback(
    async (nextQueue: string[]) => {
      if (controlsDisabled) return;

      setIsMutationPending(true);
      try {
        await onQueueUpdate(nextQueue);
      } catch {
        // The room-level mutation boundary owns recoverable feedback. Keep this local control
        // resilient when a caller rejects so fire-and-forget queue actions never leak a promise.
      } finally {
        setIsMutationPending(false);
      }
    },
    [controlsDisabled, onQueueUpdate]
  );

  const handleDragEnd = useCallback(
    (result: any) => {
      if (!result.destination) return;

      const items = Array.from(queue);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);

      void commitQueue(items);
    },
    [commitQueue, queue]
  );

  const handleRemovePlayer = useCallback(
    (playerId: string) => {
      void commitQueue(queue.filter((id) => id !== playerId));
    },
    [commitQueue, queue]
  );

  const handleClearQueue = useCallback(() => {
    if (typeof confirm === 'function') {
      confirm({
        title: 'Clear Queue',
        message: 'Are you sure you want to clear your entire queue? This cannot be undone.',
        variant: 'warning',
        confirmText: 'Clear',
        cancelText: 'Cancel',
        onConfirm: async () => {
          await commitQueue([]);
        },
      });
    } else if (
      window.confirm('Are you sure you want to clear your entire queue? This cannot be undone.')
    ) {
      void commitQueue([]);
    }
  }, [commitQueue, confirm]);

  const handleAddToQueue = useCallback(
    (player: DraftPlayer) => {
      if (queue.includes(player.id)) return;

      void commitQueue([...queue, player.id]);
    },
    [commitQueue, queue]
  );

  const availableForQueue = availablePlayers.filter(
    (player) => !queue.includes(player.id) && player.isAvailable
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <section
        className="rounded-md border border-border bg-background p-3"
        aria-label="Draft queue"
        aria-busy={controlsDisabled}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Draft Queue</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {controlsDisabled
                ? 'Saving queue…'
                : queueEntries.length === 0
                  ? 'Build your auto-pick priority list.'
                  : `${queueEntries.length} queued`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              disabled={controlsDisabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isEditing ? 'Finish editing draft queue' : 'Edit draft queue'}
              title={isEditing ? 'Done' : 'Edit'}
            >
              {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleClearQueue}
              disabled={queueEntries.length === 0 || controlsDisabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Clear draft queue"
              title="Clear"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {queueEntries.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-5 text-center">
            <ListPlus className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Your queue is empty</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add players below in the order you want them drafted.
            </p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="draft-queue">
              {(provided) => (
                <ol
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1"
                  aria-label="Queued players"
                >
                  {queueEntries.map(({ playerId, player }, index) => (
                    <Draggable
                      key={playerId}
                      draggableId={playerId}
                      index={index}
                      isDragDisabled={!isEditing || controlsDisabled}
                    >
                      {(provided, snapshot) => (
                        <li
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={cn(
                            'rounded-md border border-border bg-card px-3 py-2 text-card-foreground transition-colors',
                            snapshot.isDragging && 'border-primary shadow-lg',
                            isEditing && 'cursor-grab active:cursor-grabbing'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                              {index + 1}
                            </span>

                            {isEditing && (
                              <GripVertical
                                className="h-4 w-4 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}

                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-sm font-semibold text-foreground">
                                {player?.name ?? 'Queued player'}
                              </h3>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                {player ? (
                                  <>
                                    <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                                      {player.position}
                                    </span>
                                    <span className="truncate">{player.club}</span>
                                    {player.adp && (
                                      <span className="shrink-0">ADP {player.adp}</span>
                                    )}
                                  </>
                                ) : (
                                  <span>Player details loading</span>
                                )}
                              </div>
                            </div>

                            {isEditing && (
                              <button
                                type="button"
                                onClick={() => handleRemovePlayer(playerId)}
                                disabled={controlsDisabled}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`Remove ${player?.name ?? 'queued player'} from queue`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ol>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </section>

      <section
        className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-background p-3"
        aria-label="Available players for queue"
        aria-busy={controlsDisabled}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Add to Queue</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {availableForQueue.length} available players
          </p>
        </div>

        {availableForQueue.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
            No available players to add.
          </p>
        ) : (
          <ol className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {availableForQueue.slice(0, 50).map((player) => (
              <li
                key={player.id}
                className="rounded-md border border-border bg-card px-3 py-2 text-card-foreground"
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {player.name}
                    </h3>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                        {player.position}
                      </span>
                      <span className="truncate">{player.club}</span>
                      {player.adp && <span className="shrink-0">ADP {player.adp}</span>}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAddToQueue(player)}
                    disabled={controlsDisabled}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
