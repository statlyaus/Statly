'use client';

import { Flag } from 'lucide-react';
import { useState } from 'react';

import type { SocialReportReason } from '@/types/social';

export default function SocialReportButton({
  label,
  onReport,
}: {
  label: string;
  onReport: (reason: SocialReportReason, details?: string) => Promise<void>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SocialReportReason>('harassment');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await onReport(reason, details.trim() || undefined);
      setSubmitted(true);
      setOpen(false);
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : 'Could not submit report.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <span role="status" className="text-xs font-medium text-social-success">
        Report submitted
      </span>
    );
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-social-text-muted transition-colors hover:bg-social-brand-soft hover:text-social-text active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
      >
        <Flag className="size-3.5" aria-hidden="true" />
        Report
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-20 mt-1 block w-72 rounded-xl border border-social-border bg-social-surface p-3 text-social-text shadow-lg">
          <span className="block text-sm font-semibold">Report {label}</span>
          <label className="mt-2 block text-xs font-medium">
            Reason
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as SocialReportReason)}
              className="mt-1 block h-10 w-full rounded-lg border border-social-border bg-social-surface px-2 text-sm text-social-text focus-visible:border-social-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            >
              <option value="harassment">Harassment</option>
              <option value="hate">Hateful content</option>
              <option value="spam">Spam</option>
              <option value="threats">Threats</option>
              <option value="unsafe-link">Unsafe link</option>
              <option value="other">Other</option>
            </select>
          </label>
          {error ? (
            <span role="alert" className="mt-2 block text-xs font-medium text-social-error">
              {error}
            </span>
          ) : null}
          <label className="mt-2 block text-xs font-medium">
            Details (optional)
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 block w-full resize-y rounded-lg border border-social-border bg-social-surface px-2 py-1.5 text-sm text-social-text focus-visible:border-social-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus"
            />
          </label>
          <span className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit()}
              className="inline-flex min-h-9 items-center rounded-lg border border-social-error bg-social-error px-3 text-xs font-semibold text-social-error-foreground transition-colors hover:bg-social-error-soft hover:text-social-error active:bg-social-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-social-focus disabled:cursor-not-allowed disabled:border-social-border disabled:bg-social-disabled-bg disabled:text-social-disabled-text"
            >
              {submitting ? 'Submitting…' : 'Submit report'}
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
