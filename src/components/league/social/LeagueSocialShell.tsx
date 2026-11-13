'use client';

import { Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  /** The one view this screen shows: league chat, the message board (Posts) or Activity. */
  view?: LeagueSocialView;
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

const VIEW_DESCRIPTIONS: Record<LeagueSocialView, string> = {
  chat: 'Talk with every coach in the league.',
  board: 'Longer discussions and commissioner announcements.',
  activity: 'Waivers, trades and other league moves.',
};

export default function LeagueSocialShell({
  leagueId,
  currentUserId,
  view = 'chat',
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
  const loadedInitialPostRef = useRef<string | null>(null);
  const activeView = view;
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
    if (!initialPostId || loadedInitialPostRef.current === initialPostId) return;
    loadedInitialPostRef.current = initialPostId;
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
          compact ? 'bg-social-canvas' : 'border-b border-social-border bg-social-surface px-3 pt-3'
        }
      >
        {showHeader ? (
          <div className="flex items-start justify-between gap-3 px-1 pb-3">
            <div>
              <h1 className="font-display text-3xl font-bold leading-none text-social-text">
                {title}
              </h1>
              <p className="mt-1 text-sm text-social-text-muted">{VIEW_DESCRIPTIONS[activeView]}</p>
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
      </div>

      <div
        hidden={activeView !== 'chat'}
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
          onEdit={controller.editMessage}
          onDelete={controller.deleteMessage}
        />
      </div>

      <div
        hidden={activeView !== 'board'}
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
        hidden={activeView !== 'activity'}
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
          onDiscuss={onDiscussActivity}
        />
      </div>
    </section>
  );
}
