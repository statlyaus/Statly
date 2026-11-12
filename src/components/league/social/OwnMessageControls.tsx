'use client';

import { useEffect, useRef, useState } from 'react';

const secondaryButton =
  'inline-flex min-h-9 items-center rounded-lg border border-social-border bg-social-surface px-3 text-xs font-semibold text-social-text transition-colors hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text';
const primaryButton =
  'inline-flex min-h-9 items-center rounded-lg border border-social-action bg-social-action px-3 text-xs font-semibold text-social-action-foreground transition-colors hover:border-social-action-hover hover:bg-social-action-hover active:bg-social-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text';
const dangerButton =
  'inline-flex min-h-9 items-center rounded-lg border border-social-error bg-social-error px-3 text-xs font-semibold text-social-error-foreground transition-colors hover:bg-social-error-soft hover:text-social-error active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text';

/** Inline editor for the member's own message. Enter saves, Shift+Enter breaks, Escape cancels. */
export function MessageEditForm({
  initialContent,
  maxLength,
  onSave,
  onCancel,
}: {
  initialContent: string;
  maxLength: number;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = content.trim();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  async function save(): Promise<void> {
    if (saving || !trimmed) return;
    if (trimmed === initialContent.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your edit.');
      setSaving(false);
    }
  }

  return (
    <form
      className="mt-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="sr-only" htmlFor="edit-own-message">
        Edit your message
      </label>
      <textarea
        id="edit-own-message"
        ref={inputRef}
        value={content}
        maxLength={maxLength}
        rows={2}
        disabled={saving}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }}
        className="block w-full resize-y rounded-lg border border-social-border bg-social-surface px-2 py-1.5 text-sm text-social-text focus-visible:border-social-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
      />
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-social-error">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !trimmed} className={primaryButton}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/** Inline confirmation before the member deletes their own message. */
export function MessageDeleteConfirm({
  onDelete,
  onCancel,
}: {
  onDelete: () => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => cancelRef.current?.focus(), []);

  // Focus starts on Cancel and stays on these two buttons, so Escape is handled on them.
  const cancelOnEscape = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') onCancel();
  };

  async function confirm(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete your message.'
      );
      setDeleting(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="Delete your message"
      className="mt-2 rounded-lg border border-social-border bg-social-surface p-2"
    >
      <p className="text-xs text-social-text">
        Delete this message? The league will see “Message removed”.
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-social-error">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          disabled={deleting}
          onClick={onCancel}
          onKeyDown={cancelOnEscape}
          className={secondaryButton}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void confirm()}
          onKeyDown={cancelOnEscape}
          className={dangerButton}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
