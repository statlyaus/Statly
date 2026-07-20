'use client';

import { ArrowLeft, Link as LinkIcon, Lock, Megaphone, MessageSquare, Pin } from 'lucide-react';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';

import type { SocialPost, SocialReply, SocialReportReason } from '@/types/social';

import SafeSocialText from './SafeSocialText';
import SocialAuthor from './SocialAuthor';
import SocialComposer from './SocialComposer';
import SocialReportButton from './SocialReportButton';
import SocialRemoveButton from './SocialRemoveButton';

interface PostThreadProps {
  post: SocialPost;
  replies: SocialReply[];
  loading: boolean;
  hasMore: boolean;
  mutedUntil?: string | null;
  canManage: boolean;
  canPublish: boolean;
  error?: string | null;
  submitError?: string | null;
  visible?: boolean;
  compact?: boolean;
  onDismissSubmitError?: () => void;
  onBack: () => void;
  onRetry: () => Promise<void> | void;
  onLoadMore: () => Promise<void> | void;
  onReply: (body: string, idempotencyKey: string) => Promise<void>;
  onUpdatePost: (input: { isPinned?: boolean; isLocked?: boolean }) => Promise<void>;
  onRemovePost: (reason: string) => Promise<void>;
  onRemoveReply: (replyId: string, reason: string) => Promise<void>;
  onReport: (
    contentType: 'post' | 'reply',
    contentId: string,
    reason: SocialReportReason,
    details?: string
  ) => Promise<void>;
  onLatestVisibleChange?: (visible: boolean) => void;
}

const BOTTOM_THRESHOLD_PX = 72;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_THRESHOLD_PX;
}

