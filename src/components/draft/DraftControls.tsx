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
  const isPaused = draftStatus === 'PAUSED';
  const actionLabel = isPaused ? 'Resume draft' : 'Pause draft';
  const actionVerb = isPaused ? 'Resuming...' : 'Pausing...';
  const statusLabel = isPaused ? 'Draft paused' : 'Owner controls';
  const statusDescription = isPaused
    ? 'The clock is stopped. Resume when you want picks and auto-picks to continue.'
    : 'Pause only if you need to intervene. This stops the live clock and all auto-pick activity.';

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
          showNotification('error', `Failed to pause draft: ${errorMessage}`);
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
      {(draftStatus === 'LIVE' || isPaused) && (
        <section className="mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/95 px-5 py-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                  isPaused
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                    : 'border-orange-500/30 bg-orange-500/10 text-orange-700'
                }`}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    League owner
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                      isPaused
                        ? 'bg-amber-500/10 text-amber-700'
                        : 'bg-orange-500/10 text-orange-700'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{actionLabel}</p>
                  <p className="text-sm text-muted-foreground">{statusDescription}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={isPaused ? handleResumeDraft : handlePauseDraft}
                disabled={isLoading}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  isPaused
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
                aria-label={actionLabel}
              >
                {isLoading ? actionVerb : actionLabel}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
});

export default DraftControls;
