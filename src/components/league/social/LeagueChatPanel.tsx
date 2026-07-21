'use client';

import { AtSign, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  CreateSocialMessageInput,
  SocialDiscussionContext,
  SocialMessage,
  SocialReportReason,
} from '@/types/social';

import GiphyMessageMedia from './GiphyMessageMedia';
import GiphyPicker from './GiphyPicker';
import SafeSocialText from './SafeSocialText';
import SocialAuthor from './SocialAuthor';
import SocialComposer from './SocialComposer';
import type { SocialComposerDraftScope } from './socialComposerDraft';
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
  composerLabel?: string;
  draftScope?: SocialComposerDraftScope;
  composerContext?: SocialDiscussionContext | null;
  onClearComposerContext?: () => void;
  onDismissSubmitError?: () => void;
  onLatestVisibleChange?: (visible: boolean) => void;
  onRetry: () => Promise<void> | void;
  onLoadEarlier: () => Promise<void> | void;
  onSend: (input: CreateSocialMessageInput) => Promise<void>;
  onReport: (messageId: string, reason: SocialReportReason, details?: string) => Promise<void>;
  onRemove: (messageId: string, reason: string) => Promise<void>;
}

const BOTTOM_THRESHOLD_PX = 72;
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

function messageDay(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'full' }).format(parsed);
}

function messageAuthorKey(message: SocialMessage): string {
  return (
    message.author?.userId ??
    `${message.author?.displayName ?? 'former-member'}:${message.author?.teamName ?? ''}`
  );
}

function isMessageContinuation(message: SocialMessage, previous?: SocialMessage): boolean {
  if (!previous || messageDay(message.createdAt) !== messageDay(previous.createdAt)) return false;
  if (messageAuthorKey(message) !== messageAuthorKey(previous)) return false;
  const currentTime = new Date(message.createdAt).getTime();
  const previousTime = new Date(previous.createdAt).getTime();
  return (
    Number.isFinite(currentTime) &&
    Number.isFinite(previousTime) &&
    currentTime >= previousTime &&
    currentTime - previousTime <= MESSAGE_GROUP_WINDOW_MS
  );
}

