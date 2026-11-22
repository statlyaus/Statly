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
        className="inline-flex min-h-8 items-center gap-1 rounded-cut px-2 text-xs font-medium text-destructive-text transition-colors hover:bg-destructive-soft active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        Remove
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-20 mt-1 block w-72 rounded-cut-float border-[2.5px] border-foreground bg-card p-3 text-foreground shadow-hard">
          <span className="block text-sm font-semibold">Remove {label}</span>
          <label className="mt-2 block text-xs font-medium">
            Moderation reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              rows={3}
              required
              className="mt-1 block w-full resize-y rounded-cut border border-border bg-card px-2 py-1.5 text-sm text-foreground focus-visible:border-brand-bar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {error ? (
            <span role="alert" className="mt-2 block text-xs font-medium text-destructive-text">
              {error}
            </span>
          ) : null}
          <span className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="inline-flex min-h-9 items-center rounded-cut border border-destructive bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive-soft hover:text-destructive-text active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
            >
              {submitting ? 'Removing…' : 'Confirm removal'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 items-center rounded-cut border border-border bg-card px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              Cancel
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
