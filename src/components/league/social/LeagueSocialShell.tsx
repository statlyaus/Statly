'use client';

import { Activity, MessageCircle, MessagesSquare, Settings } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import type {
  SocialChannel,
  SocialDiscussionContext,
  SocialMessage,
  SocialPost,
} from '@/types/social';

import ActivityPanel from './ActivityPanel';
import LeagueChatPanel from './LeagueChatPanel';
import MessageBoardPanel from './MessageBoardPanel';
import PostThread from './PostThread';
import SocialPreferencesPanel from './SocialPreferencesPanel';
import type { SocialComposerSurface } from './socialComposerDraft';
import { useLeagueSocial } from './useLeagueSocial';

export type LeagueSocialView = SocialChannel;

export interface LeagueSocialShellProps {
  leagueId: string;
  currentUserId?: string;
  initialView?: LeagueSocialView;
  initialPostId?: string;
  className?: string;
  title?: string;
  showHeader?: boolean;
  compact?: boolean;
  visible?: boolean;
  composerLabel?: string;
  composerSurface?: SocialComposerSurface;
  composerContext?: SocialDiscussionContext | null;
  onClearComposerContext?: () => void;
  onDiscussActivity?: (activity: SocialMessage) => void;
}

const tabs: Array<{ id: LeagueSocialView; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'board', label: 'Board', icon: MessagesSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
];

