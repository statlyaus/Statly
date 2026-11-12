'use client';

import { AtSign, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import type { SocialMessage, SocialReportReason } from '@/types/social';

import DiscussionContextCard from './DiscussionContextCard';
import GiphyMessageMedia from './GiphyMessageMedia';
import { MessageDeleteConfirm, MessageEditForm } from './OwnMessageControls';
import SafeSocialText from './SafeSocialText';
import { formatSocialTime, SocialAvatar } from './SocialAuthor';
import SocialRemoveButton from './SocialRemoveButton';
import SocialReportButton from './SocialReportButton';

const quietButton =
  'inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus';

export function containsSocialMention(value: string): boolean {
  return /(^|\s)@[a-z0-9][a-z0-9._-]*/i.test(value);
}

interface ChatMessageRowProps {
  message: SocialMessage;
  /** The day heading to print above this message; null when it shares the previous one's day. */
  day: string | null;
  /** True when this message continues the previous author's run, so the identity is not repeated. */
  continuation: boolean;
  canManage: boolean;
  /** The viewer may publish right now (standards accepted, not muted). */
  canEdit: boolean;
  onReport: (messageId: string, reason: SocialReportReason, details?: string) => Promise<void>;
  onRemove: (messageId: string, reason: string) => Promise<void>;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
}

/**
 * One chat message as a bubble. The member's own messages sit on the right without an avatar;
 * everyone else's sit on the left beside theirs. Direction is carried by position and by the
 * accessible name, never by colour alone. Actions stay behind one options button so a quiet
 * conversation is not a column of Report links.
 */
export default function ChatMessageRow({
  message,
  day,
  continuation,
  canManage,
  canEdit,
  onReport,
  onRemove,
  onEdit,
  onDelete,
}: ChatMessageRowProps): React.JSX.Element {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [ownAction, setOwnAction] = useState<'edit' | 'delete' | null>(null);
  const optionsId = useId();

  const own = message.isOwn;
  const removed = message.moderationStatus === 'removed' || Boolean(message.deletedAt);
  const containsMention = !removed && containsSocialMention(message.content);
  const authorName = message.author?.displayName ?? 'former member';
  const canEditOwn = Boolean(own && onEdit && canEdit && message.content);
  const canDeleteOwn = Boolean(own && onDelete);
  const hasOptions = !removed && (!own || canManage || canEditOwn || canDeleteOwn);
  const editing = ownAction === 'edit' && Boolean(onEdit);
  const deleting = ownAction === 'delete' && Boolean(onDelete);

  const tone = removed
    ? 'border-dashed border-social-border bg-transparent'
    : containsMention
      ? 'border-social-warning bg-social-mention-bg text-social-mention-text'
      : own
        ? 'border-social-action bg-social-brand-soft'
        : 'border-social-border bg-social-surface';

  function closeOptions(): void {
    setOptionsOpen(false);
    setOwnAction(null);
  }

  return (
    <li className={day || !continuation ? 'mt-3 first:mt-0' : 'mt-1'}>
      {day ? (
        <div className="mb-3 flex items-center gap-3" aria-label={day}>
          <span className="h-px flex-1 bg-social-border" />
          <time className="rounded-full border border-social-border bg-social-surface px-2.5 py-0.5 text-xs font-medium text-social-text-muted">
            {day}
          </time>
          <span className="h-px flex-1 bg-social-border" />
        </div>
      ) : null}

      <div className={`flex items-end gap-2 ${own ? 'flex-row-reverse' : ''}`}>
        {own ? null : continuation ? (
          <span className="w-8 shrink-0" aria-hidden="true" />
        ) : (
          <span className="self-start pt-5">
            <SocialAvatar author={message.author} compact />
          </span>
        )}

        <div
          className={`flex min-w-0 flex-col ${own ? 'items-end' : 'items-start'} ${
            editing ? 'flex-1' : 'max-w-[85%]'
          }`}
        >
          {!continuation ? (
            <p className="mb-0.5 flex max-w-full flex-wrap items-baseline gap-x-2 px-1 text-xs text-social-text-muted">
              {own ? (
                <span className="font-semibold text-social-text">You</span>
              ) : (
                <>
                  <span className="truncate text-sm font-semibold text-social-text">
                    {message.author?.displayName || 'Former member'}
                  </span>
                  <span className="truncate">{message.author?.teamName || 'Team unavailable'}</span>
                </>
              )}
              <time dateTime={message.createdAt}>{formatSocialTime(message.createdAt)}</time>
            </p>
          ) : (
            <time dateTime={message.createdAt} className="sr-only">
              {new Date(message.createdAt).toLocaleTimeString()}
            </time>
          )}

          <article
            aria-label={`${containsMention ? 'Message containing a mention' : 'Message'} from ${authorName}`}
            className={`min-w-0 max-w-full rounded-2xl border px-3 py-1.5 ${
              editing ? 'w-full' : ''
            } ${own ? 'rounded-br-md' : 'rounded-bl-md'} ${tone}`}
          >
            {removed ? (
              <p className="text-sm italic text-social-text-muted">Message removed</p>
            ) : (
              <>
                {containsMention ? (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-social-warning bg-social-warning-soft px-2 py-0.5 text-xs font-semibold text-social-mention-text">
                    <AtSign className="size-3" aria-hidden="true" />
                    Mention
                  </span>
                ) : null}
                {message.context ? <DiscussionContextCard context={message.context} /> : null}
                {editing && onEdit ? (
                  <MessageEditForm
                    initialContent={message.content}
                    maxLength={1000}
                    onCancel={closeOptions}
                    onSave={async (content) => {
                      await onEdit(message.id, content);
                      closeOptions();
                    }}
                  />
                ) : message.content ? (
                  <SafeSocialText value={message.content} />
                ) : null}
                {message.gif ? <GiphyMessageMedia gif={message.gif} /> : null}
                {message.editedAt && !editing ? (
                  <p className="mt-0.5 text-right text-xs text-social-text-muted">Edited</p>
                ) : null}
              </>
            )}
          </article>
        </div>

        {hasOptions && !editing ? (
          <button
            type="button"
            aria-label={`Message options for ${own ? 'your message' : `${authorName}’s message`}`}
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => (optionsOpen ? closeOptions() : setOptionsOpen(true))}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {hasOptions && optionsOpen && !editing ? (
        <div id={optionsId} className={own ? '' : 'pl-10'}>
          {deleting && onDelete ? (
            <MessageDeleteConfirm
              onCancel={() => setOwnAction(null)}
              onDelete={async () => {
                await onDelete(message.id);
                closeOptions();
              }}
            />
          ) : (
            <div className="mt-1 flex flex-wrap justify-end gap-1">
              {canEditOwn ? (
                <button type="button" onClick={() => setOwnAction('edit')} className={quietButton}>
                  <Pencil className="size-3.5" aria-hidden="true" />
                  Edit
                </button>
              ) : null}
              {canDeleteOwn ? (
                <button
                  type="button"
                  onClick={() => setOwnAction('delete')}
                  className={quietButton}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Delete
                </button>
              ) : null}
              {!own ? (
                <SocialReportButton
                  label="message"
                  onReport={(reason, details) => onReport(message.id, reason, details)}
                />
              ) : null}
              {canManage && !(own && canDeleteOwn) ? (
                <SocialRemoveButton
                  label="message"
                  onRemove={(reason) => onRemove(message.id, reason)}
                />
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
