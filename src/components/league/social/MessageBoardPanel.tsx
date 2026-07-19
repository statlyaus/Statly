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
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="message-board-heading" className="text-base font-semibold text-foreground">
            Message board
          </h2>
          <p className="text-xs text-muted-foreground">
            Announcements and persistent league discussions
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((visible) => !visible)}
          disabled={!canPublish || muted}
          aria-expanded={showForm}
          aria-controls="create-social-post"
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          New post
        </button>
      </header>

      {muted ? (
        <p
          role="status"
          className="border-b border-border bg-warning/10 px-4 py-3 text-sm text-foreground"
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
          className="space-y-4 border-b border-border bg-muted/30 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <div>
              <label htmlFor={titleId} className="text-sm font-medium text-foreground">
                Post title
              </label>
              <input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={150}
                required
                className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What should the league discuss?"
              />
              <p className="mt-1 text-xs text-muted-foreground">{title.length} / 150</p>
            </div>
            <div>
              <label htmlFor={categoryId} className="text-sm font-medium text-foreground">
                Category
              </label>
              <select
                id={categoryId}
                value={selectedCategoryId}
                onChange={(event) => setSelectedCategoryId(event.target.value)}
                required
                className="mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <label htmlFor={bodyId} className="text-sm font-medium text-foreground">
              Post body
            </label>
            <textarea
              id={bodyId}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={10000}
              rows={7}
              required
              className="mt-1 block w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Add the details league members will need…"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {body.length.toLocaleString()} / 10,000
            </p>
          </div>
          {canManage ? (
            <label className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={(event) => setIsAnnouncement(event.target.checked)}
                className="size-4 rounded border-border text-primary focus:ring-ring"
              />
              Publish as an official announcement
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Publishing…' : 'Publish post'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            {submitError ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {submitError}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        onScroll={(event) => onLatestVisibleChange?.(event.currentTarget.scrollTop <= 72)}
      >
        <div className="mb-3 flex justify-end">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-foreground">
            Sort discussions
            <select
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SocialPostSort)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="latestActivity">Latest activity</option>
              <option value="createdAt">Creation date</option>
            </select>
          </label>
        </div>
        {loading && posts.length === 0 ? (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">
            Loading message board…
          </p>
        ) : error && posts.length === 0 ? (
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
        ) : posts.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-semibold text-foreground">No discussions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create the first post for your league.
            </p>
          </div>
        ) : (
          <ol className="space-y-3" aria-label="League message board posts">
            {sortedPosts.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  onClick={() => onSelectPost(post)}
                  className={`block w-full rounded-xl border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    post.isAnnouncement
                      ? 'border-primary/35 bg-primary/10'
                      : 'border-border bg-background'
                  }`}
                  aria-label={`Open discussion: ${post.title}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
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
                  </span>
                  <span className="mt-3 block text-base font-semibold text-foreground">
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
                  <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more discussions'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
