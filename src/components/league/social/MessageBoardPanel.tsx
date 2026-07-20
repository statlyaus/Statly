'use client';

import { Lock, Megaphone, MessageSquare, Pin } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import type { CreateSocialPostInput, SocialBoardCategory, SocialPost } from '@/types/social';

import SocialAuthor from './SocialAuthor';
import type { SocialPostSort } from './useLeagueSocial';

interface MessageBoardPanelProps {
  posts: SocialPost[];
  categories: SocialBoardCategory[];
  loading: boolean;
  loadingMore: boolean;
  creating: boolean;
  hasMore: boolean;
  canPublish: boolean;
  canManage: boolean;
  mutedUntil?: string | null;
  error?: string | null;
  submitError?: string | null;
  visible?: boolean;
  compact?: boolean;
  onRetry: () => Promise<void> | void;
  onLoadMore: () => Promise<void> | void;
  onSelectPost: (post: SocialPost) => void;
  onCreatePost: (input: Omit<CreateSocialPostInput, 'idempotencyKey'>) => Promise<SocialPost>;
  sort: SocialPostSort;
  onSortChange: (sort: SocialPostSort) => void;
  onLatestVisibleChange?: (visible: boolean) => void;
}

export default function MessageBoardPanel({
  posts,
  categories,
  loading,
  loadingMore,
  creating,
  hasMore,
  canPublish,
  canManage,
  mutedUntil,
  error,
  submitError,
  visible = true,
  compact = false,
  onRetry,
  onLoadMore,
  onSelectPost,
  onCreatePost,
  sort,
  onSortChange,
  onLatestVisibleChange,
}: MessageBoardPanelProps): React.JSX.Element {
  const titleId = useId();
  const bodyId = useId();
  const categoryId = useId();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id ?? '');
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const muted = Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());
  const sortedPosts = [...posts].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    const leftDate = sort === 'createdAt' ? left.createdAt : left.latestActivityAt;
    const rightDate = sort === 'createdAt' ? right.createdAt : right.latestActivityAt;
    return new Date(rightDate).getTime() - new Date(leftDate).getTime();
  });
  const canSubmit =
    !creating &&
    canPublish &&
    !muted &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    Boolean(selectedCategoryId);

  useEffect(() => {
    if (!selectedCategoryId && categories[0]) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!visible || !element) {
      onLatestVisibleChange?.(false);
      return;
    }
    onLatestVisibleChange?.(element.scrollTop <= 72);
  }, [onLatestVisibleChange, sortedPosts[0]?.id, visible]);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await onCreatePost({
        categoryId: selectedCategoryId,
        title: title.trim(),
        body: body.trim(),
        ...(canPublish && isAnnouncement ? { isAnnouncement: true } : {}),
      });
      setTitle('');
      setBody('');
      setIsAnnouncement(false);
      setShowForm(false);
    } catch {
      // The controller supplies submitError while preserving the member's draft.
    }
  }

  return (
    <section
      aria-labelledby="message-board-heading"
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        compact
          ? 'bg-social-canvas text-social-text'
          : 'rounded-2xl border border-social-border bg-social-canvas text-social-text'
      }`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-3 border-b border-social-border bg-social-surface ${
          compact ? 'px-3 py-2.5' : 'px-4 py-3'
        }`}
      >
        <div>
          <h2 id="message-board-heading" className="text-base font-semibold text-social-text">
            {compact ? 'Discussions' : 'Message board'}
          </h2>
          {!compact ? (
            <p className="text-xs text-social-text-muted">
              Announcements and persistent league discussions
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((visible) => !visible)}
          disabled={!canPublish || muted}
          aria-expanded={showForm}
          aria-controls="create-social-post"
          className={`inline-flex items-center justify-center rounded-lg border border-social-action bg-social-action text-sm font-semibold text-social-action-foreground transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:border-social-action-pressed active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus focus-visible:ring-offset-2 focus-visible:ring-offset-social-surface disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text ${
            compact ? 'min-h-9 px-3' : 'min-h-10 px-4'
          }`}
        >
          New post
        </button>
      </header>

      {muted ? (
        <p
          role="status"
          className="border-b border-social-warning bg-social-warning-soft px-4 py-3 text-sm text-social-warning-text"
        >
          Posting is unavailable until{' '}
          <time dateTime={mutedUntil ?? undefined}>
            {mutedUntil ? new Date(mutedUntil).toLocaleString() : 'the mute ends'}
          </time>
          .
        </p>
      ) : null}

      {showForm ? (
        <form
          id="create-social-post"
          onSubmit={(event) => void handleCreate(event)}
          className="space-y-4 border-b border-social-border bg-social-surface-subtle p-4"
        >
          <div className={compact ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]'}>
            <div>
              <label htmlFor={titleId} className="text-sm font-medium text-social-text">
                Post title
              </label>
              <input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={150}
                required
                className="mt-1 block h-11 w-full rounded-xl border border-social-border bg-social-surface px-3 text-sm text-social-text outline-none placeholder:text-social-text-muted focus-visible:border-social-action focus-visible:ring-2 focus-visible:ring-social-focus"
                placeholder="What should the league discuss?"
              />
              <p className="mt-1 text-xs text-social-text-muted">{title.length} / 150</p>
            </div>
            <div>
              <label htmlFor={categoryId} className="text-sm font-medium text-social-text">
                Category
              </label>
              <select
                id={categoryId}
                value={selectedCategoryId}
                onChange={(event) => setSelectedCategoryId(event.target.value)}
                required
                className="mt-1 block h-11 w-full rounded-xl border border-social-border bg-social-surface px-3 text-sm text-social-text outline-none focus-visible:border-social-action focus-visible:ring-2 focus-visible:ring-social-focus"
              >
                <option value="">Choose category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={bodyId} className="text-sm font-medium text-social-text">
              Post body
            </label>
            <textarea
              id={bodyId}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={10000}
              rows={compact ? 5 : 7}
              required
              className="mt-1 block w-full resize-y rounded-xl border border-social-border bg-social-surface px-3 py-2 text-sm text-social-text outline-none placeholder:text-social-text-muted focus-visible:border-social-action focus-visible:ring-2 focus-visible:ring-social-focus"
              placeholder="Add the details league members will need…"
            />
            <p className="mt-1 text-xs text-social-text-muted">
              {body.length.toLocaleString()} / 10,000
            </p>
          </div>
          {canManage ? (
            <label className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-social-text">
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={(event) => setIsAnnouncement(event.target.checked)}
                className="size-4 rounded border-social-border text-social-action focus:ring-social-focus"
              />
              Publish as an official announcement
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-social-action bg-social-action px-4 text-sm font-semibold text-social-action-foreground transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:border-social-action-pressed active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              {creating ? 'Publishing…' : 'Publish post'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-social-border bg-social-surface px-4 text-sm font-semibold text-social-text transition-colors hover:border-social-border-strong hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            >
              Cancel
            </button>
            {submitError ? (
              <p role="alert" className="text-sm font-medium text-social-error">
                {submitError}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      <div
        ref={scrollRef}
        className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'p-3' : 'p-4'}`}
        onScroll={(event) => onLatestVisibleChange?.(event.currentTarget.scrollTop <= 72)}
      >
        <div className="mb-3 flex justify-end">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-social-text">
            {compact ? 'Sort' : 'Sort discussions'}
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SocialPostSort)}
              className="h-10 rounded-lg border border-social-border bg-social-surface px-3 text-sm text-social-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            >
              <option value="latestActivity">Latest activity</option>
              <option value="createdAt">Creation date</option>
            </select>
          </label>
        </div>
        {loading && posts.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-social-text-muted">
            Loading message board…
          </p>
        ) : error && posts.length === 0 ? (
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
        ) : posts.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-semibold text-social-text">No discussions yet</p>
            <p className="mt-1 text-sm text-social-text-muted">
              Create the first post for your league.
            </p>
          </div>
        ) : (
          <ol
            className={compact ? 'divide-y divide-social-border' : 'space-y-3'}
            aria-label="League message board posts"
          >
            {sortedPosts.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  onClick={() => onSelectPost(post)}
                  className={`block w-full border-l-4 text-left transition-colors hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus ${
                    compact
                      ? `px-2 py-3 ${
                          post.isAnnouncement
                            ? 'border-l-social-brand-strong bg-social-surface'
                            : 'border-l-transparent bg-social-surface'
                        }`
                      : `rounded-xl border p-4 ${
                          post.isAnnouncement
                            ? 'border-social-border border-l-social-brand-strong bg-social-surface'
                            : 'border-social-border border-l-transparent bg-social-surface'
                        }`
                  }`}
                  aria-label={`Open discussion: ${post.title}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {post.isAnnouncement ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-social-brand-strong px-2.5 py-1 text-xs font-semibold text-social-brand-foreground">
                        <Megaphone className="size-3.5" aria-hidden="true" />
                        Announcement
                      </span>
                    ) : null}
                    {post.isPinned ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-social-action bg-social-brand-soft px-2.5 py-1 text-xs font-semibold text-social-action-pressed">
                        <Pin className="size-3.5" aria-hidden="true" />
                        Pinned
                      </span>
                    ) : null}
                    {post.isLocked ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-social-border bg-social-surface-subtle px-2.5 py-1 text-xs font-semibold text-social-text-muted">
                        <Lock className="size-3.5" aria-hidden="true" />
                        Locked
                      </span>
                    ) : null}
                    <span className="rounded-full border border-social-border bg-social-surface-subtle px-2.5 py-1 text-xs font-medium text-social-text-muted">
                      {post.category.name}
                    </span>
                  </span>
                  <span className="mt-3 block text-base font-semibold text-social-text">
                    {post.title}
                  </span>
                  <span className="mt-3 block">
                    <SocialAuthor
                      author={post.author}
                      timestamp={post.createdAt}
                      editedAt={post.editedAt}
                      compact
                    />
                  </span>
                  <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-social-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="size-3.5" aria-hidden="true" />
                      {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
                    </span>
                    <span>
                      Latest activity{' '}
                      <time dateTime={post.latestActivityAt}>
                        {new Date(post.latestActivityAt).toLocaleString()}
                      </time>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {hasMore ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void onLoadMore()}
              disabled={loadingMore}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-social-border bg-social-surface px-4 text-sm font-semibold text-social-text transition-colors hover:border-social-border-strong hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              {loadingMore ? 'Loading…' : 'Load more discussions'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
