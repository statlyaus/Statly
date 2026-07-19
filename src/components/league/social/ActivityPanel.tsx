'use client';

import { MessageCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SocialMessage } from '@/types/social';

import SafeSocialText from './SafeSocialText';

interface ActivityPanelProps {
  activity: SocialMessage[];
  hasEarlierActivity: boolean;
  loading: boolean;
  loadingEarlier: boolean;
  error?: string | null;
  visible?: boolean;
  compact?: boolean;
  onRetry: () => Promise<void> | void;
  onLoadEarlier: () => Promise<void> | void;
  onLatestVisibleChange?: (visible: boolean) => void;
  onDiscuss?: (activity: SocialMessage) => void;
}

const BOTTOM_THRESHOLD_PX = 72;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

export default function ActivityPanel({
  activity,
  hasEarlierActivity,
  loading,
  loadingEarlier,
  error,
  visible = true,
  compact = false,
  onRetry,
  onLoadEarlier,
  onLatestVisibleChange,
  onDiscuss,
}: ActivityPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousLastIdRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  const [newActivityCount, setNewActivityCount] = useState(0);
  const latestActivity = activity.at(-1);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element) {
      onLatestVisibleChange?.(false);
      return;
    }
    onLatestVisibleChange?.(isNearBottom(element));
  }, [onLatestVisibleChange, visible]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element || !latestActivity) return;

    if (!hasInitializedRef.current) {
      element.scrollTop = element.scrollHeight;
      hasInitializedRef.current = true;
      previousLastIdRef.current = latestActivity.id;
      onLatestVisibleChange?.(true);
      return;
    }

    if (previousLastIdRef.current === latestActivity.id) return;
    const shouldFollow = isNearBottom(element);
    previousLastIdRef.current = latestActivity.id;
    if (shouldFollow) {
      element.scrollTop = element.scrollHeight;
      setNewActivityCount(0);
      onLatestVisibleChange?.(true);
    } else {
      setNewActivityCount((count) => count + 1);
    }
  }, [latestActivity, onLatestVisibleChange, visible]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || previousScrollHeightRef.current === null || loadingEarlier) return;
    element.scrollTop += element.scrollHeight - previousScrollHeightRef.current;
    previousScrollHeightRef.current = null;
  }, [activity.length, loadingEarlier]);

  function handleLoadEarlier(): void {
    if (scrollRef.current) {
      previousScrollHeightRef.current = scrollRef.current.scrollHeight;
    }
    void onLoadEarlier();
  }

  function jumpToLatest(): void {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setNewActivityCount(0);
    onLatestVisibleChange?.(true);
  }

  return (
    <section
      aria-labelledby="league-activity-heading"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground"
    >
      <header className="border-b border-border px-4 py-3">
        <h2 id="league-activity-heading" className="text-base font-semibold text-foreground">
          League activity
        </h2>
        <p className="text-xs text-muted-foreground">
          Draft picks, transactions, results, and commissioner actions
        </p>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className={`h-full overflow-y-auto px-4 py-3 ${compact ? 'min-h-0' : 'min-h-64'}`}
          aria-busy={loading || loadingEarlier}
          onScroll={(event) => {
            const latestIsVisible = isNearBottom(event.currentTarget);
            onLatestVisibleChange?.(latestIsVisible);
            if (latestIsVisible) {
              setNewActivityCount(0);
            }
          }}
        >
          {hasEarlierActivity ? (
            <div className="mb-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadEarlier}
                disabled={loadingEarlier}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {loadingEarlier ? 'Loading…' : 'Load earlier activity'}
              </button>
            </div>
          ) : null}

          {loading && activity.length === 0 ? (
            <p role="status" className="py-10 text-center text-sm text-muted-foreground">
              Loading league activity…
            </p>
          ) : error && activity.length === 0 ? (
            <div className="mx-auto max-w-sm rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void onRetry()}
                className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Retry
              </button>
            </div>
          ) : activity.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-foreground">No league activity yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                League events will appear here as the season progresses.
              </p>
            </div>
          ) : (
            <ol className="space-y-3" aria-label="League activity">
              {activity.map((item) => (
                <li key={item.id}>
                  <article className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <SafeSocialText value={item.content} />
                        <time
                          dateTime={item.createdAt}
                          className="mt-1 block text-xs text-muted-foreground"
                        >
                          {new Date(item.createdAt).toLocaleString()}
                        </time>
                      </div>
                      {onDiscuss ? (
                        <button
                          type="button"
                          onClick={() => onDiscuss(item)}
                          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <MessageCircle className="size-3.5" aria-hidden="true" />
                          Discuss
                        </button>
                      ) : null}
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>

        {newActivityCount > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {newActivityCount === 1
              ? '1 new activity item'
              : `${newActivityCount} new activity items`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
