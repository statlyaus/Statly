'use client';

import React, { useState, useCallback } from 'react';

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

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
  const [isEditing, setIsEditing] = useState(false);
  const { success, error, alerts, removeAlert } = useAlert();

  // Get player details for queue items
  const queuePlayers = queue
    .map((id) => availablePlayers.find((p) => p.id === id))
    .filter(Boolean) as DraftPlayer[];

  // Handle drag and drop reordering
  const handleDragEnd = useCallback(
    (result: any) => {
      if (!result.destination) return;

      const items = Array.from(queue);
      const [reorderedItem] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reorderedItem);

      onQueueUpdate(items);
    },
    [queue, onQueueUpdate]
  );

  // Remove player from queue
  const handleRemovePlayer = useCallback(
    (playerId: string) => {
      const newQueue = queue.filter((id) => id !== playerId);
      onQueueUpdate(newQueue);
    },
    [queue, onQueueUpdate]
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
    (player: DraftPlayer) => {
      if (queue.includes(player.id)) return;

      const newQueue = [...queue, player.id];
      onQueueUpdate(newQueue);
    },
    [queue, onQueueUpdate]
  );

  // Filter available players not in queue
  const availableForQueue = availablePlayers.filter(
    (player) => !queue.includes(player.id) && player.isAvailable
  );

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" aria-atomic="true">
        <AlertContainer alerts={alerts} onRemove={removeAlert} position="top-right" />
      </div>
      {/* Queue Management */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Your Draft Queue</h3>
          <div className="flex space-x-2">
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              {isEditing ? 'Done Editing' : 'Edit Queue'}
            </button>
            <button
              onClick={handleClearQueue}
              disabled={queue.length === 0 || isLoading}
              className="px-3 py-2 text-sm font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear Queue
            </button>
          </div>
        </div>

        {/* Queue Items */}
        {queue.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-3">📋</div>
            <p>Your queue is empty</p>
            <p className="text-sm">Add players below to build your priority list</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="draft-queue">
              {(provided) => (
                <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                  {queuePlayers.map((player, index) => (
                    <Draggable
                      key={player.id}
                      draggableId={player.id}
                      index={index}
                      isDragDisabled={!isEditing}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`bg-gray-50 rounded-lg p-4 border-2 transition-all ${
                            snapshot.isDragging
                              ? 'border-blue-300 shadow-lg rotate-2'
                              : 'border-transparent hover:border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="text-lg font-bold text-gray-400 w-8">
                                #{index + 1}
                              </div>
                              <div>
                                <h4 className="font-semibold text-gray-900">{player.name}</h4>
                                <div className="flex items-center space-x-2 text-sm text-gray-500">
                                  <span className="px-2 py-1 bg-gray-200 rounded text-xs font-medium">
                                    {player.position}
                                  </span>
                                  <span>{player.club}</span>
                                  {player.adp && <span>• ADP: {player.adp}</span>}
                                </div>
                              </div>
                            </div>

                            {isEditing && (
                              <button
                                onClick={() => handleRemovePlayer(player.id)}
                                className="text-red-500 hover:text-red-700 transition-colors"
                                aria-label={`Remove ${player.name} from queue`}
                              >
                                <svg
                                  className="w-5 h-5"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                  />
                                </svg>
                              </button>
                            )}
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

      {/* Available Players to Add */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add to Queue</h3>

        {availableForQueue.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No available players to add to queue</p>
        ) : (
          <div className="grid gap-3 max-h-96 overflow-y-auto">
            {availableForQueue.slice(0, 50).map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div>
                  <h4 className="font-medium text-gray-900">{player.name}</h4>
                  <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <span className="px-2 py-1 bg-gray-200 rounded text-xs font-medium">
                      {player.position}
                    </span>
                    <span>{player.club}</span>
                    {player.adp && <span>• ADP: {player.adp}</span>}
                  </div>
                </div>

                <button
                  onClick={() => handleAddToQueue(player)}
                  disabled={isLoading}
                  className="px-3 py-1 text-sm font-medium text-blue-600 bg-blue-100 rounded-md hover:bg-blue-200 disabled:opacity-50 transition-colors"
                >
                  Add to Queue
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
