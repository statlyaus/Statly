'use client';

import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SocialDiscussionContext, SocialMessage, SocialReportReason } from '@/types/social';

import SafeSocialText from './SafeSocialText';
import SocialAuthor from './SocialAuthor';
import SocialComposer from './SocialComposer';
import SocialReportButton from './SocialReportButton';
import SocialRemoveButton from './SocialRemoveButton';

interface LeagueChatPanelProps {
  messages: SocialMessage[];
  hasEarlierMessages: boolean;
  loading: boolean;
  loadingEarlier: boolean;
  sending: boolean;
  canPublish: boolean;
  canManage: boolean;
  mutedUntil?: string | null;
  error?: string | null;
  submitError?: string | null;
  visible?: boolean;
  compact?: boolean;
  composerContext?: SocialDiscussionContext | null;
  onClearComposerContext?: () => void;
  onLatestVisibleChange?: (visible: boolean) => void;
  onRetry: () => Promise<void> | void;
  onLoadEarlier: () => Promise<void> | void;
  onSend: (content: string, context?: SocialDiscussionContext | null) => Promise<void>;
  onReport: (messageId: string, reason: SocialReportReason, details?: string) => Promise<void>;
  onRemove: (messageId: string, reason: string) => Promise<void>;
}

const BOTTOM_THRESHOLD_PX = 72;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

function messageDay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'full' }).format(parsed);
}

export default function LeagueChatPanel({
  messages,
  hasEarlierMessages,
  loading,
  loadingEarlier,
  sending,
  canPublish,
  canManage,
  mutedUntil,
  error,
  submitError,
  visible = true,
  compact = false,
  composerContext,
  onClearComposerContext,
  onLatestVisibleChange,
  onRetry,
  onLoadEarlier,
  onSend,
  onReport,
  onRemove,
}: LeagueChatPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousLastIdRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const visibleMessages = messages.filter((message) => message.type !== 'system');
  const latestMessage = visibleMessages.at(-1);
  const muted = Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element) {
      onLatestVisibleChange?.(false);
      return;
    }
    onLatestVisibleChange?.(isNearBottom(element));
  }, [onLatestVisibleChange, visible]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || previousScrollHeightRef.current === null || loadingEarlier) return;
    element.scrollTop += element.scrollHeight - previousScrollHeightRef.current;
    previousScrollHeightRef.current = null;
  }, [loadingEarlier, messages.length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element || !latestMessage) return;

    if (!hasInitializedRef.current) {
      element.scrollTop = element.scrollHeight;
      hasInitializedRef.current = true;
      previousLastIdRef.current = latestMessage.id;
      onLatestVisibleChange?.(true);
      return;
    }

    if (previousLastIdRef.current === latestMessage.id) return;
    const shouldFollow = latestMessage.isOwn || isNearBottom(element);
    previousLastIdRef.current = latestMessage.id;

    if (shouldFollow) {
      element.scrollTop = element.scrollHeight;
      setNewMessageCount(0);
      onLatestVisibleChange?.(true);
    } else {
      setNewMessageCount((count) => count + 1);
    }
  }, [latestMessage, onLatestVisibleChange, visible]);

  function handleLoadEarlier(): void {
    if (scrollRef.current) {
      previousScrollHeightRef.current = scrollRef.current.scrollHeight;
    }
    void onLoadEarlier();
  }

  function jumpToLatest(): void {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    setNewMessageCount(0);
    onLatestVisibleChange?.(true);
  }

  return (
    <section
      aria-labelledby="league-chat-heading"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="league-chat-heading" className="text-base font-semibold text-foreground">
            League chat
          </h2>
          <p className="text-xs text-muted-foreground">Private to current league members</p>
        </div>
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
              setNewMessageCount(0);
            }
          }}
        >
          {hasEarlierMessages ? (
            <div className="mb-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadEarlier}
                disabled={loadingEarlier}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
              </button>
            </div>
          ) : null}

          {loading && messages.length === 0 ? (
            <p role="status" className="py-10 text-center text-sm text-muted-foreground">
              Loading league chat…
            </p>
          ) : error && messages.length === 0 ? (
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
          ) : visibleMessages.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-foreground">No messages yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start the conversation with your league.
              </p>
            </div>
          ) : (
            <ol className="space-y-3" aria-label="League chat messages">
              {visibleMessages.map((message, index) => {
                const day = messageDay(message.createdAt);
                const previousDay =
                  index > 0 ? messageDay(visibleMessages[index - 1].createdAt) : null;
                return (
                  <li key={message.id}>
                    {day !== previousDay ? (
                      <div className="my-4 flex items-center gap-3" aria-label={day}>
                        <span className="h-px flex-1 bg-border" />
                        <time className="text-xs font-medium text-muted-foreground">{day}</time>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    ) : null}
                    <article
                      className={`rounded-xl border p-3 ${
                        message.isOwn
                          ? 'border-primary/30 bg-primary/10'
                          : 'border-border bg-background'
                      }`}
                    >
                      <SocialAuthor
                        author={message.author}
                        timestamp={message.createdAt}
                        editedAt={message.editedAt}
                        compact
                      />
                      {message.moderationStatus === 'removed' || message.deletedAt ? (
                        <p className="mt-2 text-sm italic text-muted-foreground">Message removed</p>
                      ) : (
                        <>
                          {message.context ? (
                            <DiscussionContextCard context={message.context} />
                          ) : null}
                          <SafeSocialText value={message.content} className="mt-2" />
                          {!message.isOwn ? (
                            <div className="mt-2 flex justify-end">
                              <SocialReportButton
                                label="message"
                                onReport={(reason, details) =>
                                  onReport(message.id, reason, details)
                                }
                              />
                            </div>
                          ) : null}
                          {canManage ? (
                            <div className="mt-2 flex justify-end">
                              <SocialRemoveButton
                                label="message"
                                onRemove={(reason) => onRemove(message.id, reason)}
                              />
                            </div>
                          ) : null}
                        </>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {newMessageCount > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {newMessageCount === 1 ? '1 new message' : `${newMessageCount} new messages`}
          </button>
        ) : null}
      </div>

      <footer className="border-t border-border bg-background p-3">
        {!canPublish && !muted ? (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            Accept the community standards above before sending messages.
          </p>
        ) : muted ? (
          <p role="status" className="mb-2 text-sm text-muted-foreground">
            You can read chat, but cannot send until{' '}
            <time dateTime={mutedUntil ?? undefined}>
              {mutedUntil ? new Date(mutedUntil).toLocaleString() : 'the mute ends'}
            </time>
            .
          </p>
        ) : null}
        {composerContext ? (
          <DiscussionContextCard
            context={composerContext}
            onRemove={onClearComposerContext}
            label="Discussing"
          />
        ) : null}
        <SocialComposer
          label="Message league chat"
          placeholder="Message your league…"
          submitLabel="Send"
          maxLength={1000}
          submitOnEnter
          disabled={!canPublish || muted}
          pending={sending}
          error={submitError}
          onSubmit={async (content) => {
            await onSend(content, composerContext);
            onClearComposerContext?.();
          }}
        />
      </footer>
    </section>
  );
}

function DiscussionContextCard({
  context,
  label = 'Context',
  onRemove,
}: {
  context: SocialDiscussionContext;
  label?: string;
  onRemove?: () => void;
}): React.JSX.Element {
  const metadata = Object.values(context.metadata ?? {}).filter(Boolean);

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground">{context.title}</p>
          {context.subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{context.subtitle}</p>
          ) : null}
          {metadata.length > 0 ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{metadata.join(' · ')}</p>
          ) : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove discussion context"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