export default function LeagueSocialShell({
  leagueId,
  currentUserId,
  initialView = 'chat',
  initialPostId,
  className = '',
  title = 'League social',
  showHeader = true,
  compact = false,
  visible = true,
  composerLabel = 'Message league chat',
  composerSurface = { type: 'league-chat' },
  composerContext,
  onClearComposerContext,
  onDiscussActivity,
}: LeagueSocialShellProps): React.JSX.Element {
  const controller = useLeagueSocial(leagueId, currentUserId);
  const tabSetId = useId();
  const tabRefs = useRef<Record<LeagueSocialView, HTMLButtonElement | null>>({
    chat: null,
    board: null,
    activity: null,
  });
  const loadedInitialPostRef = useRef<string | null>(null);
  const [activeView, setActiveView] = useState<LeagueSocialView>(initialView);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(initialPostId ?? null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [acceptingStandards, setAcceptingStandards] = useState(false);
  const [standardsError, setStandardsError] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );
  const [latestVisible, setLatestVisible] = useState<Record<SocialChannel, boolean>>({
    chat: false,
    board: false,
    activity: false,
  });
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
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!visible || !documentVisible || controller.loading || !latestVisible[activeView]) return;
    void controller.markRead(activeView);
  }, [activeView, controller, documentVisible, latestVisible, visible]);

  const handleLatestVisibleChange = useCallback((channel: SocialChannel, isVisible: boolean) => {
    setLatestVisible((current) =>
      current[channel] === isVisible ? current : { ...current, [channel]: isVisible }
    );
  }, []);

  function selectView(view: LeagueSocialView): void {
    setActiveView(view);
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
    handleLatestVisibleChange('board', false);
    setSelectedPostId(post.id);
    void controller.loadReplies(post.id);
  }

  const settingsButton = (
    <button
      type="button"
      onClick={() => setShowPreferences((preferencesVisible) => !preferencesVisible)}
      aria-expanded={showPreferences}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
    >
      <Settings className="size-4" aria-hidden="true" />
      <span className="sr-only">Social notification preferences</span>
    </button>
  );

  return (
    <section
      className={`league-social flex min-w-0 flex-col overflow-hidden rounded-2xl border border-social-border bg-social-canvas text-social-text shadow-sm ${
        compact ? 'min-h-0' : 'min-h-[36rem]'
      } ${className}`}
      aria-label={title}
    >
      <div
        className={
          compact
            ? 'border-b border-social-border bg-social-surface'
            : 'border-b border-social-border bg-social-surface px-3 pt-3'
        }
      >
        {showHeader ? (
          <div className="flex items-start justify-between gap-3 px-1 pb-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-social-text">{title}</h1>
              <p className="mt-1 text-sm text-social-text-muted">
                Chat live or revisit persistent league discussions.
              </p>
            </div>
            {settingsButton}
          </div>
        ) : null}
        {showPreferences && controller.summary ? (
          <div className={compact ? 'px-3 pt-3' : undefined}>
            <SocialPreferencesPanel
              preferences={controller.summary.preferences}
              onSave={async (preferences) => {
                await controller.updatePreferences(preferences);
              }}
              onClose={() => setShowPreferences(false)}
            />
          </div>
        ) : null}
        {controller.summary && !controller.summary.standardsAccepted ? (
          <div
            className={`rounded-xl border border-social-action bg-social-brand-soft p-3 ${
              compact ? 'm-3' : 'mb-3'
            }`}
          >
            <p className="text-sm font-semibold text-social-text">Community standards</p>
            <p className="mt-1 text-sm text-social-text-muted">
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
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-social-action bg-social-action px-4 text-sm font-semibold text-social-action-foreground transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:border-social-action-pressed active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus focus-visible:ring-offset-2 focus-visible:ring-offset-social-surface disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              {acceptingStandards ? 'Saving…' : 'I accept the community standards'}
            </button>
            {standardsError ? (
              <p role="alert" className="mt-2 text-sm font-medium text-social-error">
                {standardsError}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className={compact ? 'flex h-12 items-center px-2' : 'flex items-center gap-2 pb-3'}>
          <div
            role="tablist"
            aria-label="League social views"
            className={
              compact
                ? 'flex h-full min-w-0 flex-1 items-stretch'
                : 'grid min-w-0 max-w-xl flex-1 grid-cols-3 gap-1 rounded-xl bg-social-surface-subtle p-1'
            }
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
                  className={`relative inline-flex min-h-10 items-center justify-center gap-1.5 px-2 text-sm transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-social-focus ${
                    compact
                      ? `flex-1 border-b-2 ${
                          active
                            ? 'border-social-action font-semibold text-social-text'
                            : 'border-transparent font-medium text-social-text-muted hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle'
                        }`
                      : `rounded-lg font-semibold ${
                          active
                            ? 'bg-social-surface text-social-text shadow-sm ring-1 ring-social-border'
                            : 'text-social-text-muted hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface'
                        }`
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{tab.label}</span>
                  {unread > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-social-action px-1.5 py-0.5 text-xs font-semibold text-social-action-foreground">
                      <span className="sr-only">{unread} unread</span>
                      <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {!showHeader ? settingsButton : null}
        </div>
      </div>

      <div
        id={`${tabSetId}-chat-panel`}
        role="tabpanel"
        aria-labelledby={`${tabSetId}-chat-tab`}
        hidden={activeView !== 'chat'}
        aria-hidden={activeView !== 'chat'}
        className={`${activeView === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-1 bg-social-canvas ${
          compact ? 'p-0' : 'p-3'
        }`}
      >
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
          visible={visible && activeView === 'chat'}
          compact={compact}
          composerLabel={composerLabel}
          draftScope={
            currentUserId && controller.summary
              ? {
                  userId: currentUserId,
                  leagueId,
                  leagueSeasonId: controller.summary.seasonId,
                  surface: composerSurface,
                  ...(composerContext
                    ? {
                        discussion: {
                          type: composerContext.type,
                          id: composerContext.id,
                        },
                      }
                    : {}),
                }
              : undefined
          }
          composerContext={composerContext}
          onClearComposerContext={onClearComposerContext}
          onDismissSubmitError={controller.clearSubmitError}
          onLatestVisibleChange={(isLatestVisible) =>
            handleLatestVisibleChange('chat', isLatestVisible)
          }
          onRetry={controller.retry}
          onLoadEarlier={controller.loadEarlierMessages}
          onSend={controller.sendMessage}
          onReport={(messageId, reason, details) =>
            controller.reportContent('message', messageId, reason, details)
          }
          onRemove={(messageId, reason) => controller.moderateContent('message', messageId, reason)}
        />
      </div>

      <div
        id={`${tabSetId}-board-panel`}
        role="tabpanel"
        aria-labelledby={`${tabSetId}-board-tab`}
        hidden={activeView !== 'board'}
        aria-hidden={activeView !== 'board'}
        className={`${activeView === 'board' ? 'flex' : 'hidden'} min-h-0 flex-1 bg-social-canvas ${
          compact ? 'p-0' : 'p-3'
        }`}
      >
        {selectedPost ? (
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
            onDismissSubmitError={controller.clearSubmitError}
            visible={visible && activeView === 'board'}
            compact={compact}
            onBack={() => {
              handleLatestVisibleChange('board', false);
              setSelectedPostId(null);
            }}
            onRetry={() => controller.loadReplies(selectedPost.id)}
            onLoadMore={() => controller.loadReplies(selectedPost.id, true)}
            onReply={(body, idempotencyKey) =>
              controller.createReply(selectedPost.id, body, idempotencyKey)
            }
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
            visible={visible && activeView === 'board'}
            compact={compact}
            onRetry={controller.retry}
            onLoadMore={controller.loadMorePosts}
            onSelectPost={handleSelectPost}
            onCreatePost={controller.createPost}
            sort={controller.postSort}
            onSortChange={controller.setPostSort}
            onLatestVisibleChange={(isLatestVisible) =>
              handleLatestVisibleChange('board', isLatestVisible)
            }
          />
        )}
      </div>

      <div
        id={`${tabSetId}-activity-panel`}
        role="tabpanel"
        aria-labelledby={`${tabSetId}-activity-tab`}
        hidden={activeView !== 'activity'}
        aria-hidden={activeView !== 'activity'}
        className={`${activeView === 'activity' ? 'flex' : 'hidden'} min-h-0 flex-1 bg-social-canvas ${
          compact ? 'p-0' : 'p-3'
        }`}
      >
        <ActivityPanel
          activity={controller.activity}
          hasEarlierActivity={Boolean(controller.activityCursor)}
          loading={controller.loading}
          loadingEarlier={controller.loadingEarlierActivity}
          error={controller.error}
          visible={visible && activeView === 'activity'}
          compact={compact}
          onRetry={controller.retry}
          onLoadEarlier={controller.loadEarlierActivity}
          onLatestVisibleChange={(isLatestVisible) =>
            handleLatestVisibleChange('activity', isLatestVisible)
          }
          onDiscuss={
            onDiscussActivity
              ? (activity) => {
                  onDiscussActivity(activity);
                  selectView('chat');
                  window.requestAnimationFrame(() => tabRefs.current.chat?.focus());
                }
              : undefined
          }
        />
      </div>
    </section>
  );
}
