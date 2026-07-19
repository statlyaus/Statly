'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { SocialMessage, SocialReportReason } from '@/types/social';

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
  onRetry: () => Promise<void> | void;
  onLoadEarlier: () => Promise<void> | void;
  onSend: (content: string) => Promise<void>;
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
  const [showSystemMessages, setShowSystemMessages] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const visibleMessages = showSystemMessages
    ? messages
    : messages.filter((message) => message.type !== 'system');
  const latestMessage = messages.at(-1);
  const muted = Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || previousScrollHeightRef.current === null || loadingEarlier) return;
    element.scrollTop += element.scrollHeight - previousScrollHeightRef.current;
    previousScrollHeightRef.current = null;
  }, [loadingEarlier, messages.length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !latestMessage) return;

    if (!hasInitializedRef.current) {
      element.scrollTop = element.scrollHeight;
      hasInitializedRef.current = true;
      previousLastIdRef.current = latestMessage.id;
      return;
    }

    if (previousLastIdRef.current === latestMessage.id) return;
    const shouldFollow = latestMessage.isOwn || isNearBottom(element);
    previousLastIdRef.current = latestMessage.id;

    if (shouldFollow) {
      element.scrollTop = element.scrollHeight;
      setNewMessageCount(0);
    } else {
      setNewMessageCount((count) => count + 1);
    }
  }, [latestMessage]);

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
        <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground">
          <input
            type="checkbox"
            checked={showSystemMessages}
            onChange={(event) => setShowSystemMessages(event.target.checked)}
            className="size-4 rounded border-border text-primary focus:ring-ring"
          />
          Show league activity
        </label>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full min-h-64 overflow-y-auto px-4 py-3"
          aria-busy={loading || loadingEarlier}
          onScroll={(event) => {
            if (isNearBottom(event.currentTarget)) setNewMessageCount(0);
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
                    {message.type === 'system' ? (
                      <article className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                          League activity
                        </p>
                        <SafeSocialText value={message.content} className="mt-1" />
                        <time
                          dateTime={message.createdAt}
                          className="mt-1 block text-xs text-muted-foreground"
                        >
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </article>
                    ) : (
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
                          <p className="mt-2 text-sm italic text-muted-foreground">
                            Message removed
                          </p>
                        ) : (
                          <>
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
                    )}
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
        <SocialComposer
          label="Message league chat"
          placeholder="Message your league…"
          submitLabel="Send"
          maxLength={1000}
          submitOnEnter
          disabled={!canPublish || muted}
          pending={sending}
          error={submitError}
          onSubmit={onSend}
        />
      </footer>
    </section>
  );
}