export default function PostThread({
  post,
  replies,
  loading,
  hasMore,
  mutedUntil,
  canManage,
  canPublish,
  error,
  submitError,
  visible = true,
  compact = false,
  onDismissSubmitError,
  onBack,
  onRetry,
  onLoadMore,
  onReply,
  onUpdatePost,
  onRemovePost,
  onRemoveReply,
  onReport,
  onLatestVisibleChange,
}: PostThreadProps): React.JSX.Element {
  const [replying, setReplying] = useState(false);
  const [moderating, setModerating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const muted = Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element) {
      onLatestVisibleChange?.(false);
      return;
    }
    onLatestVisibleChange?.(isNearBottom(element));
  }, [onLatestVisibleChange, post.latestActivityAt, replies.at(-1)?.id, visible]);

  async function handleReply(body: string, idempotencyKey: string): Promise<void> {
    setReplying(true);
    try {
      await onReply(body, idempotencyKey);
    } finally {
      setReplying(false);
    }
  }

  async function handleModeration(action: () => Promise<void>): Promise<void> {
    setModerating(true);
    try {
      await action();
    } finally {
      setModerating(false);
    }
  }

  return (
    <section
      aria-labelledby="social-thread-heading"
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        compact
          ? 'bg-background text-foreground'
          : 'rounded-2xl border border-border bg-card text-card-foreground'
      }`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to discussions
        </button>
        <Link
          href={`/leagues/${encodeURIComponent(post.leagueId)}/social/posts/${encodeURIComponent(post.id)}`}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LinkIcon className="size-4" aria-hidden="true" />
          Link
        </Link>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => onLatestVisibleChange?.(isNearBottom(event.currentTarget))}
      >
        <article
          className={`border-b border-border ${compact ? 'p-3' : 'p-4 sm:p-5'} ${
            post.isAnnouncement ? 'bg-primary/10' : 'bg-background'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {post.isAnnouncement ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                <Megaphone className="size-3.5" aria-hidden="true" />
                Announcement
              </span>
            ) : null}
            {post.isPinned ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                <Pin className="size-3.5" aria-hidden="true" />
                Pinned
              </span>
            ) : null}
            {post.isLocked ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Locked
              </span>
            ) : null}
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {post.category.name}
            </span>
          </div>
          {canManage ? (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              aria-label="Commissioner discussion controls"
            >
              <button
                type="button"
                disabled={moderating}
                onClick={() =>
                  void handleModeration(() => onUpdatePost({ isPinned: !post.isPinned }))
                }
                className="inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {post.isPinned ? 'Unpin' : 'Pin'} discussion
              </button>
              <button
                type="button"
                disabled={moderating}
                onClick={() =>
                  void handleModeration(() => onUpdatePost({ isLocked: !post.isLocked }))
                }
                className="inline-flex min-h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {post.isLocked ? 'Unlock' : 'Lock'} discussion
              </button>
              {!post.deletedAt ? (
                <SocialRemoveButton
                  label="discussion"
                  onRemove={(reason) => handleModeration(() => onRemovePost(reason))}
                />
              ) : null}
            </div>
          ) : null}
          <h2
            id="social-thread-heading"
            className="mt-3 text-xl font-semibold tracking-tight text-foreground"
          >
            {post.title}
          </h2>
          <div className="mt-3">
            <SocialAuthor
              author={post.author}
              timestamp={post.createdAt}
              editedAt={post.editedAt}
            />
          </div>
          {post.moderationStatus === 'removed' || post.deletedAt ? (
            <p className="mt-4 text-sm italic text-muted-foreground">Post removed</p>
          ) : (
            <SafeSocialText value={post.body} className="mt-4" />
          )}
          {!post.isOwn && !post.deletedAt ? (
            <div className="mt-3 flex justify-end">
              <SocialReportButton
                label="post"
                onReport={(reason, details) => onReport('post', post.id, reason, details)}
              />
            </div>
          ) : null}
        </article>

        <div className={compact ? 'p-3' : 'p-4 sm:p-5'}>
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageSquare className="size-4" aria-hidden="true" />
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </h3>

          {loading && replies.length === 0 ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Loading replies…
            </p>
          ) : error && replies.length === 0 ? (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
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
          ) : replies.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No replies yet.
            </p>
          ) : (
            <ol
              className={compact ? 'mt-3 divide-y divide-border' : 'mt-4 space-y-3'}
              aria-label="Discussion replies"
            >
              {replies.map((reply) => (
                <li key={reply.id}>
                  <article
                    className={
                      compact ? 'py-3' : 'rounded-xl border border-border bg-background p-3'
                    }
                  >
                    <SocialAuthor
                      author={reply.author}
                      timestamp={reply.createdAt}
                      editedAt={reply.editedAt}
                      compact
                    />
                    {reply.moderationStatus === 'removed' || reply.deletedAt ? (
                      <p className="mt-2 text-sm italic text-muted-foreground">Reply removed</p>
                    ) : (
                      <>
                        <SafeSocialText value={reply.body} className="mt-2" />
                        {!reply.isOwn ? (
                          <div className="mt-2 flex justify-end">
                            <SocialReportButton
                              label="reply"
                              onReport={(reason, details) =>
                                onReport('reply', reply.id, reason, details)
                              }
                            />
                          </div>
                        ) : null}
                        {canManage ? (
                          <div className="mt-2 flex justify-end">
                            <SocialRemoveButton
                              label="reply"
                              onRemove={(reason) => onRemoveReply(reply.id, reason)}
                            />
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                </li>
              ))}
            </ol>
          )}

          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void onLoadMore()}
                disabled={loading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Load more replies'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="border-t border-border bg-background p-3">
        {post.isLocked ? (
          <p className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-muted-foreground">
            <Lock className="size-4" aria-hidden="true" />
            This discussion is locked and cannot receive replies.
          </p>
        ) : !canPublish && !muted ? (
          <p role="status" className="py-2 text-center text-sm font-medium text-muted-foreground">
            Accept the community standards above before replying.
          </p>
        ) : muted ? (
          <p role="status" className="py-2 text-center text-sm font-medium text-muted-foreground">
            You can read this discussion, but cannot reply until{' '}
            <time dateTime={mutedUntil ?? undefined}>
              {mutedUntil ? new Date(mutedUntil).toLocaleString() : 'the mute ends'}
            </time>
            .
          </p>
        ) : (
          <SocialComposer
            label={`Reply to ${post.title}`}
            placeholder="Write a reply…"
            submitLabel="Reply"
            maxLength={10000}
            pending={replying}
            error={submitError}
            onDismissError={onDismissSubmitError}
            compact={compact}
            onSubmit={handleReply}
          />
        )}
      </footer>
    </section>
  );
}
