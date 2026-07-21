'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

export default function SocialRemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: (reason: string) => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setError('Add a reason for the moderation record.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRemove(normalizedReason);
      setOpen(false);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : `Could not remove ${label}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-social-error transition-colors hover:bg-social-error-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Remove
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-20 mt-1 block w-72 rounded-xl border border-social-border bg-social-surface p-3 text-social-text shadow-lg">
          <span className="block text-sm font-semibold">Remove {label}</span>
          <label className="mt-2 block text-xs font-medium">
            Moderation reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              rows={3}
              required
              className="mt-1 block w-full resize-y rounded-lg border border-social-border bg-social-surface px-2 py-1.5 text-sm text-social-text focus-visible:border-social-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            />
          </label>
          {error ? (
            <span role="alert" className="mt-2 block text-xs font-medium text-social-error">
              {error}
            </span>
          ) : null}
          <span className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="inline-flex min-h-9 items-center rounded-lg border border-social-error bg-social-error px-3 text-xs font-semibold text-social-error-foreground transition-colors hover:bg-social-error-soft hover:text-social-error active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              {submitting ? 'Removing…' : 'Confirm removal'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 items-center rounded-lg border border-social-border bg-social-surface px-3 text-xs font-semibold text-social-text transition-colors hover:bg-social-brand-soft active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              Cancel
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
