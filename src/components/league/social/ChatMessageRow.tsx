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
  /** True when this message continues the previous author's run, so it sits closer to it. */
  continuation: boolean;
  /** True when this is the last message of its author's run: the avatar sits beside it. */
  runEnd: boolean;
  canManage: boolean;
  /** The viewer may publish right now (standards accepted, not muted). */
  canEdit: boolean;
  onReport: (messageId: string, reason: SocialReportReason, details?: string) => Promise<void>;
  onRemove: (messageId: string, reason: string) => Promise<void>;
  onEdit?: (messageId: string, content: string) => Promise<void>;
  onDelete?: (messageId: string) => Promise<void>;
}

/**
 * One chat message as a bubble, after the Ronas IT "Web Chat UI" reference: the name and time sit
 * inside the bubble, a rounded-square avatar sits beside the last bubble of a run, and the
 * member's own messages sit on the right, filled with the action colour. Direction is
 * carried by position and by the accessible name, never by colour alone. Actions stay behind one
 * options button that appears on hover or focus (always on touch screens), so a quiet
 * conversation is not a column of buttons.
 */
export default function ChatMessageRow({
  message,
  day,
  continuation,
  runEnd,
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

  // The editor is a form: it sits on a plain surface, not on the filled bubble.
  const filled = own && !removed && !editing;
  // Another member's message that names someone: blue outline (your own stays filled navy).
  const mentionOutline = containsMention && !own && !editing;

  const tone = removed
    ? 'border-dashed border-social-border bg-transparent'
    : mentionOutline
      ? 'border-2 border-social-link bg-social-bubble shadow-sm'
      : filled
        ? 'border-transparent bg-social-bubble-own text-social-bubble-own-text'
        : editing
          ? 'border-social-border bg-social-surface'
          : 'border-social-bubble-edge bg-social-bubble shadow-sm';

  function closeOptions(): void {
    setOptionsOpen(false);
    setOwnAction(null);
  }

  return (
    <li className={day || !continuation ? 'mt-3 first:mt-0' : 'mt-1'}>
      {day ? (
        <div className="mb-3 flex justify-center">
          <time className="text-[0.6875rem] font-semibold uppercase tracking-wider text-social-text-muted">
            {day}
          </time>
        </div>
      ) : null}

      <div className={`group flex items-end gap-2 ${own ? 'flex-row-reverse' : ''}`}>
        {runEnd ? (
          <SocialAvatar author={message.author} shape="square" />
        ) : (
          <span className="w-10 shrink-0" aria-hidden="true" />
        )}

        <article
          aria-label={`${containsMention ? 'Message containing a mention' : 'Message'} from ${authorName}`}
          className={`min-w-0 rounded-2xl border px-3.5 py-2 ${
            editing ? 'flex-1' : 'max-w-[75%]'
          } ${tone}`}
        >
          {removed ? (
            <p className="text-sm italic text-social-text-muted">Message removed</p>
          ) : (
            <>
              {continuation ? null : own ? (
                <span className="sr-only">You</span>
              ) : (
                <p className="flex min-w-0 items-baseline gap-x-1.5 text-xs">
                  <span className="truncate font-semibold text-social-text">
                    {message.author?.displayName || 'Former member'}
                  </span>
                  <span className="truncate text-social-text-muted">
                    {message.author?.teamName || 'Team unavailable'}
                  </span>
                </p>
              )}
              {mentionOutline ? (
                <span className="mb-0.5 inline-flex items-center gap-1 text-xs font-bold text-social-link">
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
                <SafeSocialText
                  value={message.content}
                  highlightMentions
                  className={
                    filled
                      ? '!text-social-bubble-own-text [&_a]:!text-social-bubble-own-text [&_a]:!decoration-social-bubble-own-text [&_[data-mention]]:!bg-social-bubble-own-text [&_[data-mention]]:!text-social-bubble-own'
                      : ''
                  }
                />
              ) : null}
              {message.gif ? <GiphyMessageMedia gif={message.gif} /> : null}
              {editing ? null : (
                <p
                  className={`mt-0.5 flex justify-end gap-1.5 text-[0.6875rem] tabular-nums ${
                    filled ? 'text-social-bubble-own-muted' : 'text-social-text-muted'
                  }`}
                >
                  {message.editedAt ? <span>Edited</span> : null}
                  <time dateTime={message.createdAt}>{formatSocialTime(message.createdAt)}</time>
                </p>
              )}
            </>
          )}
        </article>

        {hasOptions && !editing ? (
          <button
            type="button"
            aria-label={`Message options for ${own ? 'your message' : `${authorName}’s message`}`}
            aria-expanded={optionsOpen}
            aria-controls={optionsId}
            onClick={() => (optionsOpen ? closeOptions() : setOptionsOpen(true))}
            className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full text-social-text-muted transition-[opacity,background-color,color] hover:bg-social-brand-soft hover:text-social-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${
              optionsOpen ? 'opacity-100' : 'opacity-0'
            }`}
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
