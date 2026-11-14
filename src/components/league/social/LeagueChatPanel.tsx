'use client';

import { MessageCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  CreateSocialMessageInput,
  SocialDiscussionContext,
  SocialMessage,
  SocialReportReason,
} from '@/types/social';

import ChatMessageRow from './ChatMessageRow';
import DiscussionContextCard from './DiscussionContextCard';
import GiphyPicker from './GiphyPicker';
import { assignMemberColours, memberColourIndex } from './SocialAuthor';
import SocialComposer from './SocialComposer';
import type { SocialComposerDraftScope } from './socialComposerDraft';

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
  /** Saves an edit to the member's own message. Omit to hide the control. */
  onEdit?: (messageId: string, content: string) => Promise<void>;
  /** Deletes the member's own message. Omit to hide the control. */
  onDelete?: (messageId: string) => Promise<void>;
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
  onEdit,
  onDelete,
}: LeagueChatPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousLastIdRef = useRef<string | null>(null);
  const previousScrollHeightRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const visibleMessages = messages.filter((message) => message.type !== 'system');
  // Distinct colours for everyone in the loaded conversation, so coaches are told apart at a glance.
  const memberColours = assignMemberColours(visibleMessages.map((message) => message.author));
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
          className={`h-full overflow-y-auto px-3 py-3 ${compact ? 'min-h-0' : 'min-h-64'}`}
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
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-full border border-social-border bg-social-surface text-social-text-muted">
                <MessageCircle className="size-6" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-semibold text-social-text">No messages yet</p>
              <p className="mt-1 text-sm text-social-text-muted">
                Start the conversation with your league.
              </p>
            </div>
          ) : (
            <ol aria-label="League chat messages">
              {visibleMessages.map((message, index) => {
                const day = messageDay(message.createdAt);
                const previousDay =
                  index > 0 ? messageDay(visibleMessages[index - 1].createdAt) : null;
                return (
                  <ChatMessageRow
                    key={message.id}
                    message={message}
                    day={day !== previousDay ? day : null}
                    continuation={isMessageContinuation(message, visibleMessages[index - 1])}
                    colourIndex={memberColourIndex(message.author, memberColours)}
                    canManage={canManage}
                    canEdit={Boolean(onEdit && canPublish && !muted)}
                    onReport={onReport}
                    onRemove={onRemove}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
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

      <footer className="bg-social-canvas px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
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
