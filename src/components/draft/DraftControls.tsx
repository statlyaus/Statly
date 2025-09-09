'use client';

import { useState, useCallback, memo, useRef, useEffect } from 'react';

import { useConfirmation } from '@/components/ui';
import { useNotification } from '@/hooks/useNotification';
import type { DraftStatus } from '@/types/draft';

interface DraftControlsProps {
  draftId: string;
  draftStatus: DraftStatus;
  isLeagueOwner: boolean;
  onStatusChange?: () => void;
}

const DraftControls = memo(function DraftControls({
  draftId,
  draftStatus,
  isLeagueOwner,
  onStatusChange,
}: DraftControlsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { confirm, ConfirmationModal } = useConfirmation();
  const { showNotification } = useNotification();
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup AbortController on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handlePauseDraft = useCallback(() => {
    confirm({
      title: 'Pause Draft',
      message: 'Are you sure you want to pause the draft? This will stop all picks until resumed.',
      variant: 'warning',
      onConfirm: async () => {
        setIsLoading(true);
        try {
          // Create new AbortController for this request
          abortControllerRef.current = new AbortController();

          const response = await fetch(`/api/drafts/${draftId}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to pause draft';
            try {
              const error = await response.json();
              errorMessage = error.message || errorMessage;
            } catch {
              // Use status text if JSON parsing fails
              errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
          }

          showNotification('success', 'Draft paused successfully. Only you can resume it.');
          onStatusChange?.();
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return; // Request was aborted, don't show error
          }
          console.error('Error pausing draft:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        } finally {
          if (!abortControllerRef.current?.signal.aborted) {
            setIsLoading(false);
          }
          // Clear the controller reference after completion
          abortControllerRef.current = null;
        }
      },
    });
  }, [draftId, onStatusChange, confirm, showNotification]);

  const handleResumeDraft = useCallback(() => {
    confirm({
      title: 'Resume Draft',
      message:
        'Are you sure you want to resume the draft? Picks will continue from where they left off.',
      variant: 'info',
      onConfirm: async () => {
        setIsLoading(true);
        try {
          // Create new AbortController for this request
          abortControllerRef.current = new AbortController();

          const response = await fetch(`/api/drafts/${draftId}/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            let errorMessage = 'Failed to resume draft';
            try {
              const error = await response.json();
              errorMessage = error.message || errorMessage;
            } catch {
              // Use status text if JSON parsing fails
              errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
          }

          showNotification('success', 'Draft resumed successfully!');
          onStatusChange?.();
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return; // Request was aborted, don't show error
          }
          console.error('Error resuming draft:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          showNotification('error', `Failed to resume draft: ${errorMessage}`);
        } finally {
          if (!abortControllerRef.current?.signal.aborted) {
            setIsLoading(false);
          }
        }
      },
    });
  }, [draftId, onStatusChange, confirm, showNotification]);

  if (!isLeagueOwner) {
    return null;
  }

  return (
    <>
      {ConfirmationModal}
      {/* Draft Control Banner for League Owners */}
      {draftStatus === 'LIVE' && (
        <div className="w-full px-4 py-3 bg-amber-600 text-white">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span className="font-medium">League Owner Controls</span>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handlePauseDraft}
                disabled={isLoading}
                className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 flex items-center space-x-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{isLoading ? 'Pausing...' : 'Pause Draft'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft Paused Banner */}
      {draftStatus === 'PAUSED' && (
        <div className="w-full px-4 py-3 bg-yellow-600 text-white">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="font-medium">
                Draft is paused - Waiting for league owner to resume
              </span>
            </div>
            <button
              onClick={handleResumeDraft}
              disabled={isLoading}
              className="bg-yellow-700 hover:bg-yellow-800 text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 flex items-center space-x-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{isLoading ? 'Resuming...' : 'Resume Draft'}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
});

export default DraftControls;