export function containsSocialMention(value: string): boolean {
  return /(^|\s)@[a-z0-9][a-z0-9._-]*/i.test(value);
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
  composerLabel = 'Message league chat',
  draftScope,
  composerContext,
  onClearComposerContext,
  onDismissSubmitError,
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

  async function sendWithContext(input: Omit<CreateSocialMessageInput, 'context'>): Promise<void> {
    await onSend({
      ...input,
      ...(composerContext ? { context: composerContext } : {}),
    });
    onClearComposerContext?.();
  }

  return (
    <section
      aria-label="League chat"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-social-canvas text-social-text"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className={`h-full overflow-y-auto px-3 py-2 ${compact ? 'min-h-0' : 'min-h-64'}`}
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
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-social-border bg-social-surface px-3 text-xs font-semibold text-social-text transition-colors hover:border-social-border-strong hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
              >
                {loadingEarlier ? 'Loading…' : 'Load earlier messages'}
              </button>
            </div>
          ) : null}

          {loading && messages.length === 0 ? (
            <p role="status" className="py-10 text-center text-sm text-social-text-muted">
              Loading league chat…
            </p>
          ) : error && messages.length === 0 ? (
            <div className="mx-auto max-w-sm rounded-xl border border-social-error bg-social-error-soft p-4 text-center">
              <p role="alert" className="text-sm font-medium text-social-error">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void onRetry()}
                className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-social-border bg-social-surface px-3 text-sm font-semibold text-social-text transition-colors hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
              >
                Retry
              </button>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold text-social-text">No messages yet</p>
              <p className="mt-1 text-sm text-social-text-muted">
                Start the conversation with your league.
              </p>
            </div>
          ) : (
            <ol className="space-y-1" aria-label="League chat messages">
              {visibleMessages.map((message, index) => {
                const day = messageDay(message.createdAt);
                const previousDay =
                  index > 0 ? messageDay(visibleMessages[index - 1].createdAt) : null;
                const continuation = isMessageContinuation(message, visibleMessages[index - 1]);
                const containsMention = containsSocialMention(message.content);
                return (
                  <li key={message.id}>
                    {day !== previousDay ? (
                      <div className="my-3 flex items-center gap-3" aria-label={day}>
                        <span className="h-px flex-1 bg-social-border" />
                        <time className="text-xs font-medium text-social-text-muted">{day}</time>
                        <span className="h-px flex-1 bg-social-border" />
                      </div>
                    ) : null}
                    <article
                      aria-label={`${containsMention ? 'Message containing a mention' : 'Message'} from ${message.author?.displayName ?? 'former member'}`}
                      className={`rounded-lg border px-2 py-1.5 ${continuation ? 'pl-12' : ''} ${
                        containsMention
                          ? 'border-social-warning bg-social-mention-bg text-social-mention-text'
                          : message.isOwn
                            ? 'border-social-action bg-social-brand-soft'
                            : 'border-transparent bg-social-surface'
                      }`}
                    >
                      {!continuation ? (
                        <SocialAuthor
                          author={message.author}
                          timestamp={message.createdAt}
                          editedAt={message.editedAt}
                          compact
                          timestampStyle="time"
                        />
                      ) : (
                        <time dateTime={message.createdAt} className="sr-only">
                          {new Date(message.createdAt).toLocaleTimeString()}
                        </time>
                      )}
                      {message.moderationStatus === 'removed' || message.deletedAt ? (
                        <p
                          className={`text-sm italic text-social-text-muted ${
                            continuation ? '' : 'mt-1.5 pl-11'
                          }`}
                        >
                          Message removed
                        </p>
                      ) : (
                        <>
                          {containsMention ? (
                            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-social-warning bg-social-warning-soft px-2 py-0.5 text-xs font-semibold text-social-mention-text">
                              <AtSign className="size-3" aria-hidden="true" />
                              Mention
                            </span>
                          ) : null}
                          {message.context ? (
                            <DiscussionContextCard context={message.context} />
                          ) : null}
                          {message.content ? (
                            <SafeSocialText
                              value={message.content}
                              className={continuation ? '' : 'mt-1.5 pl-11'}
                            />
                          ) : null}
                          {message.gif ? (
                            <div className={continuation ? '' : 'pl-11'}>
                              <GiphyMessageMedia gif={message.gif} />
                            </div>
                          ) : null}
                          {!message.isOwn || canManage ? (
                            <div className="mt-1 flex justify-end gap-1">
                              {!message.isOwn ? (
                                <SocialReportButton
                                  label="message"
                                  onReport={(reason, details) =>
                                    onReport(message.id, reason, details)
                                  }
                                />
                              ) : null}
                              {canManage ? (
                                <SocialRemoveButton
                                  label="message"
                                  onRemove={(reason) => onRemove(message.id, reason)}
                                />
                              ) : null}
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
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-social-action bg-social-action px-4 py-2 text-sm font-semibold text-social-action-foreground shadow-lg transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:border-social-action-pressed active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus focus-visible:ring-offset-2 focus-visible:ring-offset-social-canvas"
          >
            {newMessageCount === 1 ? '1 new message' : `${newMessageCount} new messages`}
          </button>
        ) : null}
      </div>

      <footer className="border-t border-social-border bg-social-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {!canPublish && !muted ? (
          <p role="status" className="py-2 text-center text-sm text-social-text-muted">
            Accept the community standards above before sending messages.
          </p>
        ) : muted ? (
          <p role="status" className="py-2 text-center text-sm text-social-text-muted">
            You can read chat, but cannot send until{' '}
            <time dateTime={mutedUntil ?? undefined}>
              {mutedUntil ? new Date(mutedUntil).toLocaleString() : 'the mute ends'}
            </time>
            .
          </p>
        ) : null}
        {canPublish && !muted ? (
          <>
            {composerContext ? (
              <DiscussionContextCard
                context={composerContext}
                onRemove={onClearComposerContext}
                label="Discussing"
              />
            ) : null}
            <SocialComposer
              label={composerLabel}
              placeholder="Message your league…"
              submitLabel="Send"
              maxLength={1000}
              submitOnEnter
              pending={sending}
              error={submitError}
              onDismissError={onDismissSubmitError}
              draftScope={draftScope}
              compact
              leadingAction={
                <GiphyPicker
                  compact
                  disabled={sending}
                  onSelect={(gif, idempotencyKey) =>
                    sendWithContext({ content: '', gif, idempotencyKey })
                  }
                />
              }
              onSubmit={(content, idempotencyKey) => sendWithContext({ content, idempotencyKey })}
            />
          </>
        ) : null}
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
    <div className="mt-2 rounded-xl border border-social-border bg-social-surface-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-social-text-muted">
            {label}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-social-text">{context.title}</p>
          {context.subtitle ? (
            <p className="mt-1 text-xs text-social-text-muted">{context.subtitle}</p>
          ) : null}
          {metadata.length > 0 ? (
            <p className="mt-1 truncate text-xs text-social-text-muted">{metadata.join(' · ')}</p>
          ) : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            aria-label="Remove discussion context"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
