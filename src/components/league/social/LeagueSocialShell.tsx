'use client';

import { MessageCircle, MessagesSquare, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import type { SocialChannel, SocialPost } from '@/types/social';

import LeagueChatPanel from './LeagueChatPanel';
import MessageBoardPanel from './MessageBoardPanel';
import PostThread from './PostThread';
import SocialPreferencesPanel from './SocialPreferencesPanel';
import { useLeagueSocial } from './useLeagueSocial';

export type LeagueSocialView = 'chat' | 'board';

interface LeagueSocialShellProps {
  leagueId: string;
  currentUserId?: string;
  initialView?: LeagueSocialView;
  initialPostId?: string;
  className?: string;
  title?: string;
}

const tabs: Array<{ id: LeagueSocialView; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'board', label: 'Message board', icon: MessagesSquare },
];

export default function LeagueSocialShell({
  leagueId,
  currentUserId,
  initialView = 'chat',
  initialPostId,
  className = '',
  title = 'League social',
}: LeagueSocialShellProps): React.JSX.Element {
  const controller = useLeagueSocial(leagueId, currentUserId);
  const tabSetId = useId();
  const tabRefs = useRef<Record<LeagueSocialView, HTMLButtonElement | null>>({
    chat: null,
    board: null,
  });
  const loadedInitialPostRef = useRef<string | null>(null);
  const [activeView, setActiveView] = useState<LeagueSocialView>(initialView);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(initialPostId ?? null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [acceptingStandards, setAcceptingStandards] = useState(false);
  const [standardsError, setStandardsError] = useState<string | null>(null);
  const selectedPost = controller.posts.find((post) => post.id === selectedPostId) ?? null;
  const selectedThread = selectedPostId ? controller.threads[selectedPostId] : undefined;

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (!initialPostId || loadedInitialPostRef.current === initialPostId) return;
    loadedInitialPostRef.current = initialPostId;
    setActiveView('board');
    setSelectedPostId(initialPostId);
    void controller.loadReplies(initialPostId);
  }, [controller.loadReplies, initialPostId]);

  useEffect(() => {
    if (controller.loading) return;
    void controller.markRead(activeView as SocialChannel);
  }, [
    activeView,
    controller.loading,
    controller.markRead,
    controller.summary?.latestSequence[activeView],
  ]);

  function selectView(view: LeagueSocialView): void {
    setActiveView(view);
    if (view === 'chat') setSelectedPostId(null);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeView);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextView = tabs[nextIndex].id;
    selectView(nextView);
    window.requestAnimationFrame(() => tabRefs.current[nextView]?.focus());
  }

  function handleSelectPost(post: SocialPost): void {
    setSelectedPostId(post.id);
    void controller.loadReplies(post.id);
  }

  return (
    <section
      className={`flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-sm ${className}`}
      aria-label={title}
    >
      <div className="border-b border-border bg-card px-3 pt-3">
        <div className="flex items-start justify-between gap-3 px-1 pb-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Chat live or revisit persistent league discussions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPreferences((visible) => !visible)}
            aria-expanded={showPreferences}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="sr-only">Social notification preferences</span>
          </button>
        </div>
        {showPreferences && controller.summary ? (
          <SocialPreferencesPanel
            preferences={controller.summary.preferences}
            onSave={async (preferences) => {
              await controller.updatePreferences(preferences);
            }}
            onClose={() => setShowPreferences(false)}
          />
        ) : null}
        {controller.summary && !controller.summary.standardsAccepted ? (
          <div className="mb-3 rounded-xl border border-primary/30 bg-primary/10 p-3">
            <p className="text-sm font-semibold text-foreground">Community standards</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep league discussion respectful, safe, and relevant. You can read league social
              content now, but must accept these standards before posting.
            </p>
            <button
              type="button"
              disabled={acceptingStandards}
              onClick={async () => {
                setAcceptingStandards(true);
                setStandardsError(null);
                try {
                  await controller.acceptStandards();
                } catch (error) {
                  setStandardsError(
                    error instanceof Error ? error.message : 'Could not record your acceptance.'
                  );
                } finally {
                  setAcceptingStandards(false);
                }
              }}
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acceptingStandards ? 'Saving…' : 'I accept the community standards'}
            </button>
            {standardsError ? (
              <p role="alert" className="mt-2 text-sm font-medium text-destructive">
                {standardsError}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          role="tablist"
          aria-label="League social views"
          className="grid max-w-md grid-cols-2 gap-1 rounded-xl bg-muted p-1"
        >
          {tabs.map((tab) => {
            const active = activeView === tab.id;
            const unread = controller.summary?.unread[tab.id] ?? 0;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[tab.id] = element;
                }}
                id={`${tabSetId}-${tab.id}-tab`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${tabSetId}-${tab.id}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectView(tab.id)}
                onKeyDown={handleTabKeyDown}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{tab.label}</span>
                {unread > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-xs font-semibold text-destructive-foreground">
                    <span className="sr-only">{unread} unread</span>
                    <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`${tabSetId}-${activeView}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabSetId}-${activeView}-tab`}
        className="flex min-h-0 flex-1 p-3"
      >
        {activeView === 'chat' ? (
          <LeagueChatPanel
            messages={controller.messages}
            hasEarlierMessages={Boolean(controller.messagesCursor)}
            loading={controller.loading}
            loadingEarlier={controller.loadingEarlierMessages}
            sending={controller.sendingMessage}
            canPublish={controller.summary?.canPublish ?? false}
            canManage={controller.summary?.canManage ?? false}
            mutedUntil={controller.summary?.mutedUntil}
            error={controller.error}
            submitError={controller.submitError}
            onRetry={controller.retry}
            onLoadEarlier={controller.loadEarlierMessages}
            onSend={controller.sendMessage}
            onReport={(messageId, reason, details) =>
              controller.reportContent('message', messageId, reason, details)
            }
            onRemove={(messageId, reason) =>
              controller.moderateContent('message', messageId, reason)
            }
          />
        ) : selectedPost ? (
          <PostThread
            post={selectedPost}
            replies={selectedThread?.items ?? []}
            loading={selectedThread?.loading ?? true}
            hasMore={Boolean(selectedThread?.nextCursor)}
            mutedUntil={controller.summary?.mutedUntil}
            canManage={controller.summary?.canManage ?? false}
            canPublish={controller.summary?.canPublish ?? false}
            error={selectedThread?.error}
            submitError={controller.submitError}
            onBack={() => setSelectedPostId(null)}
            onRetry={() => controller.loadReplies(selectedPost.id)}
            onLoadMore={() => controller.loadReplies(selectedPost.id, true)}
            onReply={(body) => controller.createReply(selectedPost.id, body)}
            onUpdatePost={async (input) => {
              await controller.updatePost(selectedPost.id, input);
            }}
            onRemovePost={(reason) => controller.moderateContent('post', selectedPost.id, reason)}
            onRemoveReply={(replyId, reason) =>
              controller.moderateContent('reply', replyId, reason)
            }
            onReport={(contentType, contentId, reason, details) =>
              controller.reportContent(contentType, contentId, reason, details)
            }
          />
        ) : (
          <MessageBoardPanel
            posts={controller.posts}
            categories={controller.summary?.categories ?? []}
            loading={controller.loading}
            loadingMore={controller.loadingMorePosts}
            creating={controller.creatingPost}
            hasMore={Boolean(controller.postsCursor)}
            canPublish={controller.summary?.canPublish ?? false}
            canManage={controller.summary?.canManage ?? false}
            mutedUntil={controller.summary?.mutedUntil}
            error={controller.error}
            submitError={controller.submitError}
            onRetry={controller.retry}
            onLoadMore={controller.loadMorePosts}
            onSelectPost={handleSelectPost}
            onCreatePost={controller.createPost}
            sort={controller.postSort}
            onSortChange={controller.setPostSort}
          />
        )}
      </div>
    </section>
  );
}
